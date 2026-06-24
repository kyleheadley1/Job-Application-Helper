import { SCORE_CATEGORY_MAXES } from "../config/scoringPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import type { Recommendation, RuleEvaluation, ScoreBreakdown } from "../types/scoring.js";
import type { UserProfile } from "../types/userProfile.js";
import { userProfile as defaultUserProfile } from "../config/userProfile.js";
import { computeCompositeScore, resolveCompositeRecommendation } from "./compositeScoreModel.js";

/** Sum of legacy seven category scores (audit only — not the final model). */
export const sumScoreBreakdown = (s: ScoreBreakdown): number =>
  s.stackFit +
  s.levelFit +
  s.domainFit +
  s.resumeStoryClarity +
  s.functionalOverlap +
  s.recruiterFriendliness +
  s.careerValue;

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

/** Clamp legacy category scores to rubric maxes. */
export const clampScoreToCategoryMaxes = (score: ScoreBreakdown): ScoreBreakdown =>
  clampCategory(score);

/** Normalize persisted jobs scored under pre-realignment category caps. */
export const normalizeStoredJobScores = <T extends {
  score: ScoreBreakdown;
  scoreHistory?: Array<{ score: ScoreBreakdown; scoredAt: string; recommendation: Recommendation }>;
}>(
  job: T,
): T => ({
  ...job,
  score: clampScoreToCategoryMaxes(job.score),
  scoreHistory: job.scoreHistory?.map((entry) => ({
    ...entry,
    score: clampScoreToCategoryMaxes(entry.score),
  })),
});

export type FinalizeScoreContext = {
  extracted?: ExtractedJobData;
  profile?: UserProfile;
  resumeText?: string;
};

/** Composite model: capability × survivability (replaces additive total). */
export const finalizeScore = (
  score: ScoreBreakdown,
  rules: RuleEvaluation,
  context: FinalizeScoreContext = {},
): ScoreBreakdown => {
  const clamped = clampCategory(score);
  if (!context.extracted) {
    return { ...clamped, total: clamped.total || sumScoreBreakdown(clamped) };
  }
  const composite = computeCompositeScore({
    rawScore: clamped,
    rules,
    extracted: context.extracted,
    profile: context.profile ?? defaultUserProfile,
    resumeText: context.resumeText,
  });
  return composite.score;
};

/** @deprecated additive caps — kept for legacy tests; returns input unchanged when composite context absent. */
export const applyHardGateCaps = (score: ScoreBreakdown, rules: RuleEvaluation): ScoreBreakdown =>
  finalizeScore(score, rules);

export const hasHardGateNote = (rules: RuleEvaluation): boolean =>
  Boolean(
    (rules.hardRuleFlags?.length ?? 0) > 0 ||
    (rules.hardRuleNotes?.length ?? 0) > 0 ||
    rules.visaMismatch ||
    rules.citizenshipMismatch ||
    rules.clearanceMismatch ||
    rules.explicitCoreLanguageMismatch ||
    rules.seniorityOverreach ||
    rules.locationMismatch,
  );

/** Resolve recommendation from composite axes when available, else heuristic from total. */
export const resolveRecommendation = (
  cappedTotal: number,
  rules: RuleEvaluation,
  _careerValue: number,
  capability?: number,
  survivability?: number,
): Recommendation => {
  if (capability != null && survivability != null) {
    return resolveCompositeRecommendation(capability, survivability);
  }
  if (rules.explicitCoreLanguageMismatch || rules.visaMismatch || rules.citizenshipMismatch) {
    return "no";
  }
  if (cappedTotal >= 70) return "apply_cold";
  if (cappedTotal >= 50) return "referral_gated";
  if (cappedTotal >= 35) return "stretch_signal";
  return "skip";
};

/** Heuristic band mapping for imported spreadsheet totals. */
export const mapRecommendationFromScore = (total: number): Recommendation => {
  if (total >= 70) return "apply_cold";
  if (total >= 50) return "referral_gated";
  if (total >= 35) return "stretch_signal";
  return "skip";
};
