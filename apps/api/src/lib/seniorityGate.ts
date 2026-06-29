import type { ExtractedJobData } from "../types/job.js";
import { normalizeText } from "./text.js";

const TITLE_SENIOR_STAFF_RE = /\b(senior|staff|principal|sr\.?)\b/i;
const TITLE_LEAD_ROLE_RE =
  /\b(tech\s+lead|team\s+lead|lead\s+(?:engineer|developer|software|sre|data|ml|ai|platform|product|backend|frontend|full[\s-]?stack))\b/i;
const TITLE_EXEC_ROLE_RE = /\b(engineering\s+manager|director\s+of\s+engineering)\b/i;

/** Architect as a role-title noun — not imperative verb ("Architect core systems…"). */
const TITLE_ARCHITECT_ROLE_RE =
  /\b((?:principal|staff|senior|lead|software|systems|platform|solution|data|cloud|security|enterprise|technical|application)\s+architect|architect\s+(?:engineer|of\s+record))\b/i;

const VERB_ARCHITECT_TITLE_RE =
  /^architect\s+(?:core|the|our|a|an|and|to|scalable|robust|high|new|ml|ai|data|backend|frontend|distributed|key|major|production|cloud|mobile|agent|llm|rag|api|platform|pipeline|system|systems|solution|solutions|features|services|infrastructure|components|workflows|integrations|products|experiences|capabilities)\b/i;

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

export const yearsExperienceSignalsOverreach = (min?: number | null): boolean =>
  (min ?? 0) >= 5;

/**
 * Early-career structured level vetoes the seniority hard gate entirely.
 * Body prose (architect verb, founding team, etc.) cannot override this.
 */
export const earlyCareerLevelVetoesSeniorityGate = (job: ExtractedJobData): boolean => {
  const level = normalizeText(job.seniority ?? "");
  const yearsMin = job.yearsExperience?.min;
  const hasEarlyBand = /\b(junior|mid|entry|early career|associate|new grad|intern)\b/i.test(level);
  const yearsWithinEarlyBand = yearsMin == null || yearsMin <= 4;
  return hasEarlyBand && yearsWithinEarlyBand;
};

export const titleArchitectIsRoleNoun = (title?: string | null): boolean => {
  const t = normalizeText(title ?? "");
  if (!t || VERB_ARCHITECT_TITLE_RE.test(t)) return false;
  if (TITLE_ARCHITECT_ROLE_RE.test(t)) return true;
  if (/\barchitect\b/i.test(t) && t.split(/\s+/).length <= 4 && !/\b(and|with|for|to|will|help)\b/i.test(t)) {
    return true;
  }
  return false;
};

/** Seniority tokens in the role TITLE only — noun forms, not body/responsibility verbs. */
export const roleTitleSignalsSeniority = (title?: string | null): boolean => {
  const t = normalizeText(title ?? "");
  if (!t) return false;
  if (TITLE_SENIOR_STAFF_RE.test(t)) return true;
  if (TITLE_LEAD_ROLE_RE.test(t)) return true;
  if (TITLE_EXEC_ROLE_RE.test(t)) return true;
  return titleArchitectIsRoleNoun(t);
};

/**
 * Hard seniority gate — PRIMARY evidence: title (noun), structured level, yearsExperience.min.
 * Early-career junior/mid + years ≤4 vetoes the gate regardless of polluted title text.
 */
export const detectRoleSeniorityOverreach = (job: ExtractedJobData): boolean => {
  if (earlyCareerLevelVetoesSeniorityGate(job)) return false;
  return (
    roleTitleSignalsSeniority(job.title) ||
    yearsExperienceSignalsOverreach(job.yearsExperience?.min) ||
    seniorityFieldSignalsOverreach(job.seniority)
  );
};
