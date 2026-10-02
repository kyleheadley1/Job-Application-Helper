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
} from "../types/scoring.js";
import type { UserProfile } from "../types/userProfile.js";
import {
  computeFinalComposite,
  computeGapDock,
  computeWorthTailoring,
  resolveBandHeadline,
  resolveScoreBand,
} from "./compositeScoring.js";
import { contractFinalDock } from "./contractEmployment.js";
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
    const survivabilityResult = computeSurvivability({
      extracted: params.extracted,
      rules: params.rules,
      profile: params.profile,
      rawScore: clamped,
      resumeText: params.resumeText,
    });
    const gapDock = computeGapDock(params.rules, params.profile);
    return {
      score: {
        ...clamped,
        capability,
        capabilityBreakdown,
        survivability: survivabilityResult.multiplier,
        survivabilityBreakdown: toPersistedSurvivabilityBreakdown(survivabilityResult),
        certificationBoost: survivabilityResult.certificationBoost,
        total: SURVIVABILITY_TUNING.hardGateScoreFloor,
        recommendationLabel: RECOMMENDATION_LABELS.weak,
      },
      recommendation: "weak",
      recommendationLabel: RECOMMENDATION_LABELS.weak,
      scoreBand: "weak",
      hardGateFired: true,
      hardGateReasons: gate.reasons,
    };
  }

  const { breakdown: capabilityBreakdown, differentiatorCoverage, roleFunctionCapNote } =
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
  const contractDock = contractFinalDock(params.extracted);
  const composite = computeFinalComposite({
    capability,
    survivability: survivabilityResult.multiplier,
    gapDock,
    contractDock,
  });
  const scoreBand = resolveScoreBand(composite.final);
  const worthTailoring = computeWorthTailoring(composite.final, scoreBand);
  const bandHeadline = resolveBandHeadline(scoreBand, composite.final);
  const recommendation: Recommendation = scoreBand;

  return {
    score: {
      ...clamped,
      capability,
      capabilityBreakdown,
      differentiatorCoverageNote: differentiatorCoverage.note,
      roleFunctionCapNote,
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
