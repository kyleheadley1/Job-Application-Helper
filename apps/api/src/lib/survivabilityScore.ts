import {
  CLEARANCE_REQUIRES_EXISTING_SURV_PENALTY,
  SURVIVABILITY_TUNING,
  SURVIVABILITY_WEIGHTS,
  type SurvivabilitySubFactorKey,
} from "../config/capabilitySurvivabilityPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import type { RuleEvaluation, ScoreBreakdown } from "../types/scoring.js";
import type { UserProfile } from "../types/userProfile.js";
import { applyCertificationBoost, type CertificationBoostMeta } from "./certificationBoost.js";
import { profileHasAssociateDegree, profileHasBootcampCert } from "./degreeEquivalency.js";
import { computePoolFriendliness, type PoolFriendlinessMeta } from "./poolFriendliness.js";
import { normalizeText } from "./text.js";

export type SurvivabilityBreakdown = Record<SurvivabilitySubFactorKey, number> & {
  weightedAverage: number;
  multiplier: number;
  certificationBoost?: CertificationBoostMeta;
  poolFriendlinessMeta?: PoolFriendlinessMeta;
};

export const toPersistedSurvivabilityBreakdown = (
  breakdown: SurvivabilityBreakdown,
): Record<string, number> => ({
  employerRecognizability: breakdown.employerRecognizability,
  credentialSignal: breakdown.credentialSignal,
  impactMetricQuality: breakdown.impactMetricQuality,
  resumeStoryCoherence: breakdown.resumeStoryCoherence,
  domainMatchForListing: breakdown.domainMatchForListing,
  poolFriendliness: breakdown.poolFriendliness,
  weightedAverage: breakdown.weightedAverage,
  multiplier: breakdown.multiplier,
});

export const hydrateSurvivabilityBreakdown = (
  score: Pick<ScoreBreakdown, "survivabilityBreakdown" | "survivability" | "certificationBoost">,
): SurvivabilityBreakdown | undefined => {
  const raw = score.survivabilityBreakdown;
  if (!raw) return undefined;

  return {
    employerRecognizability: raw.employerRecognizability ?? 0,
    credentialSignal: raw.credentialSignal ?? 0,
    impactMetricQuality: raw.impactMetricQuality ?? 0,
    resumeStoryCoherence: raw.resumeStoryCoherence ?? 0,
    domainMatchForListing: raw.domainMatchForListing ?? 0,
    poolFriendliness: raw.poolFriendliness ?? 0,
    weightedAverage: raw.weightedAverage ?? score.survivability ?? 0,
    multiplier: raw.multiplier ?? score.survivability ?? 0,
    certificationBoost: score.certificationBoost,
  };
};

const KNOWN_EMPLOYER_FT =
  /\b(full[-\s]?time|software engineer|engineer)\b[^.\n]{0,120}\b(google|meta|amazon|microsoft|apple|netflix|stripe|spotify|uber|airbnb|salesforce|databricks|openai|anthropic)\b/i;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const jobBlob = (job: ExtractedJobData): string =>
  normalizeText(
    [
      job.company,
      job.title,
      job.rawText ?? "",
      ...(job.domainTags ?? []),
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
    ].join("\n"),
  );

function profileHasCsDegree(profile: UserProfile): boolean {
  if (!profile.degreeStatus.hasBachelors) return false;
  const blob = normalizeText(
    [profile.degreeStatus.note, profile.training?.program ?? "", profile.headline].join(" "),
  );
  return /\b(computer science|comp sci|cs degree|b\.?s\.?\s*(in\s*)?cs)\b/i.test(blob);
}

export const scoreEmployerRecognizability = (resumeText: string): number => {
  const t = normalizeText(resumeText);
  if (KNOWN_EMPLOYER_FT.test(t)) return 0.95;
  if (/\b(full[-\s]?time|fte)\b/i.test(t) && /\b(inc\.|corp|corporation)\b/i.test(t)) return 0.75;
  if (/\b(residency|resident engineer|fellowship|cohort program|open[-\s]?source product residency)\b/i.test(t)) {
    return 0.38;
  }
  if (/\b(contract|contractor|consulting|staff aug)\b/i.test(t)) return 0.28;
  return 0.32;
};

