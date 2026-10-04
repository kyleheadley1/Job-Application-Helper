import { randomUUID } from "node:crypto";
import { computeSalaryAsk } from "../../agents/jobAgent/salaryAsk.js";
import { triageJob } from "../../agents/jobAgent/orchestrator.js";
import { applyCompanyPresentation } from "../../tools/companyExtraction.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { shortlistTrackerFields } from "../../lib/shortlist.js";
import type { DiscoveredListing, TopJobRecord, TopJobsSyncStats } from "../../types/topJob.js";
import { gmailAuth } from "../gmail/gmailAuth.js";
import { normalizeCompany, roleSimilarity } from "../gmail/gmailApplications.js";
import { evaluationsRepository } from "../gmail/jdRecovery/evaluations.repository.js";
import { withLlmContext } from "../llm/llmUsage.js";
import { preFilterListing, preFilterTitle } from "./preFilter.js";
import { topJobsRepository } from "./topJobs.repository.js";
import { jobsRepository } from "../jobs/jobs.repository.js";
import type { JobRecord } from "../../types/job.js";
import { buildTrackerSpreadsheetFromJob } from "../../tracker/canonicalSpreadsheet.js";
import { ingestAlertEmails } from "./alertEmails.js";
import { resolveAlertJd, type AlertJd } from "./alertJd.js";
import { alertListingsRepository, type AlertListingDoc, type AlertListingStatus } from "./alertListings.repository.js";

export class TopJobsSyncCooldownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopJobsSyncCooldownError";
  }
}

export class TopJobsGmailRequiredError extends Error {
  constructor() {
    super("Connect Gmail on the Dashboard so Top Jobs can read your job-alert emails.");
    this.name = "TopJobsGmailRequiredError";
  }
}

export const emptySyncStats = (): TopJobsSyncStats => ({
  alertEmails: 0,
  listingsParsed: 0,
  fetched: 0,
  preFiltered: 0,
  triaged: 0,
  stored: 0,
  skippedExisting: 0,
  belowMinScore: 0,
  jdUnavailable: 0,
  serperQueries: 0,
  bySource: {},
});

/** Same employer and close enough title to be the role already seen or applied to. */
const KNOWN_ROLE_SIMILARITY = 0.8;

export type KnownRole = { company: string; title: string };

export const isKnownRole = (company: string, title: string, known: KnownRole[]): boolean => {
  const c = normalizeCompany(company);
  if (!c) return false;
  return known.some((k) => normalizeCompany(k.company) === c && roleSimilarity(title, k.title) >= KNOWN_ROLE_SIMILARITY);
};

const listingToTopJob = (listing: DiscoveredListing, job: JobRecord, now: string): TopJobRecord => ({
  id: randomUUID(),
  source: listing.source,
  externalId: listing.externalId,
  applyUrl: listing.applyUrl,
  sourcePostedAt: listing.sourcePostedAt,
  sourceUpdatedAt: listing.sourceUpdatedAt,
  lastSyncedAt: now,
  extracted: {
    ...job.extracted,
    url: listing.applyUrl,
    rawText: listing.description,
  },
  rules: job.rules,
  score: job.score,
  recommendation: job.recommendation,
  topMatch: job.topMatch,
  mainRisk: job.mainRisk,
  rationale: job.rationale,
  recommendedResume: job.recommendedResume,
  resumeRationale: job.resumeRationale,
});

export const toDiscoveredListing = (
  listing: AlertListingDoc,
  jd: Extract<AlertJd, { ok: true }>,
): DiscoveredListing => {
  const alertLink = listing.links.find((l) => l.url === jd.alertUrl);
  return {
    source: `${jd.platform}_alert`,
    externalId: alertLink?.externalId ?? listing._id,
    company: listing.company,
    title: listing.title,
    description: jd.posting.text,
    applyUrl: jd.viaSearch || !jd.alertUrl ? jd.posting.url : jd.alertUrl,
    location: listing.location ?? undefined,
    remote: /\bremote\b/i.test(listing.location ?? ""),
    sourcePostedAt: listing.firstSeenAt,
    sourceUpdatedAt: listing.lastSeenAt,
  };
};

