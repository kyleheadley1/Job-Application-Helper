import { APPLIED_SILENCE_DAYS } from "../config/shortlistPolicy.js";
import type { JobRecord, JobStatus } from "../types/job.js";
import { daysBetween } from "./dateUtils.js";

const ADVANCED_APPLICATION_STATUSES = new Set<JobStatus>([
  "interviewing",
  "assessment",
  "offer",
]);

export const appliedAtIso = (job: JobRecord): string => {
  const times = (job.statusHistory ?? [])
    .filter((h) => h.toStatus === "applied")
    .map((h) => new Date(h.createdAt).getTime())
    .filter((t) => Number.isFinite(t));
  if (!times.length) return "";
  return new Date(Math.min(...times)).toISOString();
};

export const daysSinceApplied = (job: JobRecord, now: Date = new Date()): number | null => {
  const iso = appliedAtIso(job);
  if (!iso) return null;
  return daysBetween(iso, now);
};

/** True when the candidate has progressed beyond a silent applied state. */
export const hasLoggedApplicationProgress = (job: JobRecord): boolean => {
  if (ADVANCED_APPLICATION_STATUSES.has(job.status)) return true;
  return (job.statusHistory ?? []).some(
    (h) =>
      h.fromStatus === "applied" &&
      h.toStatus != null &&
      ADVANCED_APPLICATION_STATUSES.has(h.toStatus),
  );
};

export const isInFlightApplication = (job: JobRecord, now: Date = new Date()): boolean => {
  if (job.status !== "applied") return false;
  if (hasLoggedApplicationProgress(job)) return false;
  const days = daysSinceApplied(job, now);
  if (days == null) return true;
  return days <= APPLIED_SILENCE_DAYS;
};

export type AutoArchiveCandidate = {
  jobId: string;
  daysSinceApplied: number;
  priorStatus: JobStatus;
};

export const shouldAutoArchiveAppliedJob = (
  job: JobRecord,
  now: Date = new Date(),
): AutoArchiveCandidate | null => {
  if (job.status !== "applied") return null;
  if (hasLoggedApplicationProgress(job)) return null;
  const days = daysSinceApplied(job, now);
  if (days == null || days <= APPLIED_SILENCE_DAYS) return null;
  return { jobId: job.id, daysSinceApplied: days, priorStatus: job.status };
};

export const autoArchiveNote = (daysSinceApplied: number): string =>
  `auto-archive: ${daysSinceApplied}+ days no response (${APPLIED_SILENCE_DAYS}+ day silence threshold)`;
