import type { TopJobRecord } from "../types/topJob";

/** User-selectable sort modes for the Top Jobs list. */
export type TopJobsSortMode = "composite" | "score" | "recency";

export const TOP_JOBS_SORT_LS_KEY = "topJobsSortMode";

/**
 * Minimum app score for Top Jobs storage (see TOP_JOBS_MIN_SCORE).
 * Replaces the generic 0.65 fit gate — nothing below this enters the list.
 */
export const TOP_JOBS_MIN_STORED_SCORE = 70;

/**
 * Normalized fit score (0.0–1.0) from triage total.
 * Top Jobs only stores scores >= 70, so effective range here is 0.70–1.0.
 */
export function fitScore(total: number): number {
  return Math.min(100, Math.max(0, total)) / 100;
}

/**
 * Stepwise recency multiplier based on ATS funnel research:
 * recruiters fill pipelines in ~48h; stale posts decay sharply in value.
 */
export function recencyMultiplier(postedAt: string, nowMs = Date.now()): number {
  const postedMs = new Date(postedAt).getTime();
  if (Number.isNaN(postedMs)) return 0.1;

  const ageMs = Math.max(0, nowMs - postedMs);
  const ageHours = ageMs / (60 * 60 * 1000);
  const ageDays = ageHours / 24;

  if (ageHours <= 12) return 1.0;
  if (ageHours <= 24) return 0.85;
  if (ageHours <= 48) return 0.6;
  if (ageDays <= 5) return 0.3;
  return 0.1;
}

/**
 * Default apply-priority rank: Fit × Recency (multiplicative, not additive).
 *
 * Fit is the gatekeeper at ingest (>= 70). Recency then scales how urgently
 * a viable match is worth applying to — a 95-fit job at 6 days scores ~0.095.
 */
export function priorityRankScore(job: TopJobRecord, nowMs = Date.now()): number {
  return fitScore(job.score.total) * recencyMultiplier(job.sourcePostedAt, nowMs);
}

/** @deprecated Use priorityRankScore — kept for clarity in sort mode naming. */
export const compositeRankScore = priorityRankScore;

export function sortTopJobs(
  jobs: TopJobRecord[],
  mode: TopJobsSortMode,
  nowMs = Date.now(),
): TopJobRecord[] {
  const copy = [...jobs];
  switch (mode) {
    case "score":
      copy.sort((a, b) => b.score.total - a.score.total || b.sourcePostedAt.localeCompare(a.sourcePostedAt));
      break;
    case "recency":
      copy.sort((a, b) => b.sourcePostedAt.localeCompare(a.sourcePostedAt) || b.score.total - a.score.total);
      break;
    case "composite":
    default:
      copy.sort(
        (a, b) =>
          priorityRankScore(b, nowMs) - priorityRankScore(a, nowMs) ||
          b.score.total - a.score.total ||
          b.sourcePostedAt.localeCompare(a.sourcePostedAt),
      );
      break;
  }
  return copy;
}

export function readTopJobsSortMode(): TopJobsSortMode {
  if (typeof localStorage === "undefined") return "composite";
  const stored = localStorage.getItem(TOP_JOBS_SORT_LS_KEY);
  if (stored === "score" || stored === "recency" || stored === "composite") return stored;
  return "composite";
}

export function writeTopJobsSortMode(mode: TopJobsSortMode): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(TOP_JOBS_SORT_LS_KEY, mode);
}

export const TOP_JOBS_SORT_LABELS: Record<TopJobsSortMode, string> = {
  composite: "Best to apply (recommended)",
  score: "Highest score",
  recency: "Most recent",
};

/** Human-readable recency tier for optional UI tooltips. */
export function recencyTierLabel(postedAt: string, nowMs = Date.now()): string {
  const m = recencyMultiplier(postedAt, nowMs);
  if (m >= 1) return "0–12h (max priority)";
  if (m >= 0.85) return "12–24h (high)";
  if (m >= 0.6) return "24–48h (average)";
  if (m >= 0.3) return "2–5d (low)";
  return "5d+ (ghost territory)";
}

/** Native title tooltip for Posted cells — explains recency tier in default sort. */
export function postedRecencyTooltip(postedAt: string, nowMs = Date.now()): string {
  const mult = recencyMultiplier(postedAt, nowMs);
  return `Recency tier: ${recencyTierLabel(postedAt, nowMs)} (×${mult.toFixed(2)} in recommended sort)`;
}
