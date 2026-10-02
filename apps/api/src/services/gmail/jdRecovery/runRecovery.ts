import { triageJob } from "../../../agents/jobAgent/orchestrator.js";
import { env } from "../../../config/env.js";
import { computeJdTextHash } from "../../../lib/jdTextHash.js";
import { logger } from "../../../lib/logger.js";
import type { JobRecord } from "../../../types/job.js";
import {
  getGmailApplications,
  type ApplicationStatus,
  type GmailApplication,
} from "../gmailApplications.js";
import type { EmailEventType } from "../gmailClassifier.js";
import { gmailClient, type ParsedEmail } from "../gmailClient.js";
import { assessJdMatch, isScoreable, type EvidenceSource, type JdMatch } from "./assessJdMatch.js";
import { classifyJobLink, collectEmailEvidence, unwrapLink } from "./emailEvidence.js";
import {
  evaluationsRepository,
  type ApplicationEvaluation,
  type RecoveryAttempt,
} from "./evaluations.repository.js";
import { fetchPosting, PostingFetchError, type FetchedPosting } from "./fetchPosting.js";
import { serperClient, serperUsageRepository, type SerperResult, type SerperUsage } from "./serperClient.js";

export const SCORER_VERSION = "jd-recovery-v1:base-ai";
const RECOVERY_BODY_CHARS = 20_000;
const MAX_EMAIL_LINKS = 5;
const MAX_SERPER_QUERIES_PER_JOB = 2;
const MAX_SERPER_CANDIDATES = 3;
const FETCH_FAILED_RETRY_MS = 24 * 60 * 60 * 1000;
/** Bounds total work per run; cheap no-evidence rows don't count against the triage cap. */
const MAX_PROCESSED_PER_RUN_FACTOR = 4;

const AGGREGATOR_HOST_RE =
  /(^|\.)(indeed|glassdoor|ziprecruiter|simplyhired|monster|careerbuilder|builtin|talent|jooble|adzuna|dice|wellfound|levels\.fyi|salary|payscale|comparably)\./i;

type Candidate = { posting: FetchedPosting; source: EvidenceSource; match: JdMatch };

const EVENT_TO_OUTCOME: Partial<Record<EmailEventType, ApplicationStatus>> = {
  applied: "applied",
  assessment: "assessment",
  interview: "interviewing",
  rejected: "rejected",
  offer: "offer",
};

export const buildOutcome = (app: GmailApplication): ApplicationEvaluation["outcome"] => ({
  status: app.status,
  updatedAt: app.lastUpdateAt,
  history: [...app.emails]
    .reverse()
    .flatMap((e) => {
      const status = EVENT_TO_OUTCOME[e.eventType];
      return status ? [{ status, at: e.date }] : [];
    }),
});

/** The scorer sees only the recovered JD and a company hint — never email content or outcome. */
export const scoreBlind = (posting: Pick<FetchedPosting, "text">, companyHint: string): Promise<JobRecord> =>
  triageJob({ rawText: posting.text, companyHint, fullPrep: false });

export const buildSerperQueries = (company: string, role: string | null, reqId?: string): string[] => {
  const queries: string[] = [];
  if (reqId) queries.push(`"${company}" "${reqId}"`);
  if (role) queries.push(`"${company}" "${role}"${reqId ? ` ${reqId}` : ""}`);
  if (role) queries.push(`"${company}" "${role}" job`);
  return [...new Set(queries)].slice(0, MAX_SERPER_QUERIES_PER_JOB);
};

