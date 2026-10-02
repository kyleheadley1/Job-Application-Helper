import type { ExtractedJobData } from "../types/job.js";
import type { UserProfile } from "../types/userProfile.js";
import {
  assessRoleSeniority,
  requiredYearsRangeInDuties,
  resolveStructuredSeniorityLevel,
} from "./seniorityGate.js";
import { normalizeText } from "./text.js";
import { COMPOSITE_SCORING } from "../config/capabilitySurvivabilityPolicy.js";

const SENIORITY_STRETCH_DOCK = COMPOSITE_SCORING.SENIORITY_STRETCH_DOCK;

/**
 * Proportional dock for competing against more experienced applicants on a role that
 * would still take a strong early-career candidate. Never large enough to disqualify;
 * roles that obviously want more experience go through the seniority hard gate instead.
 */
export const EXPERIENCE_GAP_POLICY = {
  /** Points per year the candidate is below the JD's minimum. */
  FLOOR_PER_YEAR: 2,
  /** Points per year the JD's range extends above max(min, candidate years). */
  RANGE_PER_YEAR: 1,
  /** Mid-level label with no stated years (or years that dock less). */
  MID_LABEL_DOCK: 3,
  MAX_DOCK: 8,
  /** Cap on title stretch + experience gap together. */
  COMBINED_SENIORITY_MAX: 12,
  DEFAULT_CANDIDATE_YEARS: 2,
} as const;

export type ExperienceGap = { dock: number; reason: string };

/** Level fit the LLM gives a fully level-matched early-career role. */
const MATCHED_LEVEL_FIT = 18;
/** Final points per levelFit point (capability = (stack + level + functional) / 55 × 100). */
const FINAL_POINTS_PER_LEVEL_FIT = 100 / 55;

/**
 * Seniority/experience docks become a levelFit ceiling, not a separate subtraction: the LLM's
 * levelFit already judges experience fit, so a role it already marked down isn't docked twice,
 * while a role it rated fully matched loses about `dock` final points.
 */
export const levelFitCeilingForSeniorityDock = (dock: number): number =>
  Math.max(0, MATCHED_LEVEL_FIT - Math.round(dock / FINAL_POINTS_PER_LEVEL_FIT));

export const seniorityLevelFitDock = (rules: {
  seniorityStretch?: boolean;
  experienceGap?: ExperienceGap;
}): number =>
  Math.min(
    EXPERIENCE_GAP_POLICY.COMBINED_SENIORITY_MAX,
    (rules.seniorityStretch ? SENIORITY_STRETCH_DOCK : 0) + (rules.experienceGap?.dock ?? 0),
  );

const resolveYearsRange = (job: ExtractedJobData): { min: number; max?: number } | null => {
  const y = job.yearsExperience;
  if (y?.min != null) return { min: y.min, max: y.max ?? undefined };
  return requiredYearsRangeInDuties(job);
};

const fmtYears = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

export const computeExperienceGap = (
  job: ExtractedJobData,
  profile: Pick<UserProfile, "estimatedProfessionalYears" | "screeningYears">,
  /** floorAlreadyDocked: the reinforced-floor rule already docked levelFit for being under the minimum. */
  options: { floorAlreadyDocked?: boolean } = {},
): ExperienceGap | undefined => {
  if (assessRoleSeniority(job) === "overreach") return undefined;
  const cand =
    profile.screeningYears ??
    profile.estimatedProfessionalYears ??
    EXPERIENCE_GAP_POLICY.DEFAULT_CANDIDATE_YEARS;

  let yearsDock = 0;
  let yearsReason = "";
  const range = resolveYearsRange(job);
  if (range) {
    const floorGap = options.floorAlreadyDocked ? 0 : Math.max(0, range.min - cand);
    const top = range.max != null && range.max > range.min ? range.max : null;
    const rangeGap = top != null ? Math.max(0, top - Math.max(range.min, cand)) : 0;
    yearsDock = Math.min(
      EXPERIENCE_GAP_POLICY.MAX_DOCK,
      Math.round(floorGap * EXPERIENCE_GAP_POLICY.FLOOR_PER_YEAR + rangeGap * EXPERIENCE_GAP_POLICY.RANGE_PER_YEAR),
    );
    const asked = top != null ? `${range.min}–${top} years` : `${range.min}+ years`;
    const parts = [
      floorGap > 0 ? `below the ${range.min}-year floor` : null,
      top != null && rangeGap > 0 ? `competing with applicants up to ${top} years` : null,
    ].filter(Boolean);
    yearsReason = `JD asks ${asked}; at ~${fmtYears(cand)} years you're ${parts.join(" and ")}`;
  }

  const level = normalizeText(resolveStructuredSeniorityLevel(job));
  const earlyCareerTitle = /\b(junior|jr\.?|entry|associate|new grad|graduate|intern|apprentice|[a-z]+ i)\b/i.test(
    normalizeText(job.title ?? ""),
  );
  const midLabel =
    !earlyCareerTitle &&
    /\bmid\b/.test(level) &&
    !/\b(junior|entry|early career|associate|new grad|intern)\b/.test(level);
  const midDock = midLabel ? EXPERIENCE_GAP_POLICY.MID_LABEL_DOCK : 0;

  const dock = Math.max(yearsDock, midDock);
  if (dock <= 0) return undefined;
  const reason =
    yearsDock >= midDock
      ? yearsReason
      : `Role is labelled mid-level; competing with mid-level applicants at ~${fmtYears(cand)} years`;
  return {
    dock,
    reason: `${reason} — level fit capped at ${levelFitCeilingForSeniorityDock(dock)}/20 (proportional, not a gate).`,
  };
};
