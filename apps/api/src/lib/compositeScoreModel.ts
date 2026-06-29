import {
  RECOMMENDATION_LABELS,
  SURVIVABILITY_TUNING,
} from "../config/capabilitySurvivabilityPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import type {
  Recommendation,
  RuleEvaluation,
  ScoreBand,
  ScoreBreakdown,
  SpecializationGap,
} from "../types/scoring.js";
import type { UserProfile } from "../types/userProfile.js";
import {
  specializationGapIsNonAddressable,
} from "./capabilityGap.js";
import {
  computeFinalComposite,
  computeGapDock,
  computeWorthTailoring,
  resolveBandHeadline,
  resolveScoreBand,
} from "./compositeScoring.js";
import { evaluateHardGates } from "./hardGates.js";
import {
  buildFullCapabilityBreakdown,
  computeCapabilityBreakdown,
  type CapabilityBreakdown,
} from "./scoreDisplayModel.js";
import { computeSurvivability, toPersistedSurvivabilityBreakdown, type SurvivabilityBreakdown } from "./survivabilityScore.js";
import { SCORE_CATEGORY_MAXES } from "../config/scoringPolicy.js";

const clampCategory = (score: ScoreBreakdown): ScoreBreakdown => ({
  stackFit: Math.min(SCORE_CATEGORY_MAXES.stackFit, Math.max(0, score.stackFit)),
  levelFit: Math.min(SCORE_CATEGORY_MAXES.levelFit, Math.max(0, score.levelFit)),
  domainFit: Math.min(SCORE_CATEGORY_MAXES.domainFit, Math.max(0, score.domainFit)),
  resumeStoryClarity: Math.min(SCORE_CATEGORY_MAXES.resumeStoryClarity, Math.max(0, score.resumeStoryClarity)),
  functionalOverlap: Math.min(SCORE_CATEGORY_MAXES.functionalOverlap, Math.max(0, score.functionalOverlap)),
  recruiterFriendliness: Math.min(SCORE_CATEGORY_MAXES.recruiterFriendliness, Math.max(0, score.recruiterFriendliness)),
  careerValue: Math.min(SCORE_CATEGORY_MAXES.careerValue, Math.max(0, score.careerValue)),
  total: score.total,
  capability: score.capability,
  capabilityBreakdown: score.capabilityBreakdown,
  survivability: score.survivability,
  survivabilityBreakdown: score.survivabilityBreakdown,
  scoreDisplay: score.scoreDisplay,
  recommendationLabel: score.recommendationLabel,
});

export const computeCapability = (rawScore: ScoreBreakdown): number => {
  const breakdown = computeCapabilityBreakdown(rawScore);
  return Math.min(
    100,
    breakdown.stackFit + breakdown.levelFit + breakdown.functionalOverlap,
  );
};

export type { CapabilityBreakdown };
export { computeCapabilityBreakdown, buildFullCapabilityBreakdown };

/** Legacy 2×2 matrix — retained for guards and calibration helpers. */
export const resolveCompositeRecommendation = (
  capability: number,
  survivability: number,
): Recommendation => {
  const strongCap = capability >= SURVIVABILITY_TUNING.strongCapabilityThreshold;
  const goodOdds = survivability >= SURVIVABILITY_TUNING.goodOddsThreshold;
  if (strongCap && goodOdds) return "apply_cold";
  if (strongCap && !goodOdds) return "referral_gated";
  if (!strongCap && goodOdds) return "stretch_signal";
  return "skip";
};

export const resolveBandRecommendation = (
  band: ScoreBand,
  capability: number,
  survivability: number,
  gap: SpecializationGap | undefined,
): Recommendation => {
  if (band === "no") return "no";
  if (gap?.severity === "central" && gap.lever !== "resume") {
    return band === "skip" ? "skip" : "stretch_signal";
  }
  if (band === "strong_apply") {
    return survivability >= SURVIVABILITY_TUNING.goodOddsThreshold
      ? "apply_cold"
      : "referral_gated";
  }
  if (band === "apply") {
    if (capability >= SURVIVABILITY_TUNING.strongCapabilityThreshold) {
      return "referral_gated";
    }
    return "stretch_signal";
  }
  return "skip";
};

