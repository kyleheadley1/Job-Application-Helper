import {
  CAPABILITY_MAXES,
  LEGACY_CAPABILITY_SOURCE_MAXES,
  RECOMMENDATION_LABELS,
  SURVIVABILITY_TUNING,
} from "../config/capabilitySurvivabilityPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import type { Recommendation, RuleEvaluation, ScoreBreakdown } from "../types/scoring.js";
import type { UserProfile } from "../types/userProfile.js";
import { evaluateHardGates } from "./hardGates.js";
import { computeSurvivability, type SurvivabilityBreakdown } from "./survivabilityScore.js";
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
  survivability: score.survivability,
  survivabilityBreakdown: score.survivabilityBreakdown,
  recommendationLabel: score.recommendationLabel,
});

const scaleToCapability = (raw: number, legacyMax: number, capabilityMax: number): number =>
  Math.round((raw / legacyMax) * capabilityMax);

export const computeCapability = (rawScore: ScoreBreakdown): number => {
  const stack = scaleToCapability(
    rawScore.stackFit,
    LEGACY_CAPABILITY_SOURCE_MAXES.stackFit,
    CAPABILITY_MAXES.stackFit,
  );
  const level = scaleToCapability(
    rawScore.levelFit,
    LEGACY_CAPABILITY_SOURCE_MAXES.levelFit,
    CAPABILITY_MAXES.levelFit,
  );
  const functional = scaleToCapability(
    rawScore.functionalOverlap,
    LEGACY_CAPABILITY_SOURCE_MAXES.functionalOverlap,
    CAPABILITY_MAXES.functionalOverlap,
  );
  return Math.min(100, stack + level + functional);
};

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

export type CompositeScoreResult = {
  score: ScoreBreakdown;
  recommendation: Recommendation;
  recommendationLabel: string;
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
    const capability = computeCapability(clamped);
    return {
      score: {
        ...clamped,
        capability,
        survivability: 0,
        total: SURVIVABILITY_TUNING.hardGateScoreFloor,
        recommendationLabel: RECOMMENDATION_LABELS.no,
      },
      recommendation: "no",
      recommendationLabel: RECOMMENDATION_LABELS.no,
      hardGateFired: true,
      hardGateReasons: gate.reasons,
    };
  }

  const capability = computeCapability(clamped);
  const survivabilityResult = computeSurvivability({
    extracted: params.extracted,
    rules: params.rules,
    profile: params.profile,
    rawScore: clamped,
    resumeText: params.resumeText,
  });
  const finalScore = Math.round(capability * survivabilityResult.multiplier);
  const recommendation = resolveCompositeRecommendation(capability, survivabilityResult.multiplier);

  return {
    score: {
      ...clamped,
      capability,
      survivability: survivabilityResult.multiplier,
      survivabilityBreakdown: survivabilityResult,
      total: finalScore,
      recommendationLabel: RECOMMENDATION_LABELS[recommendation],
    },
    recommendation,
    recommendationLabel: RECOMMENDATION_LABELS[recommendation],
    hardGateFired: false,
    hardGateReasons: [],
  };
};

export type { SurvivabilityBreakdown };
