import type { ExtractedJobData } from "../types/job.js";
import type { Recommendation, RuleEvaluation, ScoreBand } from "../types/scoring.js";
import {
  extractCompanyEmployeeCount,
  isLargeEmployerByHeadcount,
} from "./companyEmployeeCount.js";
import { computePoolFriendliness } from "./poolFriendliness.js";
import { FRESH_POST_RE } from "./poolCompetitiveness.js";
import { normalizeText } from "./text.js";

export const APPLY_NOW_URGENCY_MESSAGE =
  "submit default resume immediately, tailor after.";

export const APPLY_NOW_MAX_HOURS = 6;
export const APPLY_NOW_SMALL_EMPLOYER_MAX = 200;
/** Relative JD chrome is only trusted when the job record itself is this fresh. */
export const RELATIVE_CHROME_MAX_RECORD_AGE_HOURS = 12;

const RELATIVE_HOURS_RE =
  /\b(?:posted\s+)?(\d+)\s*(minutes?|mins?|hours?|hrs?)\s+ago\b/i;
const RELATIVE_DAYS_RE = /\b(?:posted\s+)?(\d+)\s*days?\s+ago\b/i;
const JUST_POSTED_RE = /\b(posted\s+(today|just\s+now)|just\s+posted|newly\s+posted)\b/i;

export type PostedAtFreshnessInput = {
  postedAt?: string;
  rawText?: string;
  trackerPostedAt?: string;
  /** JobRecord.createdAt — required to trust frozen relative chrome in rawText. */
  jobCreatedAt?: string;
};

const hoursSinceIso = (iso: string | undefined, nowMs: number): number | undefined => {
  if (!iso?.trim()) return undefined;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  const hours = (nowMs - ms) / (1000 * 60 * 60);
  return hours >= 0 ? hours : undefined;
};

/** Parse relative chrome alone (no createdAt adjustment). */
const parseRelativeChromeHours = (rawText: string | undefined): number | undefined => {
  const blob = normalizeText(rawText ?? "");
  if (!blob) return undefined;

  if (JUST_POSTED_RE.test(blob)) return 0;

  const hourMatch = blob.match(RELATIVE_HOURS_RE);
  if (hourMatch?.[1] && hourMatch[2]) {
    const n = Number(hourMatch[1]);
    if (!Number.isFinite(n)) return undefined;
    return /min/i.test(hourMatch[2]) ? n / 60 : n;
  }

  const dayMatch = blob.match(RELATIVE_DAYS_RE);
  if (dayMatch?.[1]) {
    const n = Number(dayMatch[1]);
    if (!Number.isFinite(n)) return undefined;
    return n * 24;
  }

  if (FRESH_POST_RE.test(blob) && /\byesterday\b/i.test(blob)) return 24;
  return undefined;
};

/**
 * Hours since post when known; undefined when no usable timestamp.
 * ISO postedAt / tracker.postedAt always win.
 * Relative chrome in rawText is only used when jobCreatedAt is recent (&lt;12h);
 * effective age = chrome hours + hours since createdAt.
 */
export const parsePostedAtHoursAgo = (
  job: PostedAtFreshnessInput,
  nowMs: number = Date.now(),
): number | undefined => {
  for (const iso of [job.postedAt, job.trackerPostedAt]) {
    const hours = hoursSinceIso(iso, nowMs);
    if (hours != null) return hours;
  }

  const chromeHours = parseRelativeChromeHours(job.rawText);
  if (chromeHours == null) return undefined;

  const recordAgeHours = hoursSinceIso(job.jobCreatedAt, nowMs);
  if (recordAgeHours == null || recordAgeHours > RELATIVE_CHROME_MAX_RECORD_AGE_HOURS) {
    return undefined;
  }

  return chromeHours + recordAgeHours;
};

export const isSmallEmployerForApplyNow = (job: ExtractedJobData): boolean => {
  if (isLargeEmployerByHeadcount(job)) return false;
  const count = extractCompanyEmployeeCount(job);
  if (typeof count === "number" && count > 0) {
    return count < APPLY_NOW_SMALL_EMPLOYER_MAX;
  }
  const pool = computePoolFriendliness(job);
  return pool.adjustments.some((a) => a.id === "nicheEmployer");
};

export const isFavorableShapeForApplyNow = (params: {
  rules: RuleEvaluation;
  recommendation?: Recommendation;
  scoreBand?: ScoreBand;
  final?: number;
}): boolean => {
  if (params.rules.adjacentRoleFunction) return false;
  if (params.rules.platformInfraRole) return false;
  if (params.scoreBand === "no" || params.scoreBand === "skip") return false;
  if (params.recommendation === "apply_cold") return true;
  if (params.scoreBand === "strong_apply" || params.scoreBand === "apply") return true;
  if (typeof params.final === "number" && params.final >= 70) return true;
  return false;
};

export const evaluateApplyNowUrgency = (params: {
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
  recommendation?: Recommendation;
  scoreBand?: ScoreBand;
  final?: number;
  trackerPostedAt?: string;
  jobCreatedAt?: string;
  nowMs?: number;
}): boolean => {
  const hoursAgo = parsePostedAtHoursAgo(
    {
      postedAt: params.extracted.postedAt,
      rawText: params.extracted.rawText,
      trackerPostedAt: params.trackerPostedAt,
      jobCreatedAt: params.jobCreatedAt,
    },
    params.nowMs,
  );
  if (hoursAgo == null || hoursAgo >= APPLY_NOW_MAX_HOURS) return false;
  if (!isSmallEmployerForApplyNow(params.extracted)) return false;
  if (
    !isFavorableShapeForApplyNow({
      rules: params.rules,
      recommendation: params.recommendation,
      scoreBand: params.scoreBand,
      final: params.final,
    })
  ) {
    return false;
  }
  return true;
};