export const scoreCredentialSignal = (profile: UserProfile, rules: RuleEvaluation): number => {
  const densePool =
    Boolean(rules.productionBarCompetitivePool) ||
    Boolean(rules.matureStructuredEmployer && !rules.degreeHasEquivalencyClause) ||
    (rules.explicitDegreeRisk && !rules.degreeEquivalencySatisfied);
  if (rules.degreeEquivalencySatisfied) {
    if (profileHasCsDegree(profile)) return 0.95;
    if (profileHasAssociateDegree(profile) || profileHasBootcampCert(profile)) {
      return densePool ? 0.68 : 0.78;
    }
    return densePool ? 0.62 : 0.72;
  }
  if (profileHasCsDegree(profile)) return 0.95;
  if (profile.degreeStatus.hasBachelors && !densePool) return 0.72;
  if (rules.degreeHasEquivalencyClause) {
    if (/\b(associate of arts|associate'?s)\b/i.test(profile.degreeStatus.note)) {
      return densePool ? 0.48 : 0.58;
    }
    if (profile.training?.program && /\b(bootcamp|codesmith|residency|fellowship)\b/i.test(profile.training.program)) {
      return densePool ? 0.5 : 0.62;
    }
    return densePool ? 0.55 : 0.65;
  }
  if (/\b(associate of arts|associate'?s)\b/i.test(profile.degreeStatus.note)) {
    return densePool ? 0.38 : 0.52;
  }
  if (profile.training?.program && /\b(bootcamp|codesmith|residency|fellowship)\b/i.test(profile.training.program)) {
    return densePool ? 0.4 : 0.58;
  }
  return densePool ? 0.32 : 0.5;
};

export const scoreImpactMetricQuality = (resumeText: string): number => {
  const t = normalizeText(resumeText);
  const weak =
    /\b(~\d+%|\best\.|\(est\.\)|\d+\+\s+internal|10\+ internal|small[-\s]?scale|pilot)\b/i.test(t);
  const strong =
    /\b(\d{1,3}[mMbBkK]\+?\s+(users|customers|requests|transactions)|million|billion|\d{2,3}%[^~]{0,20}(increase|reduction|growth|improvement))\b/i.test(
      t,
    );
  if (strong && !weak) return 0.88;
  if (strong && weak) return 0.62;
  if (weak) return 0.32;
  return 0.52;
};

export const scoreResumeStoryCoherence = (
  resumeText: string,
  rawScore: ScoreBreakdown,
): number => {
  const t = normalizeText(resumeText);
  const llmNorm = rawScore.resumeStoryClarity / 10;
  let penalty = 0;
  if (/\b(residency|contract|contractor)\b/i.test(t)) penalty += 0.22;
  if (/\b(internal tools|internal users|internal web)\b/i.test(t)) penalty += 0.08;
  if (!/\bfull[-\s]?time\b/i.test(t)) penalty += 0.12;
  return clamp01(llmNorm * 0.55 + (1 - penalty) * 0.45);
};

export const scoreDomainMatchForListing = (
  job: ExtractedJobData,
  resumeText: string,
  rules: RuleEvaluation,
  rawScore: ScoreBreakdown,
): number => {
  const blob = jobBlob(job);
  const resume = normalizeText(resumeText);
  if (rules.domainMismatch) return 0.18;
  const domainSpecific =
    /\b(ehr|hipaa|clinical|healthcare compliance|medical records|phi|fda|gaap|asc\s*606|payments compliance)\b/i.test(
      blob,
    );
  const profileDomain = /\b(ehr|hipaa|clinical|healthcare|gaap|payments|fintech)\b/i.test(resume);
  if (domainSpecific && !profileDomain) return 0.32;
  return clamp01((rawScore.domainFit / 10) * 0.65 + 0.2);
};

export { scorePoolFriendliness } from "./poolFriendliness.js";

export const computeSurvivability = (params: {
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
  profile: UserProfile;
  rawScore: ScoreBreakdown;
  resumeText?: string;
}): SurvivabilityBreakdown => {
  const resumeText = params.resumeText ?? "";

  const baseCredentialSignal = scoreCredentialSignal(params.profile, params.rules);
  const credentialBoost = applyCertificationBoost(
    baseCredentialSignal,
    params.profile,
    params.extracted,
  );

  const poolMeta = computePoolFriendliness(params.extracted, params.profile);

  const subFactors: Record<SurvivabilitySubFactorKey, number> = {
    employerRecognizability: scoreEmployerRecognizability(resumeText),
    credentialSignal: credentialBoost.score,
    impactMetricQuality: scoreImpactMetricQuality(resumeText),
    resumeStoryCoherence: scoreResumeStoryCoherence(resumeText, params.rawScore),
    domainMatchForListing: scoreDomainMatchForListing(
      params.extracted,
      resumeText,
      params.rules,
      params.rawScore,
    ),
    poolFriendliness: poolMeta.score,
  };

  let weightedAverage = 0;
  for (const [key, weight] of Object.entries(SURVIVABILITY_WEIGHTS) as Array<
    [SurvivabilitySubFactorKey, number]
  >) {
    weightedAverage += subFactors[key] * weight;
  }

  if (params.rules.clearanceRequiresExistingPenalty) {
    weightedAverage -= CLEARANCE_REQUIRES_EXISTING_SURV_PENALTY;
  }

  const multiplier = Math.min(
    1,
    Math.max(SURVIVABILITY_TUNING.floor, weightedAverage),
  );

  return {
    ...subFactors,
    weightedAverage,
    multiplier,
    certificationBoost: credentialBoost.boost,
    poolFriendlinessMeta: poolMeta,
  };
};