/** ATS and company pages first; aggregator listings dropped. */
export const rankSerperResults = (results: SerperResult[]): string[] => {
  const scored: Array<{ url: string; rank: number }> = [];
  for (const r of results) {
    const url = unwrapLink(r.link);
    if (!url) continue;
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    if (AGGREGATOR_HOST_RE.test(host)) continue;
    if (/linkedin\.com$/.test(host) && !/\/jobs\/view\//.test(url)) continue;
    const kind = classifyJobLink(url);
    scored.push({ url, rank: kind && kind !== "careers" && kind !== "linkedin" ? 0 : kind ? 1 : 2 });
  }
  return [...new Map(scored.sort((a, b) => a.rank - b.rank).map((s) => [s.url, s])).keys()];
};

const describeError = (error: unknown): string =>
  error instanceof PostingFetchError ? error.reason : error instanceof Error ? error.message.slice(0, 120) : "error";

const better = (a: Candidate | undefined, b: Candidate): Candidate => {
  const order = { exact: 3, high: 2, low: 1, none: 0 } as const;
  return !a || order[b.match.level] > order[a.match.level] ? b : a;
};

export const needsRecovery = (existing: ApplicationEvaluation | undefined, now = Date.now()): boolean => {
  if (!existing) return true;
  const { status, reason } = existing.recovery;
  if (status === "fetch_failed") return now - Date.parse(existing.updatedAt) > FETCH_FAILED_RETRY_MS;
  if (status === "not_found" && reason === "serper_not_configured") return serperClient.isConfigured();
  return false;
};

const fetchEmails = async (app: GmailApplication): Promise<ParsedEmail[]> => {
  const results = await Promise.allSettled(app.emails.map((e) => gmailClient.getMessage(e.id, RECOVERY_BODY_CHARS)));
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
};

/** Recover, verify, and (only when verified) blind-score one application. */
export const recoverApplication = async (
  app: GmailApplication,
  usage: SerperUsage,
): Promise<{ evaluation: ApplicationEvaluation; triaged: boolean }> => {
  const emails = await fetchEmails(app);
  const evidence = collectEmailEvidence(emails);
  const attempts: RecoveryAttempt[] = [];
  let best: Candidate | undefined;
  let fetchErrors = 0;
  let serperQueries = 0;
  let notFoundReason: string | undefined;

  const consider = (posting: FetchedPosting, source: EvidenceSource) => {
    const match = assessJdMatch({
      company: app.company,
      role: app.role,
      requisitionId: evidence.requisitionId,
      source,
      posting,
    });
    attempts.push({ url: posting.url, source, ok: true, matchLevel: match.level });
    best = better(best, { posting, source, match });
  };

  const tryUrl = async (url: string, source: EvidenceSource) => {
    try {
      consider(await fetchPosting(url), source);
    } catch (error) {
      fetchErrors += 1;
      attempts.push({ url, source, ok: false, reason: describeError(error) });
    }
  };

  const verified = () => Boolean(best && isScoreable(best.match.level));

  if (evidence.inlineJd) {
    consider({ url: "", source: "generic", text: evidence.inlineJd.text }, "email_body");
  }
  for (const link of evidence.jobLinks.slice(0, MAX_EMAIL_LINKS)) {
    if (verified()) break;
    await tryUrl(link.url, "email_link");
  }

  if (!verified()) {
    const queries = buildSerperQueries(app.company, app.role, evidence.requisitionId);
    const alreadyCounted = usage.jobKeys.includes(app.key);
    if (!serperClient.isConfigured()) notFoundReason = "serper_not_configured";
    else if (queries.length === 0) notFoundReason = "no_search_terms";
    else if (!alreadyCounted && usage.jobKeys.length >= usage.cap) notFoundReason = "serper_cap_reached";
    else {
      if (!alreadyCounted) usage.jobKeys.push(app.key);
      for (const query of queries) {
        if (verified()) break;
        serperQueries += 1;
        let results: SerperResult[] = [];
        try {
          results = await serperClient.search(query);
        } catch (error) {
          attempts.push({ url: `serper:${query}`, source: "serper", ok: false, reason: describeError(error) });
          continue;
        }
        for (const url of rankSerperResults(results).slice(0, MAX_SERPER_CANDIDATES)) {
          if (verified()) break;
          await tryUrl(url, "serper");
        }
      }
      usage.queries += serperQueries;
      await serperUsageRepository.record(app.key, serperQueries);
      if (!best) notFoundReason = "serper_no_results";
    }
  }

  const now = new Date().toISOString();
  const base: ApplicationEvaluation = {
    key: app.key,
    company: app.company,
    role: app.role,
    appliedAt: app.appliedAt,
    requisitionId: evidence.requisitionId,
    recovery: { status: "not_found", attempts, serperQueries },
    outcome: buildOutcome(app),
    createdAt: now,
    updatedAt: now,
  };

  const chosen = best as Candidate | undefined;
  if (!chosen) {
    const failedOnly = fetchErrors > 0 && notFoundReason !== "serper_cap_reached";
    base.recovery.status = failedOnly ? "fetch_failed" : "not_found";
    base.recovery.reason =
      notFoundReason ?? (evidence.jobLinks.length || evidence.inlineJd ? "no_usable_posting" : "no_email_evidence");
    return { evaluation: base, triaged: false };
  }

  base.recovery.source = chosen.source;
  base.recovery.url = chosen.posting.url || undefined;
  base.recovery.match = { level: chosen.match.level, signals: chosen.match.signals };
  base.jd = {
    text: chosen.posting.text,
    textHash: computeJdTextHash(chosen.posting.text),
    title: chosen.posting.title,
    company: chosen.posting.company,
    datePosted: chosen.posting.datePosted,
  };

  if (!isScoreable(chosen.match.level)) {
    base.recovery.status = "unverified";
    base.recovery.reason = notFoundReason;
    return { evaluation: base, triaged: false };
  }

  try {
    const job = await scoreBlind(chosen.posting, app.company);
    base.recovery.status = "scored";
    base.fit = {
      total: job.score.total,
      recommendation: job.recommendation,
      recommendedResume: job.recommendedResume,
      scoredAt: new Date().toISOString(),
      promptVersion: SCORER_VERSION,
    };
    base.outcomeAtScoring = app.status;
  } catch (error) {
    base.recovery.status = "fetch_failed";
    base.recovery.reason = `triage_failed: ${describeError(error)}`;
  }
  return { evaluation: base, triaged: true };
};

/** Keep stored outcomes in step with Gmail; never re-scores. */
export const refreshOutcomes = async (
  apps: GmailApplication[],
  existing: Map<string, ApplicationEvaluation>,
): Promise<number> => {
  let updated = 0;
  for (const app of apps) {
    const evaluation = existing.get(app.key);
    if (!evaluation) continue;
    const outcome = buildOutcome(app);
    if (evaluation.outcome.status === outcome.status && evaluation.outcome.updatedAt === outcome.updatedAt) continue;
    await evaluationsRepository.updateOutcome(app.key, outcome);
    evaluation.outcome = outcome;
    updated += 1;
  }
  return updated;
};

export type RecoveryRunState = {
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  processed: number;
  scored: number;
  error?: string;
};

const state: RecoveryRunState = { running: false, processed: 0, scored: 0 };

export const getRecoveryRunState = (): RecoveryRunState => ({ ...state });

const newestFirst = (apps: GmailApplication[]) => [...apps].sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));

