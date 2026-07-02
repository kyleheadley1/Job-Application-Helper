import type { ClearanceRequirement, ExtractedJobData } from "../types/job.js";
import type { EligibilityFlag } from "../types/scoring.js";
import type { UserProfile } from "../types/userProfile.js";
import { normalizeText } from "./text.js";

export type ClearanceTiming = ClearanceRequirement["timing"];

export const STRICT_EXISTING_CLEARANCE_RE =
  /\b(active\s+(?:ts\/sci|secret|clearance|polygraph)|current(?:ly)?\s+(?:cleared|hold(?:s|ing)?\s+(?:an?\s+)?(?:active\s+)?clearance)|existing\s+clearance|must\s+already\s+hold\b|must\s+hold\s+(?:a\s+)?(?:current\s+|active\s+)?(?:security\s+)?clearance|must\s+(?:be|currently)\s+(?:cleared|holding(?:\s+(?:an?\s+)?(?:active\s+)?clearance)?)|day\s*[-\s]?1\s+clearance|active\s+clearance)\b/i;

const BARE_CLEARANCE_REQUIRED_RE =
  /\b(?:security\s+)?clearance\s+required\b/i;

const SPONSORABLE_RE =
  /\b(ability\s+to\s+obtain(?:\s+and\s+maintain)?(?:\s+(?:a\s+)?clearance)?|clearance\s+eligible|must\s+be\s+able\s+to\s+obtain(?:\s+(?:a\s+)?clearance)?|will\s+be\s+required\s+to\s+obtain(?:\s+(?:a\s+)?clearance)?|eligible\s+for\s+(?:a\s+)?(?:security\s+)?clearance|\bclearable\b)\b/i;

const CLEARANCE_MENTION_RE =
  /\b(security\s+clearance|clearance\s+required|requires?\s+(?:a\s+)?security\s+clearance|dod\s+clearance|ts\/sci|top\s+secret|active\s+clearance|must\s+already\s+hold)\b/i;

const US_CITIZENSHIP_REQ_RE =
  /\b(must\s+be\s+(?:a\s+)?u\.?s\.?\s+citizen|u\.?s\.?\s+citizenship\s+(?:is\s+)?required|citizenship\s+required|only\s+u\.?s\.?\s+citizens?)\b/i;

export const jobRequirementBlob = (job: ExtractedJobData): string =>
  normalizeText(
    [
      job.rawText ?? "",
      job.citizenshipRequirement ?? "",
      typeof job.clearanceRequirement === "string" ? job.clearanceRequirement : job.clearanceRequirement?.raw ?? "",
      ...(job.requirements ?? []),
    ].join("\n"),
  );

export const parseCitizenshipRequirementText = (text: string): string | null => {
  const blob = normalizeText(text);
  if (!US_CITIZENSHIP_REQ_RE.test(blob)) return null;
  const match =
    blob.match(/\bmust\s+be\s+(?:a\s+)?u\.?s\.?\s+citizen[^.\n;]*/i) ??
    blob.match(/\bu\.?s\.?\s+citizenship\s+(?:is\s+)?required[^.\n;]*/i) ??
    blob.match(/\bonly\s+u\.?s\.?\s+citizens?[^.\n;]*/i) ??
    blob.match(/\bcitizenship\s+required[^.\n;]*/i);
  return match?.[0]?.trim() ?? "U.S. citizenship required";
};

export const resolveCitizenshipRequirement = (job: ExtractedJobData): string | null => {
  if (job.citizenshipRequirement?.trim()) return job.citizenshipRequirement.trim();
  return parseCitizenshipRequirementText(jobRequirementBlob(job));
};

export const isUsCitizenshipRequirement = (requirement: string): boolean =>
  /\bu\.?s\.?\s+citizen|\bunited states citizen|\bu\.?s\.?\s+citizenship/i.test(
    normalizeText(requirement),
  );

export const candidateMeetsCitizenshipRequirement = (
  profile: UserProfile,
  requirement: string | null,
): boolean => {
  if (!requirement) return true;
  if (!isUsCitizenshipRequirement(requirement)) return true;
  return profile.citizenshipStatus?.isUSCitizen ?? false;
};

export const classifyClearanceTiming = (
  text: string,
  citizenshipRequirement?: string | null,
): ClearanceTiming => {
  const blob = normalizeText(text);
  if (
    !CLEARANCE_MENTION_RE.test(blob) &&
    !SPONSORABLE_RE.test(blob) &&
    !BARE_CLEARANCE_REQUIRED_RE.test(blob)
  ) {
    return "unspecified";
  }

  if (SPONSORABLE_RE.test(blob)) return "sponsorable";

  const citizenshipAsReason =
    /\b(?:due to|because of|for)\s+(?:the\s+)?(?:security\s+)?clearance\b/i.test(blob) ||
    (Boolean(citizenshipRequirement) &&
      BARE_CLEARANCE_REQUIRED_RE.test(blob));

  if (citizenshipAsReason) return "sponsorable";

  if (STRICT_EXISTING_CLEARANCE_RE.test(blob)) return "active_upfront";
  if (BARE_CLEARANCE_REQUIRED_RE.test(blob)) return "active_upfront";

  return "unspecified";
};

