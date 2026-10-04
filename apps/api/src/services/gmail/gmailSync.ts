import { logger } from "../../lib/logger.js";
import { gmailAuth } from "./gmailAuth.js";
import { gmailClient, GmailRateLimitError, type ParsedEmail } from "./gmailClient.js";
import {
  buildPlatformSearchQuery,
  buildSearchQuery,
  classifyEmailWithLlm, PREFILTER_VERSION, prefilterEmail } from "./gmailClassifier.js";
import { ACTION_EVENT_TYPES, ACTION_REQUEST_VERSION, extractActionRequest } from "./actionRequest.js";
import { ACTION_STALE_DAYS } from "./gmailApplications.js";
import { gmailMessagesRepository } from "./gmailMessages.repository.js";
import { extractInterviewDetail, INTERVIEW_DETAIL_VERSION } from "./interviewRounds.js";
import { addMissingApplicationsQuietly } from "./trackerAutoAdd.js";

export const DEFAULT_SYNC_DAYS = 7;
export const MAX_SYNC_DAYS = 30;
const CONCURRENCY = 4;

export type GmailSyncResult = {
  days: number;
  scanned: number;
  alreadyProcessed: number;
  prefiltered: number;
  classified: number;
  applicationEmails: number;
  llmFailures: number;
  /** Interview emails whose round details were extracted, including older emails backfilled this run. */
  interviewDetails: number;
  /** Emails left for the next sync (fetch failed or Gmail's per-minute limit was hit). */
  deferred: number;
  rateLimited: boolean;
  /** Scored applications added to the tracker this run. */
  trackerAdded: number;
};

const BACKFILL_LIMIT = 100;

/** Re-fetch interview emails (any age) whose round details are missing or outdated, and extract them. */
const backfillInterviewDetails = async (): Promise<number> => {
  const ids = await gmailMessagesRepository.listInterviewIdsMissingDetail(BACKFILL_LIMIT, INTERVIEW_DETAIL_VERSION);
  let filled = 0;
  let rateLimited = false;
  await runPool(ids, CONCURRENCY, async (id) => {
    if (rateLimited) return;
    try {
      const email = await gmailClient.getMessage(id);
      const { detail, llmSucceeded } = await extractInterviewDetail(email);
      if (!llmSucceeded) return;
      await gmailMessagesRepository.setInterviewDetail(id, detail);
      filled += 1;
    } catch (error) {
      if (error instanceof GmailRateLimitError) rateLimited = true;
      else logger.warn("Interview round backfill failed", { id, error: String(error) });
    }
  });
  return filled;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTION_BACKFILL_LIMIT = 50;

/** Check recent application emails (synced before action detection existed) for requests. */
const backfillActionRequests = async (): Promise<void> => {
  const since = new Date(Date.now() - ACTION_STALE_DAYS * DAY_MS).toISOString();
  const ids = await gmailMessagesRepository.listIdsMissingAction(
    since,
    ACTION_EVENT_TYPES,
    ACTION_REQUEST_VERSION,
    ACTION_BACKFILL_LIMIT,
  );
  let rateLimited = false;
  await runPool(ids, CONCURRENCY, async (id) => {
    if (rateLimited) return;
    try {
      const { action, llmSucceeded } = await extractActionRequest(await gmailClient.getMessage(id));
      if (llmSucceeded) await gmailMessagesRepository.setAction(id, action);
    } catch (error) {
      if (error instanceof GmailRateLimitError) rateLimited = true;
      else logger.warn("Action request backfill failed", { id, error: String(error) });
    }
  });
};

/** An open request is handled once the candidate has sent a message in that thread after it. */
const markRepliedActions = async (): Promise<void> => {
  const since = new Date(Date.now() - ACTION_STALE_DAYS * DAY_MS).toISOString();
  for (const item of await gmailMessagesRepository.listOpenActionMessages(since)) {
    try {
      const thread = await gmailClient.getThreadMessages(item.threadId);
      const reply = thread.find((m) => m.sent && m.date > item.date);
      if (reply) await gmailMessagesRepository.setActionReplied(item.id, reply.date);
    } catch (error) {
      if (error instanceof GmailRateLimitError) return;
      logger.warn("Reply check failed", { emailId: item.id, error: String(error) });
    }
  }
};

const runPool = async <T>(items: T[], limit: number, worker: (item: T) => Promise<void>) => {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await worker(item);
    }
  });
  await Promise.all(runners);
};

