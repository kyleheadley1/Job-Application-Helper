/** Capability dimension maxes (sum = 100). */
export const CAPABILITY_MAXES = {
  stackFit: 35,
  levelFit: 30,
  functionalOverlap: 35,
} as const;

/** Legacy LLM category maxes used before rescaling into capability. */
export const LEGACY_CAPABILITY_SOURCE_MAXES = {
  stackFit: 20,
  levelFit: 20,
  functionalOverlap: 15,
} as const;

export const SURVIVABILITY_TUNING = {
  /** Floor for survivability multiplier (absent hard gate). */
  floor: 0.3,
  /** Threshold on 2x2 matrix — at/above = good cold-apply odds. */
  goodOddsThreshold: 0.55,
  /** Capability threshold on 2x2 matrix. */
  strongCapabilityThreshold: 70,
  /** Final score when a Section-1 hard gate fires. */
  hardGateScoreFloor: 25,
} as const;

/** Additive composite: capability backbone + bounded survivability adjustment − gap dock. */
export const COMPOSITE_SCORING = {
  /** Survivability at/above this boosts final; below docks. */
  SURV_NEUTRAL: 0.5,
  /** Max points survivability can move final either direction. */
  SURV_SWING: 18,
  /** Final ≥ this → strong_apply band (slam-dunk confidence). */
  STRONG_APPLY: 80,
  /** Final ≥ this → apply band; below → skip. */
  APPLY_LOW: 58,
  /** Capability ≥ this → worth tailoring (independent of band). */
  TAILOR_CAPABILITY: 70,
} as const;

export const SCORE_BAND_LABELS: Record<"strong_apply" | "apply" | "skip" | "no", string> = {
  strong_apply: "Clearly in the ballpark — slam-dunk fit",
  apply: "Worth applying — light touch or as-is",
  skip: "Not worth the effort",
  no: "Hard gate — do not apply",
};

export const SURVIVABILITY_WEIGHTS = {
  employerRecognizability: 0.22,
  credentialSignal: 0.15,
  impactMetricQuality: 0.18,
  resumeStoryCoherence: 0.15,
  domainMatchForListing: 0.15,
  poolFriendliness: 0.15,
} as const;

export type SurvivabilitySubFactorKey = keyof typeof SURVIVABILITY_WEIGHTS;

/** How decisively a sub-factor causes first-pass rejection (stable, not score-derived). */
export type BindingnessTier = "binding" | "material" | "cosmetic" | "structural";

export const BINDINGNESS_TIER_WEIGHT: Record<BindingnessTier, number> = {
  binding: 3,
  material: 2,
  cosmetic: 1,
  structural: 0,
};

export const BINDINGNESS_TIER_RANK: Record<BindingnessTier, number> = {
  binding: 3,
  material: 2,
  cosmetic: 1,
  structural: 0,
};

export const LEVER_TYPE_RANK: Record<
  "referral" | "cover_letter" | "resume" | "portfolio" | "upskill" | "none" | "none_in_loop",
  number
> = {
  referral: 3,
  cover_letter: 2,
  resume: 1,
  portfolio: 0,
  upskill: 0,
  none: 0,
  none_in_loop: 0,
};

/** Target sub-factor score for headroom calculation. */
export const SURVIVABILITY_TARGET_NEUTRAL = 0.7;

/** Strategic-value ties within this band use tier → priority → lever type. */
export const STRATEGIC_VALUE_EPSILON = 0.05;

/** Stable tiebreak order — never use raw sub-scores. */
export const SURVIVABILITY_SUB_FACTOR_PRIORITY: SurvivabilitySubFactorKey[] = [
  "credentialSignal",
  "employerRecognizability",
  "domainMatchForListing",
  "impactMetricQuality",
  "resumeStoryCoherence",
  "poolFriendliness",
];

export type SurvivabilitySubFactorMeta = {
  label: string;
  lever: "referral" | "resume" | "cover_letter" | "none" | "none_in_loop";
  leverLabel: string;
  baseBindingness: BindingnessTier;
};

/** Static metadata per sub-factor — bindingness may be adjusted at runtime for context. */
export const SURVIVABILITY_SUB_FACTOR_META: Record<
  SurvivabilitySubFactorKey,
  SurvivabilitySubFactorMeta
> = {
  employerRecognizability: {
    label: "Employer recognizability",
    lever: "resume",
    leverLabel: "resume framing",
    baseBindingness: "material",
  },
  credentialSignal: {
    label: "Credential signal",
    lever: "none",
    leverLabel: "NONE — no in-loop credential fix",
    baseBindingness: "binding",
  },
  impactMetricQuality: {
    label: "Impact metric quality",
    lever: "resume",
    leverLabel: "stronger metrics on resume",
    baseBindingness: "cosmetic",
  },
  resumeStoryCoherence: {
    label: "Resume story coherence",
    lever: "resume",
    leverLabel: "resume framing",
    baseBindingness: "cosmetic",
  },
  domainMatchForListing: {
    label: "Domain match (this listing)",
    lever: "cover_letter",
    leverLabel: "tailored resume / cover letter",
    baseBindingness: "material",
  },
  poolFriendliness: {
    label: "Pool friendliness",
    lever: "none",
    leverLabel: "NONE — structural, can't fix",
    baseBindingness: "structural",
  },
};

import type { Recommendation } from "../types/scoring.js";
import type { RuleEvaluation } from "../types/scoring.js";

/** Credential-dense pools treat employer recognizability as binding. */
export const isCredentialDensePool = (rules: RuleEvaluation): boolean =>
  Boolean(
    rules.productionBarCompetitivePool ||
      rules.matureStructuredEmployer ||
      rules.explicitDegreeRisk,
  );

export const resolveSubFactorBindingness = (
  key: SurvivabilitySubFactorKey,
  rules: RuleEvaluation,
): BindingnessTier => {
  const meta = SURVIVABILITY_SUB_FACTOR_META[key];
  if (key === "employerRecognizability" && isCredentialDensePool(rules)) {
    return "binding";
  }
  return meta.baseBindingness;
};

export const resolveSubFactorPenaltyName = (
  key: SurvivabilitySubFactorKey,
  rules: RuleEvaluation,
): string => {
  if (key === "credentialSignal" && rules.explicitDegreeRisk && !rules.degreeHasEquivalencyClause) {
    return "degree requirement";
  }
  return SURVIVABILITY_SUB_FACTOR_META[key].label.toLowerCase();
};

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  apply_cold: "Strong fit, good screen odds",
  referral_gated: "Strong fit, low cold-apply odds — get a referral / tailor resume / nail the essay",
  stretch_signal: "Stretch on skills; signal may carry you",
  skip: "Weak fit and weak odds",
  no: "Hard gate — do not apply",
  yes: "Strong fit, good screen odds",
  selective_yes: "Strong fit, low cold-apply odds — get a referral / tailor resume / nail the essay",
};
