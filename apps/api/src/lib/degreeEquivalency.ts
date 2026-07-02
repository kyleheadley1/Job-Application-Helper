import type { ExtractedJobData } from "../types/job.js";
import type { RuleEvaluation } from "../types/scoring.js";
import type { UserProfile } from "../types/userProfile.js";
import { normalizeText } from "./text.js";

const profileCredentialBlob = (profile: UserProfile): string =>
  normalizeText(
    [profile.degreeStatus.note, profile.training?.program ?? "", profile.headline].join(" "),
  );

export const profileHasAssociateDegree = (profile: UserProfile): boolean => {
  if (profile.degreeStatus.hasBachelors) return false;
  return /\b(associate of arts|associate'?s(?:\s+degree)?|\ba\.?\s*a\.?\b)\b/i.test(
    profileCredentialBlob(profile),
  );
};

export const profileHasBootcampCert = (profile: UserProfile): boolean => {
  const blob = profileCredentialBlob(profile);
  if (/\b(bootcamp|codesmith|certificate|certification program|software development certificate)\b/i.test(blob)) {
    return true;
  }
  return Boolean(
    profile.training?.program &&
      /\b(bootcamp|codesmith|residency|fellowship|certificate)\b/i.test(profile.training.program),
  );
};

/** JD exposes an alternate credential path — not an unconditional degree hard gate. */
export const jdHasDegreeEquivalencyClause = (
  combinedText: string,
  degreeLevel: ExtractedJobData["degreeRequirement"] extends { level?: infer L } ? L : string | undefined,
  degreeRaw = "",
): boolean => {
  const dr = normalizeText(degreeRaw);
  return (
    degreeLevel === "equivalent_allowed" ||
    degreeLevel === "preferred" ||
    /\bin lieu of (?:a )?degree\b/i.test(combinedText) ||
    /\bcertificate in lieu\b/i.test(combinedText) ||
    /\bcompleted [^.\n]{0,80}certificate in lieu\b/i.test(combinedText) ||
    /\bassociate or bachelor'?s?\b/i.test(combinedText) ||
    /\bassociate'?s?\s+or\s+bachelor'?s?\b/i.test(combinedText) ||
    /\bbootcamp accepted\b/i.test(combinedText) ||
    /\bbootcamp[^.\n]{0,80}\b(accepted|considered|welcome|qualify)\b/i.test(combinedText) ||
    /\bor related experience\b/i.test(combinedText) ||
    /\bor equivalent experience\b/i.test(combinedText) ||
    /\bor equivalent practical experience\b/i.test(combinedText) ||
    /\bor comparable experience\b/i.test(combinedText) ||
    /\brelevant experience may substitute\b/i.test(combinedText) ||
    /\bexperience in lieu of a degree\b/i.test(combinedText) ||
    /\b(bachelor'?s?|degree)\s+or\s+equivalent\b/i.test(combinedText) ||
    /\bdegree preferred but not required\b/i.test(combinedText) ||
    /\bdegree is a plus\b/i.test(combinedText) ||
    /\b(preferred|nice to have|a plus)\b[^.\n]{0,80}\b(degree|bachelor)\b/i.test(combinedText) ||
    /\b(bootcamp|open[-\s]?source|project experience)\b[^.\n]{0,100}\b(accepted|considered|welcome|qualify)\b/i.test(
      combinedText,
    ) ||
    /\b(bachelor|degree)[^.\n]{0,120}\bor equivalent\b/i.test(combinedText) ||
    /\bor equivalent[^.\n]{0,80}\b(bachelor|degree)\b/i.test(combinedText) ||
    /\bassociate[^.\n]{0,80}\bor[^.\n]{0,40}\bbachelor/i.test(combinedText) ||
    /\bbachelor[^.\n]{0,80}\bor[^.\n]{0,40}\bassociate/i.test(combinedText) ||
    /\bin lieu of\b/i.test(dr)
  );
};

export const jdAcceptsAssociateDegreePath = (combinedText: string, degreeRaw = ""): boolean => {
  const blob = normalizeText(`${combinedText}\n${degreeRaw}`);
  return (
    /\bassociate or bachelor'?s?\b/i.test(blob) ||
    /\bassociate'?s?\s+or\s+bachelor'?s?\b/i.test(blob) ||
    /\bassociate'?s?\s+degree\b/i.test(blob) ||
    /\bassociate[^.\n]{0,80}\bor[^.\n]{0,40}\bbachelor/i.test(blob)
  );
};

export const jdAcceptsCertificateInLieuPath = (combinedText: string, degreeRaw = ""): boolean => {
  const blob = normalizeText(`${combinedText}\n${degreeRaw}`);
  return (
    /\bin lieu of (?:a )?degree\b/i.test(blob) ||
    /\bcertificate in lieu\b/i.test(blob) ||
    /\bsoftware development certificate\b/i.test(blob) ||
    /\bbootcamp accepted\b/i.test(blob) ||
    /\bbootcamp[^.\n]{0,80}\b(accepted|considered|welcome|qualify)\b/i.test(blob)
  );
};

/** Candidate meets at least one JD-accepted alternate credential path. */
export const candidateSatisfiesDegreeEquivalency = (
  profile: UserProfile,
  combinedText: string,
  degreeLevel: ExtractedJobData["degreeRequirement"] extends { level?: infer L } ? L : string | undefined,
  degreeRaw = "",
): boolean => {
  if (profile.degreeStatus.hasBachelors) return true;
  if (!jdHasDegreeEquivalencyClause(combinedText, degreeLevel, degreeRaw)) return false;

  const hasAssociate = profileHasAssociateDegree(profile);
  const hasBootcamp = profileHasBootcampCert(profile);

  if (hasAssociate && jdAcceptsAssociateDegreePath(combinedText, degreeRaw)) return true;
  if (hasBootcamp && jdAcceptsCertificateInLieuPath(combinedText, degreeRaw)) return true;

  return false;
};

export const resolveDegreeEquivalencyRules = (
  profile: UserProfile,
  combinedText: string,
  degreeRequiredSignal: boolean,
  degreeLevel: ExtractedJobData["degreeRequirement"] extends { level?: infer L } ? L : string | undefined,
  degreeRaw = "",
): Pick<
  RuleEvaluation,
  "degreeHasEquivalencyClause" | "degreeEquivalencySatisfied" | "explicitDegreeRisk"
> => {
  const degreeHasEquivalencyClause = jdHasDegreeEquivalencyClause(combinedText, degreeLevel, degreeRaw);
  const degreeEquivalencySatisfied = candidateSatisfiesDegreeEquivalency(
    profile,
    combinedText,
    degreeLevel,
    degreeRaw,
  );
  const explicitDegreeRisk =
    degreeRequiredSignal && !degreeHasEquivalencyClause && !degreeEquivalencySatisfied;

  return {
    degreeHasEquivalencyClause,
    degreeEquivalencySatisfied,
    explicitDegreeRisk,
  };
};
