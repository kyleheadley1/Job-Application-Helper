import {
  POSTING_FRESH_DAYS,
  POSTING_STALE_DAYS,
  REFERRAL_STALE_EXTENSION_DAYS,
} from "../config/shortlistPolicy.js";
import type { JobRecord } from "../types/job.js";
import { daysBetween } from "./dateUtils.js";
import { resolveTrackerActivityDate } from "./trackerWorkflowDate.js";

export { resolveTrackerActivityDate } from "./trackerWorkflowDate.js";

export const daysSinceTrackerActivity = (job: JobRecord, now: Date = new Date()): number =>
  daysBetween(resolveTrackerActivityDate(job), now);

export const hasReferralPath = (job: JobRecord): boolean => job.referralPathwayAvailable === true;

export const workflowStaleCutoffDays = (job: JobRecord): number =>
  hasReferralPath(job)
    ? POSTING_STALE_DAYS + REFERRAL_STALE_EXTENSION_DAYS
    : POSTING_STALE_DAYS;

export type FreshnessTier = "fresh" | "aging" | "stale_referral";

export const resolveFreshnessTier = (
  job: JobRecord,
  now: Date = new Date(),
): FreshnessTier | "stale" => {
  const days = daysSinceTrackerActivity(job, now);
  if (days <= POSTING_FRESH_DAYS) return "fresh";
  if (days <= POSTING_STALE_DAYS) return "aging";
  if (hasReferralPath(job) && days <= workflowStaleCutoffDays(job)) return "stale_referral";
  return "stale";
};

/** Stale = applied long ago with no movement — drop from shortlist. */
export const workflowStillShortlistEligible = (job: JobRecord, now: Date = new Date()): boolean =>
  daysSinceTrackerActivity(job, now) <= workflowStaleCutoffDays(job);
