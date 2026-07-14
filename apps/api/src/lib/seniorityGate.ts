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

/** Labeled Simplify Seniority next-line values (early + senior). */
const METADATA_SENIORITY_VALUE_RE =
  /^(entry|junior|mid level|mid-level|junior, mid|associate|new grad|intern|senior|staff|principal|lead|senior level|entry level|mid)$/i;

const EARLY_METADATA_SENIORITY_VALUE_RE =
  /^(entry|junior|mid level|mid-level|junior, mid|associate|new grad|intern|entry level|mid)$/i;

/**
 * Explicit "Seniority" chrome label + next line. Preferred structured source.
 * Bare unlabeled "Junior, Mid" lines (title-adjacent Simplify chrome) are NOT trusted alone
 * for gating — they may exist without a real Seniority field.
 */
export const readLabeledSeniorityValue = (job: ExtractedJobData): string | null => {
  const lines = (job.rawText ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const seniorityLabelIdx = lines.findIndex((l) => /^seniority$/i.test(l));
  if (seniorityLabelIdx >= 0) {
    const next = lines[seniorityLabelIdx + 1];
    if (next && METADATA_SENIORITY_VALUE_RE.test(next)) return next;
  }
  return null;
};

export const hasTrustedStructuredSeniority = (job: ExtractedJobData): boolean =>
  Boolean(readLabeledSeniorityValue(job)?.trim() || job.seniority?.trim());

/** True when only years/body year bands exist — no Seniority label and no seniority field. */
export const hasEmptyStructuredSeniority = (job: ExtractedJobData): boolean =>
  !readLabeledSeniorityValue(job)?.trim() && !job.seniority?.trim();

/**
 * Structured seniority for gating.
 * Prefer labeled Seniority field; then early-career chrome lines (Mid Level / Junior, Mid);
 * then job.seniority. Unlabeled early lines never promote senior/staff — that avoided
 * body pollution, but early chrome must still veto over a polluted seniority field.
 */
export const resolveStructuredSeniorityLevel = (job: ExtractedJobData): string => {
  const labeled = readLabeledSeniorityValue(job);
  if (labeled) return labeled;

  const lines = (job.rawText ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 30)) {
    if (EARLY_METADATA_SENIORITY_VALUE_RE.test(line)) return line;
  }

  return job.seniority?.trim() ?? "";
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
 * Early-career structured level with compatible years vetoes the seniority hard gate.
 * When early-career chrome conflicts with years ≥5 (polluted parse), do NOT veto via this
 * path — the gate fail-safes to manual review instead of firing on years alone.
 */
export const earlyCareerLevelVetoesSeniorityGate = (job: ExtractedJobData): boolean => {
  const level = normalizeText(resolveStructuredSeniorityLevel(job));
  if (!level || !isEarlyCareerStructuredLevel(level)) return false;
  const yearsMin = job.yearsExperience?.min;
  return yearsMin == null || yearsMin <= 4;
};

/**
 * Early chrome says junior/mid but yearsExperience.min ≥5 — extraction conflict.
 * Fail safe: do not silently gate from the years parse.
 */
export const earlyCareerConflictsWithYears = (job: ExtractedJobData): boolean => {
  const level = normalizeText(resolveStructuredSeniorityLevel(job));
  if (!level || !isEarlyCareerStructuredLevel(level)) return false;
  return yearsExperienceSignalsOverreach(job.yearsExperience?.min);
};

/**
 * Flag for manual review when:
 * - structured seniority is empty and body years alone would gate, OR
 * - early-career chrome conflicts with years ≥5 (polluted year parse like 2–10+ → min 10).
 * Do not silently fire the hard gate in those cases.
 */
export const seniorityNeedsManualReview = (job: ExtractedJobData): boolean => {
  if (roleTitleSignalsSeniority(job.title)) return false;
  if (earlyCareerLevelVetoesSeniorityGate(job)) return false;
  if (earlyCareerConflictsWithYears(job)) return true;
  if (hasEmptyStructuredSeniority(job) && yearsExperienceSignalsOverreach(job.yearsExperience?.min)) {
    return true;
  }
  return false;
};

export type SeniorityGateTriggerExplanation = {
  wouldFire: boolean;
  vetoed: boolean;
  vetoReason?: string;
  triggerSource?: "title" | "yearsExperience" | "seniorityField" | "rulesFlagOnly";
  triggerDetail?: string;
  resolvedLevel?: string;
  parsedSeniorityField?: string | null;
  needsManualReview?: boolean;
};

/** Trace which signal would add the seniority hard gate (for calibration/debug). */
export const explainSeniorityGateTrigger = (
  job: ExtractedJobData,
  rules?: Pick<RuleEvaluation, "seniorityOverreach">,
): SeniorityGateTriggerExplanation => {
  const resolvedLevel = resolveStructuredSeniorityLevel(job);
  const parsedSeniorityField = job.seniority ?? null;
  const base = { resolvedLevel, parsedSeniorityField };
  const needsManualReview = seniorityNeedsManualReview(job);

  if (earlyCareerLevelVetoesSeniorityGate(job)) {
    return {
      ...base,
      wouldFire: false,
      vetoed: true,
      vetoReason: `early-career structured level (${resolvedLevel || parsedSeniorityField}) with years min ${job.yearsExperience?.min ?? "unset"} ≤ 4`,
      needsManualReview: false,
    };
  }

  if (roleTitleSignalsSeniority(job.title)) {
    return {
      ...base,
      wouldFire: true,
      vetoed: false,
      triggerSource: "title",
      triggerDetail: job.title ?? "",
      needsManualReview: false,
    };
  }

  if (needsManualReview) {
    return {
      ...base,
      wouldFire: false,
      vetoed: false,
      needsManualReview: true,
      triggerDetail: earlyCareerConflictsWithYears(job)
        ? "early-career seniority conflicts with years min ≥5 — fail safe, no gate"
        : "structured seniority empty — years/prose alone do not gate",
    };
  }

  if (yearsExperienceSignalsOverreach(job.yearsExperience?.min)) {
    return {
      ...base,
      wouldFire: true,
      vetoed: false,
      triggerSource: "yearsExperience",
      triggerDetail: String(job.yearsExperience?.min),
      needsManualReview: false,
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
      needsManualReview: false,
    };
  }

  if (rules?.seniorityOverreach) {
    return {
      ...base,
      wouldFire: true,
      vetoed: false,
      triggerSource: "rulesFlagOnly",
      triggerDetail: "rules.seniorityOverreach=true without detectable trigger",
      needsManualReview: false,
    };
  }

  return { ...base, wouldFire: false, vetoed: false, needsManualReview: false };
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
  if (explanation.needsManualReview) {
    logger.info("Seniority hard gate deferred for manual review", explanation);
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
 * Hard seniority gate — PRIMARY evidence: title (noun), structured level, yearsExperience.min
 * when structured seniority is present and consistent.
 *
 * Fail safe (no gate + manual review) when:
 * - structured seniority is empty and only body years would fire, OR
 * - early-career chrome conflicts with years ≥5 (polluted year parse).
 */
export const detectRoleSeniorityOverreach = (job: ExtractedJobData): boolean => {
  if (earlyCareerLevelVetoesSeniorityGate(job)) return false;
  if (roleTitleSignalsSeniority(job.title)) return true;
  if (seniorityNeedsManualReview(job)) return false;
  const seniorityField = effectiveSeniorityFieldForGate(job);
  return (
    yearsExperienceSignalsOverreach(job.yearsExperience?.min) ||
    seniorityFieldSignalsOverreach(seniorityField)
  );
};

export { EARLY_METADATA_SENIORITY_VALUE_RE };