let inFlight: Promise<unknown> = Promise.resolve();

/**
 * Pull recent mail, prefilter with rules, classify survivors with the LLM, cache results.
 * Runs one at a time so a manual and a scheduled sync never pay to classify the same email twice.
 */
export const syncGmail = (days = DEFAULT_SYNC_DAYS): Promise<GmailSyncResult> => {
  const run = inFlight.catch(() => undefined).then(() => syncGmailNow(days));
  inFlight = run;
  return run;
};

const syncGmailNow = async (days: number): Promise<GmailSyncResult> => {
  const window = Math.min(Math.max(1, Math.floor(days)), MAX_SYNC_DAYS);
  const [main, platform] = await Promise.all([
    gmailClient.listMessageIds(buildSearchQuery(window)),
    gmailClient.listMessageIds(buildPlatformSearchQuery(window)),
  ]);
  const ids = [...new Set([...main, ...platform])];
  const processed = await gmailMessagesRepository.findProcessedIds(ids, PREFILTER_VERSION);
  const todo = ids.filter((id) => !processed.has(id));

  const result: GmailSyncResult = {
    days: window,
    scanned: ids.length,
    alreadyProcessed: processed.size,
    prefiltered: 0,
    classified: 0,
    applicationEmails: 0,
    llmFailures: 0,
    interviewDetails: 0,
    deferred: 0,
    rateLimited: false,
    trackerAdded: 0,
  };

  let handled = 0;
  await runPool(todo, CONCURRENCY, async (id) => {
    if (result.rateLimited) return;
    let email: ParsedEmail;
    try {
      email = await gmailClient.getMessage(id);
    } catch (error) {
      if (error instanceof GmailRateLimitError) result.rateLimited = true;
      else logger.warn("Gmail message fetch failed; will retry next sync", { id, error: String(error) });
      return;
    }
    handled += 1;
    const prefilter = prefilterEmail(email);
    const base = {
      id: email.id,
      threadId: email.threadId,
      date: email.date,
      from: email.from,
      subject: email.subject,
      prefilterPassed: prefilter.keep,
      prefilterReason: prefilter.reason,
      prefilterVersion: PREFILTER_VERSION,
      processedAt: new Date().toISOString(),
    };
    if (!prefilter.keep) {
      await gmailMessagesRepository.upsert(base);
      return;
    }
    result.prefiltered += 1;
    const { classification, llmSucceeded } = await classifyEmailWithLlm(email);
    result.classified += 1;
    if (!llmSucceeded) result.llmFailures += 1;
    if (classification.isApplicationEmail) result.applicationEmails += 1;
    if (classification.isApplicationEmail && classification.eventType === "interview") {
      const extracted = await extractInterviewDetail(email);
      if (extracted.llmSucceeded) {
        classification.interview = extracted.detail;
        result.interviewDetails += 1;
      }
    }
    if (
      classification.isApplicationEmail &&
      ACTION_EVENT_TYPES.includes(classification.eventType) &&
      Date.now() - Date.parse(email.date) <= ACTION_STALE_DAYS * DAY_MS
    ) {
      const checked = await extractActionRequest(email);
      if (checked.llmSucceeded) classification.action = checked.action;
    }
    await gmailMessagesRepository.upsert({ ...base, classification, llmSucceeded });
  });

  result.deferred = todo.length - handled;
  if (!result.rateLimited) {
    result.interviewDetails += await backfillInterviewDetails();
    await backfillActionRequests();
    await markRepliedActions();
    result.trackerAdded = await addMissingApplicationsQuietly();
  }

  await gmailAuth.recordSync(new Date().toISOString());
  logger.info("Gmail sync complete", { ...result });
  return result;
};
