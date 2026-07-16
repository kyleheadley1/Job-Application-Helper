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
  /** Fixed decimals applied before any survivability threshold comparison. */
  decimalPlaces: 3,
} as const;

/** Weighted-average deduction when JD likely requires an existing clearance at hire. */
export const CLEARANCE_REQUIRES_EXISTING_SURV_PENALTY = 0.17;

/** Additive composite: capability backbone + bounded survivability adjustment − gap dock. */
export const COMPOSITE_SCORING = {
  /** Survivability at/above this = no penalty; below = steep dock. */
  SURV_NEUTRAL: 0.6,
  /** Points per unit below neutral (asymmetric — penalties are steeper). */
  SURV_PENALTY_SCALE: 40,
  /** Points per unit above neutral (modest boost only). */
  SURV_BONUS_SCALE: 15,
  /** Floor/ceiling on survivability adjustment applied to final. */
  SURV_ADJ_MIN: -18,
  SURV_ADJ_MAX: 8,
  /** Final ≥ this → strong_apply band (slam-dunk confidence). */
  STRONG_APPLY: 85,
  /** Final ≥ this → apply band; below → skip. */
  APPLY_LOW: 58,
  /** Final ≥ this → worth tailoring (Yes vs If quick within apply band). */
  TAILOR_CAPABILITY: 70,
  /** Mild final dock for contract roles (stability / career-value). */
  CONTRACT_FINAL_DOCK: 1,
} as const;

/** Differentiator coverage caps — applied to stackFit + functionalOverlap after normal scoring. */
export const DIFFERENTIATOR_COVERAGE = {
  /** Tags that signal backend/API/AI edge vs generic React/TS stack. */
  TAGS: [
    "backend",
    "rest api",
    "api gateway",
    "microservice",
    "graphql",
    "aws",
    "lambda",
    "dynamodb",
    "s3",
    "cloudwatch",
    "eventbridge",
    "postgres",
    "postgresql",
    "docker",
    "api",
    "node",
    "express",
    "oauth",
    "github app",
    "github integration",
    "rag",
    "vector",
    "qdrant",
    "llm",
    "embedding",
    "queue",
    "bullmq",
    "background job",
    "webhook",
    "sse",
    "server-side streaming",
  ] as const,
  /**
   * Historical none-cap values — no longer applied by applyDifferentiatorCoverageCap
   * (differentiator absence is additive/note-only; role-lane caps still apply).
   */
  NONE_CAP: { stackFit: 22, functionalOverlap: 22 },
  /** One or two differentiator tags — partial edge. */
  PARTIAL_CAP: { stackFit: 28, functionalOverlap: 28 },
  /** Minimum tag count for full capability credit (no cap). */
  STRONG_MIN_TAGS: 3,
} as const;

/** Adjacent analyst / implementation / QA roles — outside core product-SWE lane. */
export const ADJACENT_ROLE_FUNCTION = {
  CAP: { stackFit: 24, functionalOverlap: 20 },
  FLAG: "role-type: implementation/analyst — outside core SWE lane, capability capped",
  /** Never grant strong differentiator tier on adjacent roles. */
  DIFFERENTIATOR_TIER_CEILING: "partial" as const,
} as const;

/**
 * Frontend-primary product roles — backend/API edge is benched (role consumes APIs, not builds them).
 * Milder than adjacent-role caps; still blocks "strong" differentiator from API-consumption tokens.
 */
export const FRONTEND_PRIMARY_ROLE = {
  CAP: { stackFit: 26, functionalOverlap: 26 },
  FLAG: "role-type: frontend-primary — backend/API edge benched",
  DIFFERENTIATOR_TIER_CEILING: "partial" as const,
  NOTE: "frontend-only role, backend/API edge benched (you'd consume APIs, not build them)",
} as const;

/**
 * Platform / infra / SRE / DevOps roles — consumers are other engineers, not end users.
 * Generic aws/backend/api tokens alone must not grant strong differentiator credit.
 */
export const PLATFORM_INFRA_ROLE = {
  CAP: { stackFit: 18, functionalOverlap: 18 },
  FLAG: "role-type: platform/infra — engineer-facing platform, product edge not in play",
  DIFFERENTIATOR_TIER_CEILING: "partial" as const,
  NOTE: "platform/infra role — aws/backend/api tokens are surface-level; consumers are other engineers",
} as const;

/** Listing-shape pool friendliness — tunable weights for survivability sub-factor. */
export const POOL_FRIENDLINESS = {
  NEUTRAL_BASE: 0.5,
  MIN: 0.15,
  MAX: 0.9,
  /** pool ≥ this → favorable lever label */
  FAVORABLE_MIN: 0.62,
  /** pool < this → crowded pool / referral lever */
  CROWDED_MAX: 0.45,
  NICHE_EMPLOYER_MAX: 0.45,
  BRAND_EMPLOYER_MIN: 0.7,
  /** Headcount ≥ this → never apply niche-employer bonus. */
  LARGE_EMPLOYER_EMPLOYEE_FLOOR: 10_000,
  /** Recognizability floor when large employer by headcount (additive with name heuristic). */
  LARGE_EMPLOYER_RECOGNIZABILITY_FLOOR: 0.55,
  /** Default recognizability when company is absent from brand/niche lists. */
  DEFAULT_EMPLOYER_RECOGNIZABILITY: 0.3,
  SPECIFIC_STACK_MIN_HITS: 4,
  REAL_SALARY_MIN: 95_000,
  NICHE_EMPLOYER_BONUS: 0.1,
  SPECIFIC_STACK_BONUS: 0.08,
  DIFFERENTIATOR_ROLE_BONUS: 0.1,
  REAL_SALARY_BONUS: 0.04,
  GEO_FILTER_BONUS: 0.06,
  CATTLE_CALL_PENALTY: -0.15,
  BRAND_EMPLOYER_PENALTY: -0.12,
  GENERIC_STACK_PENALTY: -0.08,
  FRESH_REMOTE_JUNIOR_PENALTY: -0.05,
  LEVER_LABELS: {
    favorable: "favorable listing shape — works in your favor",
    neutral: "neutral pool",
    crowded: "crowded pool — referral is the counter",
  },
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
export type BindingnessTier = "binding" | "material" | "cosmetic" | "structural" | "favorable";

export const BINDINGNESS_TIER_WEIGHT: Record<BindingnessTier, number> = {
  binding: 3,
  material: 2,
  cosmetic: 1,
  structural: 0,
  favorable: 0,
};

export const BINDINGNESS_TIER_RANK: Record<BindingnessTier, number> = {
  binding: 3,
  material: 2,
  cosmetic: 1,
  structural: 0,
  favorable: -1,
};

export const LEVER_TYPE_RANK: Record<
  "referral" | "cover_letter" | "resume" | "credential" | "portfolio" | "upskill" | "none" | "none_in_loop",
  number
> = {
  referral: 3,
  cover_letter: 2,
  resume: 1,
  credential: 1,
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
    leverLabel: "neutral — no explicit degree language",
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
  if (key === "credentialSignal" && rules.explicitDegreeRisk && !rules.degreeEquivalencySatisfied) {
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
