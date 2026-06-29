import type { ExtractedJobData } from "../types/job.js";
import type { RuleEvaluation } from "../types/scoring.js";
import { normalizeText } from "./text.js";
import { logger } from "./logger.js";

const TITLE_SENIOR_STAFF_RE = /\b(senior|staff|principal|sr\.?)\b/i;
const TITLE_LEAD_ROLE_RE =
  /\b(tech\s+lead|team\s+lead|lead\s+(?:engineer|developer|software|sre|data|ml|ai|platform|product|backend|frontend|full[\s-]?stack))\b/i;
const TITLE_EXEC_ROLE_RE = /\b(engineering\s+manager|director\s+of\s+engineering)\b/i;

/** Architect as a role-title noun — not imperative verb ("Architect core systems…"). */
const TITLE_ARCHITECT_ROLE_RE =
  /\b((?:principal|staff|senior|lead|software|systems|platform|solution|data|cloud|security|enterprise|technical|application)\s+architect|architect\s+(?:engineer|of\s+record))\b/i;

const VERB_ARCHITECT_TITLE_RE =
  /^architect\s+(?:core|the|our|a|an|and|to|scalable|robust|high|new|ml|ai|data|backend|frontend|distributed|key|major|production|cloud|mobile|agent|llm|rag|api|platform|pipeline|system|systems|solution|solutions|features|services|infrastructure|components|workflows|integrations|products|experiences|capabilities)\b/i;

const METADATA_SENIORITY_LABEL_RE =
  /^(entry|junior|mid level|mid-level|junior, mid|associate|new grad|intern)$/i;

/** Structured seniority from posting chrome (Simplify/Jobright labels) — wins over body-inferred senior. */
export const resolveStructuredSeniorityLevel = (job: ExtractedJobData): string => {
  const lines = (job.rawText ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const seniorityLabelIdx = lines.findIndex((l) => /^seniority$/i.test(l));
  if (seniorityLabelIdx >= 0) {
    const next = lines[seniorityLabelIdx + 1];
    if (next && METADATA_SENIORITY_LABEL_RE.test(next)) return next;
  }

  for (const line of lines.slice(0, 30)) {
    if (METADATA_SENIORITY_LABEL_RE.test(line)) return line;
  }

  return job.seniority ?? "";
};

export const isEarlyCareerStructuredLevel = (level: string): boolean =>
  /\b(junior|mid|entry|early career|associate|new grad|intern)\b/i.test(normalizeText(level));

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
  const level = normalizeText(resolveStructuredSeniorityLevel(job));
  const yearsMin = job.yearsExperience?.min;
  const hasEarlyBand = isEarlyCareerStructuredLevel(level);
  const yearsWithinEarlyBand = yearsMin == null || yearsMin <= 4;
  return hasEarlyBand && yearsWithinEarlyBand;
};

export type SeniorityGateTriggerExplanation = {
  wouldFire: boolean;
  vetoed: boolean;
  vetoReason?: string;
  triggerSource?: "title" | "yearsExperience" | "seniorityField" | "rulesFlagOnly";
  triggerDetail?: string;
  resolvedLevel?: string;
  parsedSeniorityField?: string | null;
};

/** Trace which signal would add the seniority hard gate (for calibration/debug). */
export const explainSeniorityGateTrigger = (
  job: ExtractedJobData,
  rules?: Pick<RuleEvaluation, "seniorityOverreach">,
): SeniorityGateTriggerExplanation => {
  const resolvedLevel = resolveStructuredSeniorityLevel(job);
  const parsedSeniorityField = job.seniority ?? null;
  const base = { resolvedLevel, parsedSeniorityField };

  if (earlyCareerLevelVetoesSeniorityGate(job)) {
    return {
      ...base,
      wouldFire: false,
      vetoed: true,
      vetoReason: `early-career structured level (${resolvedLevel || parsedSeniorityField}) with years min ${job.yearsExperience?.min ?? "unset"} ≤ 4`,
    };
  }

  if (roleTitleSignalsSeniority(job.title)) {
    return {
      ...base,
      wouldFire: true,
      vetoed: false,
      triggerSource: "title",
      triggerDetail: job.title ?? "",
    };
  }

  if (yearsExperienceSignalsOverreach(job.yearsExperience?.min)) {
    return {
      ...base,
      wouldFire: true,
      vetoed: false,
      triggerSource: "yearsExperience",
      triggerDetail: String(job.yearsExperience?.min),
    };
  }

  const seniorityField = effectiveSeniorityFieldForGate(job);
  if (seniorityFieldSignalsOverreach(seniorityField)) {
    return {
      ...base,
      wouldFire: true,
      vetoed: false,
      triggerSource: "seniorityField",
      triggerDetail: seniorityField ?? "",
    };
  }

  if (rules?.seniorityOverreach) {
    return {
      ...base,
      wouldFire: true,
      vetoed: false,
      triggerSource: "rulesFlagOnly",
      triggerDetail: "rules.seniorityOverreach=true without detectable trigger",
    };
  }

  return { ...base, wouldFire: false, vetoed: false };
};

export const logSeniorityGateEvaluation = (
  job: ExtractedJobData,
  rules: Pick<RuleEvaluation, "seniorityOverreach">,
  vetoed: boolean,
): void => {
  const explanation = explainSeniorityGateTrigger(job, rules);
  if (vetoed) {
    logger.info("Seniority hard gate vetoed at evaluation", explanation);
    return;
  }
  if (explanation.wouldFire || rules.seniorityOverreach) {
    logger.info("Seniority hard gate firing", explanation);
  }
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

export const effectiveSeniorityFieldForGate = (job: ExtractedJobData): string | null => {
  const resolved = resolveStructuredSeniorityLevel(job);
  if (resolved && isEarlyCareerStructuredLevel(resolved)) return resolved;
  return job.seniority ?? (resolved || null);
};

/**
 * Hard seniority gate — PRIMARY evidence: title (noun), structured level, yearsExperience.min.
 * Early-career junior/mid + years ≤4 vetoes the gate regardless of polluted title text.
 */
export const detectRoleSeniorityOverreach = (job: ExtractedJobData): boolean => {
  if (earlyCareerLevelVetoesSeniorityGate(job)) return false;
  const seniorityField = effectiveSeniorityFieldForGate(job);
  return (
    roleTitleSignalsSeniority(job.title) ||
    yearsExperienceSignalsOverreach(job.yearsExperience?.min) ||
    seniorityFieldSignalsOverreach(seniorityField)
  );
};