export const pendingApplications = (
  apps: GmailApplication[],
  existing: Map<string, ApplicationEvaluation>,
): GmailApplication[] => newestFirst(apps).filter((a) => needsRecovery(existing.get(a.key)));

/** One pass over the window, newest applications first. */
export const runRecovery = async (
  days: number,
  maxPerRun = env.jdRecoveryMaxPerRun,
): Promise<{ processed: number; scored: number }> => {
  const apps = await getGmailApplications(days);
  const existing = await evaluationsRepository.findByKeys(apps.map((a) => a.key));
  await refreshOutcomes(apps, existing);
  const todo = pendingApplications(apps, existing).slice(0, maxPerRun * MAX_PROCESSED_PER_RUN_FACTOR);
  const usage = await serperUsageRepository.get();

  let processed = 0;
  let triaged = 0;
  let scored = 0;
  for (const app of todo) {
    if (triaged >= maxPerRun) break;
    const result = await recoverApplication(app, usage);
    await evaluationsRepository.upsert(result.evaluation);
    processed += 1;
    if (result.triaged) triaged += 1;
    if (result.evaluation.recovery.status === "scored") scored += 1;
    state.processed = processed;
    state.scored = scored;
  }
  return { processed, scored };
};

/** Start a background run unless one is active. */
export const startRecoveryRun = async (days: number): Promise<{ queued: number; running: boolean; started: boolean }> => {
  const apps = await getGmailApplications(days);
  const existing = await evaluationsRepository.findByKeys(apps.map((a) => a.key));
  const queued = pendingApplications(apps, existing).length;
  if (state.running) return { queued, running: true, started: false };
  if (queued === 0) return { queued, running: false, started: false };

  Object.assign(state, {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: undefined,
    processed: 0,
    scored: 0,
    error: undefined,
  });
  void runRecovery(days)
    .then((r) => logger.info("JD recovery run complete", { days, ...r }))
    .catch((error) => {
      state.error = error instanceof Error ? error.message : String(error);
      logger.error("JD recovery run failed", { message: state.error });
    })
    .finally(() => {
      state.running = false;
      state.finishedAt = new Date().toISOString();
    });
  return { queued, running: true, started: true };
};