export type ProcessDeps = {
  known: KnownRole[];
  maxTriages: number;
  minScore: number;
  resolveJd: (listing: AlertListingDoc) => Promise<AlertJd>;
  triage: (listing: DiscoveredListing) => Promise<JobRecord>;
  store: (listing: DiscoveredListing, job: JobRecord) => Promise<string>;
  setOutcome: (
    key: string,
    outcome: { status: Exclude<AlertListingStatus, "pending">; reason?: string; topJobId?: string },
  ) => Promise<void>;
};

/**
 * Cheapest checks first: title filter and de-duplication cost nothing, the JD fetch may cost a
 * search credit, and scoring is the only paid step. Roles left once the cap is hit stay pending.
 */
export const processAlertListings = async (
  pending: AlertListingDoc[],
  deps: ProcessDeps,
  stats: TopJobsSyncStats,
): Promise<void> => {
  for (const listing of pending) {
    if (stats.triaged >= deps.maxTriages) break;
    stats.fetched += 1;

    const titleCheck = preFilterTitle(listing.title);
    if (!titleCheck.pass) {
      await deps.setOutcome(listing._id, { status: "filtered", reason: titleCheck.reason });
      continue;
    }
    if (isKnownRole(listing.company, listing.title, deps.known)) {
      stats.skippedExisting += 1;
      await deps.setOutcome(listing._id, { status: "duplicate" });
      continue;
    }

    const jd = await deps.resolveJd(listing);
    stats.serperQueries += jd.serperQueries;
    if (!jd.ok) {
      stats.jdUnavailable += 1;
      await deps.setOutcome(listing._id, { status: "jd_unavailable", reason: jd.reason });
      continue;
    }

    const discovered = toDiscoveredListing(listing, jd);
    const full = preFilterListing(discovered);
    if (!full.pass) {
      await deps.setOutcome(listing._id, { status: "filtered", reason: full.reason });
      continue;
    }
    stats.preFiltered += 1;

    const job = await deps.triage(discovered);
    stats.triaged += 1;
    deps.known.push({ company: listing.company, title: listing.title });
    if (job.score.total < deps.minScore) {
      stats.belowMinScore += 1;
      await deps.setOutcome(listing._id, { status: "below_min", reason: String(job.score.total) });
      continue;
    }
    const topJobId = await deps.store(discovered, job);
    stats.stored += 1;
    stats.bySource[jd.platform] = (stats.bySource[jd.platform] ?? 0) + 1;
    await deps.setOutcome(listing._id, { status: "stored", topJobId });
  }
};

const triageListing = async (listing: DiscoveredListing): Promise<JobRecord> => {
  const rawJob = await withLlmContext({ feature: "top_jobs", key: listing.externalId }, () =>
    triageJob({ rawText: listing.description, companyHint: listing.company, fullPrep: false }),
  );
  rawJob.extracted.url = listing.applyUrl;
  rawJob.extracted.rawText = listing.description;
  if (!rawJob.extracted.title?.trim() || rawJob.extracted.title === "Unknown Title") {
    rawJob.extracted.title = listing.title;
  }
  if (!rawJob.extracted.company?.trim() || rawJob.extracted.company === "Unknown Company") {
    rawJob.extracted.company = listing.company;
  }
  rawJob.extracted = applyCompanyPresentation(
    { ...rawJob.extracted, company: rawJob.extracted.company, rawText: listing.description },
    listing.company,
  );
  return rawJob;
};

const storeTopJob = async (listing: DiscoveredListing, job: JobRecord): Promise<string> => {
  const existing =
    (await topJobsRepository.findBySourceKey(listing.source, listing.externalId)) ??
    (await topJobsRepository.findByApplyUrl(listing.applyUrl));
  const record = listingToTopJob(listing, job, new Date().toISOString());
  record.id = existing?.id ?? topJobsRepository.createId();
  await topJobsRepository.upsert(record);
  return record.id;
};

const loadKnownRoles = async (): Promise<KnownRole[]> => {
  const [topJobs, tracker, evaluations] = await Promise.all([
    topJobsRepository.list(0),
    jobsRepository.list(),
    evaluationsRepository.listSince(new Date(0).toISOString()),
  ]);
  return [
    ...topJobs.map((j) => ({ company: j.extracted.company ?? "", title: j.extracted.title ?? "" })),
    ...tracker.items.map((j) => ({ company: j.extracted.company ?? "", title: j.extracted.title ?? "" })),
    ...evaluations.map((e) => ({ company: e.company, title: e.role ?? e.recovery.recoveredRole ?? "" })),
  ].filter((k) => k.company && k.title);
};