export const adjustRecommendationForSpecializationGap = (
  recommendation: Recommendation,
  gap: SpecializationGap | undefined,
): Recommendation => {
  if (!gap || !specializationGapIsNonAddressable(gap)) return recommendation;
  if (recommendation === "referral_gated" || recommendation === "apply_cold") {
    return "stretch_signal";
  }
  if (recommendation === "skip" && gap.severity === "central") return "skip";
  return recommendation;
};

export type CompositeScoreResult = {
  score: ScoreBreakdown;
  recommendation: Recommendation;
  recommendationLabel: string;
  scoreBand: ScoreBand;
  hardGateFired: boolean;
  hardGateReasons: string[];
};

export const computeCompositeScore = (params: {
  rawScore: ScoreBreakdown;
  rules: RuleEvaluation;
  extracted: ExtractedJobData;
  profile: UserProfile;
  resumeText?: string;
}): CompositeScoreResult => {
  const clamped = clampCategory(params.rawScore);
  const gate = evaluateHardGates(params.rules, params.extracted);

  if (gate.fired) {
    const { breakdown: capabilityBreakdown } = buildFullCapabilityBreakdown(
      clamped,
      params.rules,
      params.extracted,
    );
    const capability = Math.min(
      100,
      capabilityBreakdown.stackFit +
        capabilityBreakdown.levelFit +
        capabilityBreakdown.functionalOverlap,
    );
    return {
      score: {
        ...clamped,
        capability,
        capabilityBreakdown,
        survivability: 0,
        total: SURVIVABILITY_TUNING.hardGateScoreFloor,
        recommendationLabel: RECOMMENDATION_LABELS.no,
      },
      recommendation: "no",
      recommendationLabel: RECOMMENDATION_LABELS.no,
      scoreBand: "no",
      hardGateFired: true,
      hardGateReasons: gate.reasons,
    };
  }

  const { breakdown: capabilityBreakdown, differentiatorCoverage } =
    buildFullCapabilityBreakdown(clamped, params.rules, params.extracted);
  const capability = Math.min(
    100,
    capabilityBreakdown.stackFit +
      capabilityBreakdown.levelFit +
      capabilityBreakdown.functionalOverlap,
  );
  const survivabilityResult = computeSurvivability({
    extracted: params.extracted,
    rules: params.rules,
    profile: params.profile,
    rawScore: clamped,
    resumeText: params.resumeText,
  });
  const gapDock = computeGapDock(params.rules, params.profile);
  const composite = computeFinalComposite({
    capability,
    survivability: survivabilityResult.multiplier,
    gapDock,
  });
  const scoreBand = resolveScoreBand(composite.final);
  const worthTailoring = computeWorthTailoring(composite.final, scoreBand);
  const bandHeadline = resolveBandHeadline(scoreBand, composite.final);
  const recommendation = adjustRecommendationForSpecializationGap(
    resolveBandRecommendation(
      scoreBand,
      capability,
      survivabilityResult.multiplier,
      params.rules.specializationGap,
    ),
    params.rules.specializationGap,
  );

  return {
    score: {
      ...clamped,
      capability,
      capabilityBreakdown,
      differentiatorCoverageNote: differentiatorCoverage.note,
      survivability: survivabilityResult.multiplier,
      survivabilityBreakdown: toPersistedSurvivabilityBreakdown(survivabilityResult),
      certificationBoost: survivabilityResult.certificationBoost,
      total: composite.final,
      recommendationLabel: bandHeadline,
    },
    recommendation,
    recommendationLabel: bandHeadline,
    scoreBand,
    hardGateFired: false,
    hardGateReasons: [],
  };
};

export type { SurvivabilityBreakdown };
