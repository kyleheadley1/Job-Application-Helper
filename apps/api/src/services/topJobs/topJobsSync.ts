import { randomUUID } from "node:crypto";
import { computeSalaryAsk } from "../../agents/jobAgent/salaryAsk.js";
import { triageJob } from "../../agents/jobAgent/orchestrator.js";
import { applyCompanyPresentation } from "../../tools/companyExtraction.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import type { DiscoveredListing, TopJobRecord, TopJobsSyncStats } from "../../types/topJob.js";
import { fetchDiscoveredListings } from "./discoveryProvider.js";
import { preFilterListings, sortListingsByPostedDesc } from "./preFilter.js";
import { topJobsRepository } from "./topJobs.repository.js";
import { jobsRepository } from "../jobs/jobs.repository.js";
import type { JobRecord } from "../../types/job.js";
import { buildTrackerSpreadsheetFromJob } from "../../tracker/canonicalSpreadsheet.js";

export class TopJobsSyncCooldownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopJobsSyncCooldownError";
  }
}

const dedupeListings = (listings: DiscoveredListing[]): DiscoveredListing[] => {
  const seen = new Set<string>();
  const out: DiscoveredListing[] = [];
  for (const l of listings) {
    const key = l.applyUrl.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
};

const listingToTopJob = (
  listing: DiscoveredListing,
  job: JobRecord,
  now: string,
): TopJobRecord => ({
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

export const runTopJobsSync = async (options?: { manual?: boolean }): Promise<TopJobsSyncStats> => {
  const manual = options?.manual ?? false;

  if (manual) {
    const status = await topJobsRepository.getSyncStatus();
    if (!status.canManualRefresh) {
      throw new TopJobsSyncCooldownError(
        `Manual refresh available at ${status.manualRefreshAvailableAt ?? "later"}`,
      );
    }
  }

  const meta = await topJobsRepository.getSyncMeta();
  const stats: TopJobsSyncStats = {
    fetched: 0,
    preFiltered: 0,
    triaged: 0,
    stored: 0,
    skippedExisting: 0,
    source: "jobsbase",
    jsearchCreditsUsed: 0,
  };

  try {
    const fetchResult = await fetchDiscoveredListings({
      jsearchCreditsUsedThisMonth: meta.jsearchCreditsUsedThisMonth,
    });
    stats.jsearchCreditsUsed = fetchResult.jsearchCreditsUsed;
    stats.source = fetchResult.source;

    const sorted = sortListingsByPostedDesc(dedupeListings(fetchResult.listings));
    stats.fetched = sorted.length;

    const survivors = preFilterListings(sorted);
    stats.preFiltered = survivors.length;

    const maxTriages = env.topJobsMaxTriagesPerSync;
    let triageCount = 0;
    const now = new Date().toISOString();

    for (const listing of survivors) {
      if (triageCount >= maxTriages) break;

      const existing =
        (await topJobsRepository.findBySourceKey(listing.source, listing.externalId)) ??
        (await topJobsRepository.findByApplyUrl(listing.applyUrl));

      if (
        existing &&
        existing.sourceUpdatedAt === listing.sourceUpdatedAt &&
        existing.score.total >= env.topJobsMinScore
      ) {
        stats.skippedExisting += 1;
        continue;
      }

      const rawJob = await triageJob({
        rawText: listing.description,
        companyHint: listing.company,
        fullPrep: false,
      });
      rawJob.extracted.url = listing.applyUrl;
      rawJob.extracted.rawText = listing.description;
      if (!rawJob.extracted.title?.trim() || rawJob.extracted.title === "Unknown Title") {
        rawJob.extracted.title = listing.title;
      }
      if (!rawJob.extracted.company?.trim() || rawJob.extracted.company === "Unknown Company") {
        rawJob.extracted.company = listing.company;
      }
      rawJob.extracted = applyCompanyPresentation(
        {
          ...rawJob.extracted,
          company: rawJob.extracted.company,
          rawText: listing.description,
        },
        listing.company,
      );

      triageCount += 1;
      stats.triaged += 1;

      if (rawJob.score.total < env.topJobsMinScore) continue;

      const record = listingToTopJob(listing, rawJob, now);
      record.id = existing?.id ?? topJobsRepository.createId();
      await topJobsRepository.upsert(record);
      stats.stored += 1;
    }

    await topJobsRepository.recordSyncResult({
      stats,
      manual,
      jsearchCreditsDelta: stats.jsearchCreditsUsed,
      error: null,
    });

    logger.info("Top jobs sync completed", stats);
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await topJobsRepository.recordSyncResult({
      stats,
      manual,
      jsearchCreditsDelta: stats.jsearchCreditsUsed,
      error: message,
    });
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
    recommendedResume: topJob.recommendedResume ?? "EARLY_CAREER",
    resumeRationale: topJob.resumeRationale ?? [],
    topMatch: topJob.topMatch,
    mainRisk: topJob.mainRisk,
    rationale: topJob.rationale,
    risks: [],
    generated: {},
    tracker: {
      priority: topJob.score.total >= 78 ? "high" : "medium",
      recommendedAction: "Review from Top Jobs",
      statusOutcome: topJob.recommendation,
      shortlist: topJob.score.total >= 78,
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
  job.trackerSpreadsheet = buildTrackerSpreadsheetFromJob(job);
  await jobsRepository.saveTriage(job);
  await topJobsRepository.markPromoted(topJobId, job.id);
  return job;
};