export const listingWindowStart = (now = Date.now()): string =>
  new Date(now - env.topJobsListingMaxAgeDays * 86_400_000).toISOString();

let syncInProgress = false;

export const runTopJobsSync = async (options?: {
  manual?: boolean;
  skipConcurrencyGuard?: boolean;
}): Promise<TopJobsSyncStats> => {
  const manual = options?.manual ?? false;

  if (!options?.skipConcurrencyGuard && syncInProgress) {
    logger.info("Top jobs sync skipped — already in progress");
    const meta = await topJobsRepository.getSyncMeta();
    return meta.lastSyncStats ?? emptySyncStats();
  }

  if (!options?.skipConcurrencyGuard) syncInProgress = true;
  try {
    return await runTopJobsSyncInner(manual);
  } finally {
    if (!options?.skipConcurrencyGuard) syncInProgress = false;
  }
};

const runTopJobsSyncInner = async (manual: boolean): Promise<TopJobsSyncStats> => {
  if (manual) {
    const status = await topJobsRepository.getSyncStatus();
    if (!status.canManualRefresh) {
      throw new TopJobsSyncCooldownError(
        `Manual refresh available at ${status.manualRefreshAvailableAt ?? "later"}`,
      );
    }
  }

  const gmail = await gmailAuth.getStatus();
  if (!gmail.configured || !gmail.connected) throw new TopJobsGmailRequiredError();

  const stats = emptySyncStats();
  try {
    const ingest = await ingestAlertEmails();
    stats.alertEmails = ingest.alertEmails;
    stats.listingsParsed = ingest.listingsParsed;

    const pending = await alertListingsRepository.listPending(listingWindowStart());
    await processAlertListings(
      pending,
      {
        known: await loadKnownRoles(),
        maxTriages: env.topJobsMaxTriagesPerSync,
        minScore: env.topJobsMinScore,
        resolveJd: (l) => resolveAlertJd(l),
        triage: triageListing,
        store: storeTopJob,
        setOutcome: (key, outcome) => alertListingsRepository.setOutcome(key, outcome),
      },
      stats,
    );

    await topJobsRepository.recordSyncResult({ stats, manual, error: null });
    logger.info("Top jobs sync completed", stats);
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await topJobsRepository.recordSyncResult({ stats, manual, error: message });
    throw error;
  }
};

export const promoteTopJobToTracker = async (topJobId: string): Promise<JobRecord> => {
  const topJob = await topJobsRepository.getById(topJobId);
  if (!topJob) throw new Error("Top job not found");

  if (topJob.promotedToJobId) {
    const existing = await jobsRepository.getById(topJob.promotedToJobId);
    if (existing) return existing;
  }

  const now = new Date().toISOString();
  const job: JobRecord = {
    id: randomUUID(),
    extracted: topJob.extracted,
    rules: topJob.rules,
    score: topJob.score,
    recommendation: topJob.recommendation,
    salaryAsk: computeSalaryAsk({
      extracted: topJob.extracted,
      score: topJob.score,
      recommendation: topJob.recommendation,
      rules: topJob.rules,
    }),
    recommendedResume: topJob.recommendedResume ?? "BASE",
    resumeRationale: topJob.resumeRationale ?? [],
    topMatch: topJob.topMatch,
    mainRisk: topJob.mainRisk,
    rationale: topJob.rationale,
    risks: [],
    generated: {},
    tracker: {
      priority: topJob.score.total >= env.topJobsMinScore ? "high" : "medium",
      recommendedAction: "Review from Top Jobs",
      statusOutcome: topJob.recommendation,
      color: "green",
    },
    status: "to_review",
    createdAt: now,
    updatedAt: now,
    scoreHistory: [
      {
        scoredAt: now,
        score: topJob.score,
        recommendation: topJob.recommendation,
      },
    ],
  };
  job.tracker = {
    ...job.tracker,
    ...shortlistTrackerFields(job),
  };
  job.trackerSpreadsheet = buildTrackerSpreadsheetFromJob(job);
  await jobsRepository.saveTriage(job);
  await topJobsRepository.markPromoted(topJobId, job.id);
  return job;
};
