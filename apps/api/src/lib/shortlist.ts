import {
  FRESHNESS_TIER,
  SHORTLIST_FAVORABLE_POOL,
  SHORTLIST_MIN_FINAL,
  SHORTLIST_MIN_POOL,
  SHORTLIST_TAG,
} from "../config/shortlistPolicy.js";
import type { JobRecord, JobStatus } from "../types/job.js";
import {
  daysSinceTrackerActivity,
  hasReferralPath,
  resolveFreshnessTier,
  workflowStillShortlistEligible,
  type FreshnessTier,
} from "./trackerWorkflowFreshness.js";

export const SHORTLIST_ELIGIBLE_STATUSES: JobStatus[] = [
  "to_review",
  "applied",
  "interviewing",
  "assessment",
  "offer",
];

export const jobFinalScore = (job: JobRecord): number =>
  job.score.scoreDisplay?.final ?? job.score.total ?? 0;

export const jobHardGates = (job: JobRecord): string[] =>
  job.score.scoreDisplay?.hardGates ?? [];

export const jobPoolFriendliness = (job: JobRecord): number | undefined =>
  job.score.survivabilityBreakdown?.poolFriendliness;

export const qualifiesViaFinal = (job: JobRecord): boolean =>
  jobFinalScore(job) >= SHORTLIST_MIN_FINAL;

export const qualifiesViaFavorablePool = (job: JobRecord): boolean => {
  const pool = jobPoolFriendliness(job);
  return pool != null && pool >= SHORTLIST_FAVORABLE_POOL;
};

export const qualifiesViaReferral = (job: JobRecord): boolean => hasReferralPath(job);

/** Shortlist entry requires final score ≥ SHORTLIST_MIN_FINAL (78). Pool/referral affect sort/tags only. */
export const hasQualifyingShortlistSignal = (job: JobRecord): boolean => qualifiesViaFinal(job);

export const isFavorableShapeBestShot = (job: JobRecord): boolean =>
  qualifiesViaFavorablePool(job) || qualifiesViaReferral(job);

export const isHighFitCrowdedPool = (job: JobRecord): boolean => {
  if (!qualifiesViaFinal(job)) return false;
  if (qualifiesViaReferral(job)) return false;
  const pool = jobPoolFriendliness(job);
  return pool == null || pool < SHORTLIST_MIN_POOL;
};

export type ShortlistTag = (typeof SHORTLIST_TAG)[keyof typeof SHORTLIST_TAG];

export const resolveShortlistTag = (job: JobRecord): ShortlistTag | undefined => {
  const tier = resolveFreshnessTier(job);
  if (tier === "stale_referral") return SHORTLIST_TAG.staleReferralOpen;
  if (isHighFitCrowdedPool(job)) return SHORTLIST_TAG.highFitCrowdedPool;
  return undefined;
};

export const freshnessTierLabel = (tier: FreshnessTier | "stale"): string => {
  if (tier === "fresh") return FRESHNESS_TIER.fresh;
  if (tier === "aging") return FRESHNESS_TIER.aging;
  if (tier === "stale_referral") return FRESHNESS_TIER.staleReferral;
  return "stale";
};

export type ShortlistEvaluation = {
  onShortlist: boolean;
  tag?: ShortlistTag;
  freshnessTier: FreshnessTier | "stale";
  freshnessLabel: string;
  sortGroup: 0 | 1;
  /** Days since createdAt (apply date) — not employer posting age. */
  daysSinceActivity: number;
};

export const evaluateShortlist = (job: JobRecord, now: Date = new Date()): ShortlistEvaluation => {
  const days = daysSinceTrackerActivity(job, now);
  const freshnessTier = resolveFreshnessTier(job, now);
  const freshnessLabel = freshnessTierLabel(freshnessTier);
  const tag = resolveShortlistTag(job);

  const base = {
    freshnessTier,
    freshnessLabel,
    tag,
    daysSinceActivity: days,
    sortGroup: (isFavorableShapeBestShot(job) ? 0 : 1) as 0 | 1,
  };

  if (!SHORTLIST_ELIGIBLE_STATUSES.includes(job.status)) {
    return { ...base, onShortlist: false };
  }
  if (jobHardGates(job).length > 0) {
    return { ...base, onShortlist: false };
  }
  if (!workflowStillShortlistEligible(job, now)) {
    return { ...base, onShortlist: false, freshnessTier: "stale", freshnessLabel: "stale" };
  }
  if (!hasQualifyingShortlistSignal(job)) {
    return { ...base, onShortlist: false };
  }

  return { ...base, onShortlist: true };
};

/** Persisted tracker fields derived from live shortlist evaluation. */
export const shortlistTrackerFields = (
  job: JobRecord,
  now: Date = new Date(),
): Pick<JobRecord["tracker"], "shortlist" | "shortlistTag" | "freshnessTier"> => {
  const evaluation = evaluateShortlist(job, now);
  return {
    shortlist: evaluation.onShortlist,
    shortlistTag: evaluation.tag,
    freshnessTier: evaluation.freshnessLabel,
  };
};

export const liveShortlistEligible = (job: JobRecord, now?: Date): boolean =>
  evaluateShortlist(job, now).onShortlist;

/** @deprecated Prefer evaluateShortlist(job).onShortlist — kept for call-site migration. */
export const shouldShortlist = (job: JobRecord, now?: Date): boolean =>
  evaluateShortlist(job, now).onShortlist;

export const compareShortlistJobs = (a: JobRecord, b: JobRecord): number => {
  const ea = evaluateShortlist(a);
  const eb = evaluateShortlist(b);
  if (ea.sortGroup !== eb.sortGroup) return ea.sortGroup - eb.sortGroup;

  const finalDiff = jobFinalScore(b) - jobFinalScore(a);
  if (finalDiff !== 0) return finalDiff;

  return ea.daysSinceActivity - eb.daysSinceActivity;
};
