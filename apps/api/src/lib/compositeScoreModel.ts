import {
  RECOMMENDATION_LABELS,
  SURVIVABILITY_TUNING,
} from "../config/capabilitySurvivabilityPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import type { Recommendation, RuleEvaluation, ScoreBreakdown } from "../types/scoring.js";
import type { UserProfile } from "../types/userProfile.js";
import { evaluateHardGates } from "./hardGates.js";
import {
  computeCapabilityBreakdown,
  type CapabilityBreakdown,
} from "./scoreDisplayModel.js";
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
export { computeCapabilityBreakdown };

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
    const capabilityBreakdown = computeCapabilityBreakdown(clamped);
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
      hardGateFired: true,
      hardGateReasons: gate.reasons,
    };
  }

  const capabilityBreakdown = computeCapabilityBreakdown(clamped);
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
  const finalScore = Math.round(capability * survivabilityResult.multiplier);
  const recommendation = resolveCompositeRecommendation(capability, survivabilityResult.multiplier);

  return {
    score: {
      ...clamped,
      capability,
      capabilityBreakdown,
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
