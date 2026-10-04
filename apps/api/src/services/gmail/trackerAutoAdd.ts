import { randomUUID } from "node:crypto";
import { computeSalaryAsk } from "../../agents/jobAgent/salaryAsk.js";
import { getTrackerColor } from "../../config/scoringPolicy.js";
import { logger } from "../../lib/logger.js";
import { buildTrackerSpreadsheetFromJob } from "../../tracker/canonicalSpreadsheet.js";
import type { JobRecord, JobStatus, StatusHistoryRecord } from "../../types/job.js";
import type { Recommendation } from "../../types/scoring.js";
import { jobsRepository } from "../jobs/jobs.repository.js";
import { getGmailApplications, STATUS_TO_JOB_STATUS, type GmailApplication } from "./gmailApplications.js";
import { evaluationsRepository, type ApplicationEvaluation } from "./jdRecovery/evaluations.repository.js";

/** Every stored application email is considered, not just the dashboard window. */
const AUTO_ADD_LOOKBACK_DAYS = 365;

const RECOMMENDATIONS: Recommendation[] = ["strong_apply", "apply", "stretch", "weak"];

export const isAutoAddCandidate = (app: GmailApplication, evaluation: ApplicationEvaluation | undefined): boolean =>
  Boolean(evaluation?.fit?.detail) && !evaluation?.trackerAutoAddedAt && !app.trackerJobId;

const historyFor = (app: GmailApplication, evaluation: ApplicationEvaluation, jobId: string): StatusHistoryRecord[] => {
  const out: StatusHistoryRecord[] = [
    { id: randomUUID(), jobId, toStatus: "applied", note: "Applied (from Gmail)", createdAt: app.appliedAt },
  ];
  let prev: JobStatus = "applied";
  const entries = [...evaluation.outcome.history].sort((a, b) => a.at.localeCompare(b.at));
  for (const entry of entries) {
    const to = STATUS_TO_JOB_STATUS[entry.status];
    if (to === prev || entry.at < app.appliedAt) continue;
    out.push({ id: randomUUID(), jobId, fromStatus: prev, toStatus: to, note: "From Gmail", createdAt: entry.at });
    prev = to;
  }
  const current = STATUS_TO_JOB_STATUS[app.status];
  if (current !== prev) {
    out.push({ id: randomUUID(), jobId, fromStatus: prev, toStatus: current, note: "From Gmail", createdAt: app.lastUpdateAt });
  }
  return out;
};

/** A tracker row built from the stored score; the JD is never scored again. */
export const buildTrackerJob = (
  app: GmailApplication,
  evaluation: ApplicationEvaluation,
  now = new Date().toISOString(),
): JobRecord | null => {
  const fit = evaluation.fit;
  const detail = fit?.detail;
  if (!fit || !detail) return null;
  const id = randomUUID();
  const recommendation = (RECOMMENDATIONS as string[]).includes(detail.recommendation)
    ? (detail.recommendation as Recommendation)
    : "weak";
  const status = STATUS_TO_JOB_STATUS[app.status];
  const extracted = {
    ...detail.extracted,
    rawText: evaluation.jd?.text,
    url: evaluation.recovery.url ?? detail.extracted.url,
  };
  const job: JobRecord = {
    id,
    extracted,
    rules: detail.rules,
    score: detail.score,
    recommendation,
    salaryAsk: computeSalaryAsk({ extracted, score: detail.score, recommendation, rules: detail.rules }),
    recommendedResume: detail.recommendedResume,
    resumeRationale: detail.resumeRationale,
    topMatch: detail.topMatch,
    mainRisk: detail.mainRisk,
    rationale: detail.rationale,
    risks: detail.risks,
    generated: {},
    tracker: {
      recommendedAction: "Added from Gmail application email",
      statusOutcome: status,
      color: getTrackerColor(status, detail.score.total),
      shortlist: false,
      appliedAt: app.appliedAt,
      source: "gmail",
      gmailKey: app.key,
    },
    status,
    createdAt: now,
    updatedAt: now,
    scoreHistory: [{ scoredAt: fit.scoredAt, score: detail.score, recommendation }],
    statusHistory: historyFor(app, evaluation, id),
  };
  job.trackerSpreadsheet = buildTrackerSpreadsheetFromJob(job);
  return job;
};

export type AutoAddDeps = {
  loadApplications: () => Promise<GmailApplication[]>;
  loadEvaluations: (keys: string[]) => Promise<Map<string, ApplicationEvaluation>>;
  save: (job: JobRecord) => Promise<void>;
  markAdded: (key: string, jobId: string) => Promise<void>;
};

const defaultDeps: AutoAddDeps = {
  loadApplications: () => getGmailApplications(AUTO_ADD_LOOKBACK_DAYS),
  loadEvaluations: (keys) => evaluationsRepository.findByKeys(keys),
  save: async (job) => {
    await jobsRepository.saveTriage(job);
  },
  markAdded: (key, jobId) => evaluationsRepository.markTrackerAdded(key, jobId),
};

let running: Promise<{ added: number }> | null = null;

/** Add scored Gmail applications that have no tracker row (same company, similar role, applied within 21 days). */
export const addMissingApplicationsToTracker = (deps: AutoAddDeps = defaultDeps): Promise<{ added: number }> => {
  running ??= (async () => {
    const apps = await deps.loadApplications();
    const evaluations = await deps.loadEvaluations(apps.map((a) => a.key));
    let added = 0;
    for (const app of apps) {
      const evaluation = evaluations.get(app.key);
      if (!isAutoAddCandidate(app, evaluation)) continue;
      const job = buildTrackerJob(app, evaluation!);
      if (!job) continue;
      await deps.save(job);
      await deps.markAdded(app.key, job.id);
      added += 1;
    }
    if (added) logger.info("Added Gmail applications to the tracker", { added });
    return { added };
  })().finally(() => {
    running = null;
  });
  return running;
};

/** For hooks after a sync or a new score; a failure here never fails the caller. */
export const addMissingApplicationsQuietly = async (): Promise<number> => {
  try {
    return (await addMissingApplicationsToTracker()).added;
  } catch (error) {
    logger.warn("Tracker auto-add failed", { message: error instanceof Error ? error.message : String(error) });
    return 0;
  }
};
