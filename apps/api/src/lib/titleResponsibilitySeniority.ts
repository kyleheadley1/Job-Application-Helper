import type { ExtractedJobData } from "../types/job.js";
import { resolveEmployerScale } from "./employerScale.js";
import { jdDutiesBlob } from "./jdGroundedRiskNotes.js";
import {
  isEarlyCareerStructuredLevel,
  resolveStructuredSeniorityLevel,
} from "./seniorityGate.js";
import { normalizeText } from "./text.js";

/** 0 = early/junior, 1 = mid, 2 = senior, 3 = staff+ */
export type SeniorityBand = 0 | 1 | 2 | 3;

export type TitleResponsibilityMismatchEval = {
  mismatch: boolean;
  titleBand: SeniorityBand;
  responsibilityBand: SeniorityBand;
  statedEarlyCareer: boolean;
  highAutonomy: boolean;
  hasSupportStructure: boolean;
  earlyStageOrg: boolean;
  highOwnershipLowSupport: boolean;
  /** Canonical Key Risk line when mismatch is true. */
  mismatchRiskNote?: string;
  /** Canonical Key Risk / survivability note when highOwnershipLowSupport is true. */
  highOwnershipLowSupportNote?: string;
};

const INDUSTRY_SENIOR_TITLE_RE =
  /\b(forward\s+deployed(?:\s+engineer)?|founding(?:\s+full[-\s]?stack)?\s+engineer|staff(?:\s+engineer)?|principal(?:\s+engineer)?|distinguished(?:\s+engineer)?|engineering\s+manager|tech\s+lead|team\s+lead)\b/i;

const TITLE_EARLY_RE =
  /\b(junior|associate|entry[-\s]?level|intern|new\s+grad|i\b|1\b)\b/i;

const TITLE_SENIOR_MODIFIER_RE =
  /\b(senior|sr\.?|staff|principal|lead)\b/i;

const HIGH_AUTONOMY_RE =
  /\b(you\s+decide\s+what\s+done\s+means|own\s+deployments?\s+end\s+to\s+end|own(?:s|\s+the)?\s+(?:the\s+)?(?:deployments?|cutovers?|migrations?|function|roadmap|technical\s+direction)|define\s+how\s+this\s+function\s+works|no\s+margin\s+for\s+error|full\s+autonomy|end[-\s]?to[-\s]?end\s+ownership|live[-\s]?migration|production\s+cutovers?|decide\s+what\s+done\s+means)\b/i;

const SUPPORT_STRUCTURE_RE =
  /\b(mentor(?:ship|ed|ing)?|onboarding|ramp(?:\s+up)?|buddy\s+system|pair(?:ed|\s+with)|close\s+supervision|structured\s+training|new\s+grad\s+program|junior[-\s]?friendly|learning\s+environment|coaching)\b/i;

const SEVERITY_EARLY_CAREER_EXCEED_RE =
  /\b(may\s+exceed\s+typical\s+early[-\s]?career|beyond\s+entry[-\s]?level|senior[-\s]?level\s+ownership\s+expected|exceeds?\s+(?:typical\s+)?early[-\s]?career|too\s+senior\s+for|ownership\s+(?:bar|scope)\s+(?:likely\s+)?exceeds?|hands[-\s]?on\s+integrations?.{0,80}exceed)\b/i;

export const titleImpliedSeniorityBand = (title?: string | null): SeniorityBand => {
  const t = normalizeText(title ?? "");
  if (!t) return 1;
  if (/\b(staff|principal|distinguished|engineering\s+manager|director)\b/i.test(t)) return 3;
  if (INDUSTRY_SENIOR_TITLE_RE.test(t) || TITLE_SENIOR_MODIFIER_RE.test(t)) return 2;
  if (TITLE_EARLY_RE.test(t)) return 0;
  return 1;
};

export const responsibilityImpliedSeniorityBand = (job: ExtractedJobData): SeniorityBand => {
  const duties = jdDutiesBlob(job);
  const raw = normalizeText(job.rawText ?? "");
  const blob = `${duties}\n${raw}`;
  if (!blob.trim()) return 1;

  if (SUPPORT_STRUCTURE_RE.test(blob) && !HIGH_AUTONOMY_RE.test(blob)) return 0;

  const autonomyHits =
    (blob.match(
      /\b(own(?:s|\s+the)?|end[-\s]?to[-\s]?end|you\s+decide|full\s+autonomy|no\s+margin\s+for\s+error|live[-\s]?migration|production\s+cutovers?|define\s+how)\b/gi,
    )?.length ?? 0);

  if (HIGH_AUTONOMY_RE.test(blob) || autonomyHits >= 3) return 2;
  if (autonomyHits >= 1 && !SUPPORT_STRUCTURE_RE.test(blob)) return 2;
  if (/\b(collaborate|work\s+with|pair|mentor|guidance|support\s+from)\b/i.test(blob)) return 1;
  return 1;
};

