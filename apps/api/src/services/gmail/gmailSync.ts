import { logger } from "../../lib/logger.js";
import { gmailAuth } from "./gmailAuth.js";
import { gmailClient } from "./gmailClient.js";
import { buildSearchQuery, classifyEmailWithLlm, PREFILTER_VERSION, prefilterEmail } from "./gmailClassifier.js";
import { gmailMessagesRepository } from "./gmailMessages.repository.js";
import { extractInterviewDetail, INTERVIEW_DETAIL_VERSION } from "./interviewRounds.js";

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
};

const BACKFILL_LIMIT = 100;

/** Re-fetch interview emails (any age) whose round details are missing or outdated, and extract them. */
const backfillInterviewDetails = async (): Promise<number> => {
  const ids = await gmailMessagesRepository.listInterviewIdsMissingDetail(BACKFILL_LIMIT, INTERVIEW_DETAIL_VERSION);
  let filled = 0;
  await runPool(ids, CONCURRENCY, async (id) => {
    try {
      const email = await gmailClient.getMessage(id);
      const { detail, llmSucceeded } = await extractInterviewDetail(email);
      if (!llmSucceeded) return;
      await gmailMessagesRepository.setInterviewDetail(id, detail);
      filled += 1;
    } catch (error) {
      logger.warn("Interview round backfill failed", { id, error: String(error) });
    }
  });
  return filled;
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

/** Pull recent mail, prefilter with rules, classify survivors with the LLM, cache results. */
export const syncGmail = async (days = DEFAULT_SYNC_DAYS): Promise<GmailSyncResult> => {
  const window = Math.min(Math.max(1, Math.floor(days)), MAX_SYNC_DAYS);
  const ids = await gmailClient.listMessageIds(buildSearchQuery(window));
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
  };

  await runPool(todo, CONCURRENCY, async (id) => {
    const email = await gmailClient.getMessage(id);
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
    await gmailMessagesRepository.upsert({ ...base, classification, llmSucceeded });
  });

  result.interviewDetails += await backfillInterviewDetails();

  await gmailAuth.recordSync(new Date().toISOString());
  logger.info("Gmail sync complete", { ...result });
  return result;
};
