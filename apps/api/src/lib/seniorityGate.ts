import type { ExtractedJobData } from "../types/job.js";
import { normalizeText } from "./text.js";

/** Seniority tokens in the role title itself — not JD body mentions of teammates. */
const ROLE_TITLE_SENIORITY_RE =
  /\b(senior|staff|principal|sr\.?|lead|architect|engineering\s+manager|director\s+of\s+engineering)\b/i;

/**
 * Whether the structured seniority field describes a senior/staff/principal role level.
 * Multi-band listings ("Junior, Mid") are early-career openings, not overreach.
 */
export const seniorityFieldSignalsOverreach = (seniority?: string | null): boolean => {
  if (!seniority?.trim()) return false;
  const s = normalizeText(seniority);
  if (/\b(junior|entry|early career|associate|new grad|intern)\b/i.test(s)) return false;
  if (/\bmid\b/i.test(s) && !/\b(senior|staff|principal|director)\b/i.test(s)) return false;
  return /\b(senior|staff|principal|director|lead)\b/i.test(s);
};

export const roleTitleSignalsSeniority = (title?: string | null): boolean => {
  const t = normalizeText(title ?? "");
  if (!t) return false;
  return ROLE_TITLE_SENIORITY_RE.test(t);
};

export const yearsExperienceSignalsOverreach = (min?: number | null): boolean =>
  (min ?? 0) >= 5;

/**
 * Hard seniority gate — uses title, yearsExperience.min, and seniority field ONLY.
 * Team/manager mentions in rawText must not trigger overreach.
 */
export const detectRoleSeniorityOverreach = (job: ExtractedJobData): boolean =>
  roleTitleSignalsSeniority(job.title) ||
  yearsExperienceSignalsOverreach(job.yearsExperience?.min) ||
  seniorityFieldSignalsOverreach(job.seniority);