export const isStrictExistingClearanceRequired = (text: string): boolean =>
  STRICT_EXISTING_CLEARANCE_RE.test(normalizeText(text));

export const parseClearanceRequirement = (
  text: string,
  citizenshipRequirement?: string | null,
): ClearanceRequirement | null => {
  const blob = normalizeText(text);
  if (!CLEARANCE_MENTION_RE.test(blob)) return null;

  const timing = classifyClearanceTiming(blob, citizenshipRequirement);
  const rawMatch = blob.match(
    /\b(?:must\s+be\s+(?:a\s+)?u\.?s\.?\s+citizen[^.\n;]*clearance[^.\n;]*|[^.\n;]*security\s+clearance[^.\n;]*|[^.\n;]*clearance\s+required[^.\n;]*)\b/i,
  );

  return {
    required: true,
    timing,
    raw: rawMatch?.[0]?.trim(),
  };
};

export const resolveClearanceRequirement = (job: ExtractedJobData): ClearanceRequirement | null => {
  if (job.clearanceRequirement && typeof job.clearanceRequirement === "object") {
    return job.clearanceRequirement;
  }
  if (typeof job.clearanceRequirement === "string" && job.clearanceRequirement.trim()) {
    const timing = classifyClearanceTiming(
      job.clearanceRequirement,
      job.citizenshipRequirement,
    );
    return { required: true, timing, raw: job.clearanceRequirement.trim() };
  }
  const citizenship = resolveCitizenshipRequirement(job);
  return parseClearanceRequirement(jobRequirementBlob(job), citizenship);
};

export const effectiveClearanceTiming = (timing: ClearanceTiming): ClearanceTiming =>
  timing === "unspecified" ? "sponsorable" : timing;

export type ClearanceCitizenshipResult = {
  citizenshipRequirement: string | null;
  clearanceRequirement: ClearanceRequirement | null;
  citizenshipMismatch: boolean;
  clearanceMismatch: boolean;
  /** Bare "clearance required" / hire-now clearance without strict hold-active language. */
  clearanceRequiresExistingPenalty?: boolean;
  clearanceEligibilityFlag?: EligibilityFlag;
};

export const evaluateClearanceCitizenship = (
  job: ExtractedJobData,
  profile: UserProfile,
): ClearanceCitizenshipResult => {
  const citizenshipRequirement = resolveCitizenshipRequirement(job);
  const clearanceRequirement = resolveClearanceRequirement(job);

  const citizenshipMismatch =
    citizenshipRequirement != null &&
    !candidateMeetsCitizenshipRequirement(profile, citizenshipRequirement);

  if (!clearanceRequirement?.required) {
    return {
      citizenshipRequirement,
      clearanceRequirement,
      citizenshipMismatch,
      clearanceMismatch: false,
    };
  }

  const timing = effectiveClearanceTiming(clearanceRequirement.timing);

  if (timing === "active_upfront") {
    const holdsClearance = profile.holdsActiveClearance ?? false;
    if (holdsClearance) {
      return {
        citizenshipRequirement,
        clearanceRequirement,
        citizenshipMismatch,
        clearanceMismatch: false,
      };
    }

    const blob = normalizeText(
      clearanceRequirement.raw ?? jobRequirementBlob(job),
    );
    if (isStrictExistingClearanceRequired(blob)) {
      return {
        citizenshipRequirement,
        clearanceRequirement,
        citizenshipMismatch,
        clearanceMismatch: true,
      };
    }

    return {
      citizenshipRequirement,
      clearanceRequirement,
      citizenshipMismatch,
      clearanceMismatch: false,
      clearanceRequiresExistingPenalty: true,
      clearanceEligibilityFlag: {
        reason: "Likely requires existing clearance — verify before applying.",
        evidence: `clearanceTiming=active_upfront; holdsActiveClearance=false; strictExisting=false`,
        lever: "verify",
        severity: "check",
      },
    };
  }

  if (citizenshipMismatch) {
    return {
      citizenshipRequirement,
      clearanceRequirement,
      citizenshipMismatch,
      clearanceMismatch: false,
    };
  }

  return {
    citizenshipRequirement,
    clearanceRequirement,
    citizenshipMismatch,
    clearanceMismatch: false,
    clearanceEligibilityFlag: {
      reason:
        "Role requires a security clearance (sponsorable) — expect a background investigation and a clearance timeline before/after start.",
      evidence: `clearanceTiming=${timing}; citizenshipRequirement=${citizenshipRequirement ?? "none"}`,
      lever: "verify",
      severity: "check",
    },
  };
};

export const attachClearanceCitizenshipFields = (job: ExtractedJobData): ExtractedJobData => {
  const citizenshipRequirement =
    resolveCitizenshipRequirement(job) ?? job.citizenshipRequirement ?? undefined;
  const clearanceRequirement = resolveClearanceRequirement({
    ...job,
    citizenshipRequirement,
  });
  return {
    ...job,
    citizenshipRequirement,
    clearanceRequirement: clearanceRequirement ?? job.clearanceRequirement,
  };
};