export const jdHasSupportStructureLanguage = (job: ExtractedJobData): boolean => {
  const blob = normalizeText(
    [...(job.responsibilities ?? []), ...(job.requirements ?? []), job.rawText ?? ""].join("\n"),
  );
  return SUPPORT_STRUCTURE_RE.test(blob);
};

export const jdHasHighAutonomyLanguage = (job: ExtractedJobData): boolean =>
  responsibilityImpliedSeniorityBand(job) >= 2;

export const isEarlyStageHighOwnershipOrg = (job: ExtractedJobData): boolean => {
  const scale = resolveEmployerScale(job);
  const blob = normalizeText(job.rawText ?? "");
  const under50 =
    (scale.employeeCount != null && scale.employeeCount <= 50) ||
    /\b(1[-\s]?10|11[-\s]?50)\s*(employees|employee|people)\b/i.test(blob);
  const seedOnly =
    /\b(seed(?:\s+round)?|pre[-\s]?seed|single[-\s]?seed|raised\s+\$?\d+\s*m(?:illion)?)\b/i.test(blob) &&
    !/\b(series\s+[b-z]|post[-\s]?ipo|publicly\s+traded)\b/i.test(blob);
  return under50 || (seedOnly && (scale.employeeCount == null || scale.employeeCount <= 100));
};

export const statedLevelIsEarlyCareer = (job: ExtractedJobData): boolean => {
  const level = resolveStructuredSeniorityLevel(job);
  if (level && isEarlyCareerStructuredLevel(level)) return true;
  const yearsMin = job.yearsExperience?.min;
  if (yearsMin != null && yearsMin <= 2) return true;
  const blob = normalizeText([job.seniority, job.rawText ?? ""].filter(Boolean).join("\n"));
  return /\b(junior|entry[-\s]?level|associate|1[-\s]?2\s*years?|1\+\s*years?)\b/i.test(blob);
};

/**
 * Title vs responsibility consistency, plus stated junior/years conflicting with
 * senior title or high-autonomy responsibilities.
 */
export const evaluateTitleResponsibilitySeniority = (
  job: ExtractedJobData,
): TitleResponsibilityMismatchEval => {
  const titleBand = titleImpliedSeniorityBand(job.title);
  const responsibilityBand = responsibilityImpliedSeniorityBand(job);
  const statedEarlyCareer = statedLevelIsEarlyCareer(job);
  const highAutonomy = responsibilityBand >= 2;
  const hasSupportStructure = jdHasSupportStructureLanguage(job);
  const earlyStageOrg = isEarlyStageHighOwnershipOrg(job);

  const bandDelta = Math.abs(titleBand - responsibilityBand);
  const classicMismatch = bandDelta > 1;
  const statedConflictsWithSeniorSignals =
    statedEarlyCareer &&
    Math.max(titleBand, responsibilityBand) >= 2 &&
    !hasSupportStructure;

  const mismatch = classicMismatch || statedConflictsWithSeniorSignals;

  const highOwnershipLowSupport =
    highAutonomy && !hasSupportStructure && earlyStageOrg;

  let mismatchRiskNote: string | undefined;
  if (mismatch) {
    if (classicMismatch && titleBand <= 0 && responsibilityBand >= 2) {
      mismatchRiskNote =
        "Title/responsibility mismatch — junior/associate title paired with senior-autonomy responsibilities (end-to-end ownership without stated support structure).";
    } else if (titleBand >= 2 && statedEarlyCareer) {
      mismatchRiskNote =
        "Title/responsibility mismatch — title reads as high-autonomy/senior (e.g. Forward Deployed / founding-style) while the listing is tagged junior or 1–2 years; responsibilities confirm ownership beyond early-career ramp.";
    } else {
      mismatchRiskNote =
        "Title/responsibility mismatch — seniority implied by the title and the responsibilities disagree by more than one level; do not rely on stated years alone.";
    }
  }

  const highOwnershipLowSupportNote = highOwnershipLowSupport
    ? "High ownership, low support — role expects end-to-end autonomy with no mentorship/onboarding language at a small early-stage engineering org."
    : undefined;

  return {
    mismatch,
    titleBand,
    responsibilityBand,
    statedEarlyCareer,
    highAutonomy,
    hasSupportStructure,
    earlyStageOrg,
    highOwnershipLowSupport,
    mismatchRiskNote,
    highOwnershipLowSupportNote,
  };
};

/** True when risk/note prose asserts the role likely exceeds early-career scope. */
export const textSignalsEarlyCareerExceedSeverity = (text: string): boolean =>
  SEVERITY_EARLY_CAREER_EXCEED_RE.test(text);

export const TITLE_RESPONSIBILITY_MISMATCH_LEVEL_FIT_MAX = 8;
export const EARLY_CAREER_EXCEED_SEVERITY_LEVEL_FIT_MAX = 9;
export const HIGH_OWNERSHIP_LOW_SUPPORT_SURV_PENALTY = 0.12;
