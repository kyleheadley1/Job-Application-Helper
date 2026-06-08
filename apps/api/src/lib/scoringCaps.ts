import { SCORE_CATEGORY_MAXES } from "../config/scoringPolicy.js";
import type { Recommendation, RuleEvaluation, ScoreBreakdown } from "../types/scoring.js";

/** Sum of the seven category scores (excludes cap; use for audit). */
export const sumScoreBreakdown = (s: ScoreBreakdown): number =>
  s.stackFit +
  s.levelFit +
  s.domainFit +
  s.resumeStoryClarity +
  s.functionalOverlap +
  s.recruiterFriendliness +
  s.careerValue;

const HARD_GATE_TOTAL_CAPS: Array<{ when: (rules: RuleEvaluation) => boolean; cap: number }> = [
  {
    when: (r) => Boolean(r.visaMismatch || r.citizenshipMismatch || r.clearanceMismatch),
    cap: 45,
  },
  { when: (r) => Boolean(r.credentialHeavyFintechAlgorithm), cap: 45 },
  { when: (r) => Boolean(r.goDistributedDataInfraCandidateGap), cap: 50 },
  { when: (r) => Boolean(r.strictNewGradPipeline), cap: 62 },
  { when: (r) => Boolean(r.researchHeavyAiRole), cap: 64 },
  { when: (r) => Boolean(r.seniorityOverreach), cap: 66 },
  { when: (r) => Boolean(r.locationMismatch), cap: 68 },
  { when: (r) => Boolean(r.explicitDegreeRisk), cap: 70 },
  { when: (r) => Boolean(r.explicitCoreLanguageMismatch), cap: 74 },
];

/** Hard gates that warrant "apply with caveats" wording in the 78–84 band. */
export const hasHardGateNote = (rules: RuleEvaluation): boolean =>
  Boolean(
    (rules.hardRuleNotes?.length ?? 0) > 0 ||
      rules.visaMismatch ||
      rules.citizenshipMismatch ||
      rules.clearanceMismatch ||
      rules.credentialHeavyFintechAlgorithm ||
      rules.goDistributedDataInfraCandidateGap ||
      rules.strictNewGradPipeline ||
      rules.researchHeavyAiRole ||
      rules.seniorityOverreach ||
      rules.locationMismatch ||
      rules.explicitDegreeRisk ||
      rules.explicitCoreLanguageMismatch,
  );

/**
 * Apply deterministic hard-gate caps after LLM scoring.
 * total = min(sum(categories), lowest applicable cap).
 */
export const applyHardGateCaps = (score: ScoreBreakdown, rules: RuleEvaluation): ScoreBreakdown => {
  let next: ScoreBreakdown = { ...score };
  if (rules.explicitCoreLanguageMismatch) {
    next.stackFit = Math.min(next.stackFit, 11);
  }
  const sum = sumScoreBreakdown(next);
  const caps = HARD_GATE_TOTAL_CAPS.filter((g) => g.when(rules)).map((g) => g.cap);
  const lowestCap = caps.length ? Math.min(...caps) : 100;
  next.total = Math.min(sum, lowestCap);
  return next;
};

const clampCategory = (score: ScoreBreakdown): ScoreBreakdown => ({
  stackFit: Math.min(SCORE_CATEGORY_MAXES.stackFit, Math.max(0, score.stackFit)),
  levelFit: Math.min(SCORE_CATEGORY_MAXES.levelFit, Math.max(0, score.levelFit)),
  domainFit: Math.min(SCORE_CATEGORY_MAXES.domainFit, Math.max(0, score.domainFit)),
  resumeStoryClarity: Math.min(SCORE_CATEGORY_MAXES.resumeStoryClarity, Math.max(0, score.resumeStoryClarity)),
  functionalOverlap: Math.min(SCORE_CATEGORY_MAXES.functionalOverlap, Math.max(0, score.functionalOverlap)),
  recruiterFriendliness: Math.min(SCORE_CATEGORY_MAXES.recruiterFriendliness, Math.max(0, score.recruiterFriendliness)),
  careerValue: Math.min(SCORE_CATEGORY_MAXES.careerValue, Math.max(0, score.careerValue)),
  total: score.total,
});

/** Clamp category scores to current rubric maxes; keep total ≤ sum(categories). */
export const clampScoreToCategoryMaxes = (score: ScoreBreakdown): ScoreBreakdown => {
  const clamped = clampCategory(score);
  const sum = sumScoreBreakdown(clamped);
  return { ...clamped, total: Math.min(Math.max(0, clamped.total), sum) };
};

/** Normalize persisted jobs scored under pre-realignment category caps (e.g. stackFit 25, story 15). */
export const normalizeStoredJobScores = <T extends {
  score: ScoreBreakdown;
  scoreHistory?: Array<{ score: ScoreBreakdown; scoredAt: string; recommendation: import("../types/scoring.js").Recommendation }>;
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

/** Normalize LLM categories to new maxes, set total to sum, then apply caps. */
export const finalizeScore = (score: ScoreBreakdown, rules: RuleEvaluation): ScoreBreakdown => {
  const clamped = clampCategory(score);
  const summed = { ...clamped, total: sumScoreBreakdown(clamped) };
  return applyHardGateCaps(summed, rules);
};

/** Single recommendation table — reads capped total only. */
export const resolveRecommendation = (
  cappedTotal: number,
  rules: RuleEvaluation,
  careerValue: number,
): Recommendation => {
  if (rules.credentialHeavyFintechAlgorithm) return "no";
  if (rules.goDistributedDataInfraCandidateGap) return "no";

  if (cappedTotal >= 85) return "yes";
  if (cappedTotal >= 78) return hasHardGateNote(rules) ? "selective_yes" : "yes";
  if (cappedTotal >= 70) return "selective_yes";
  if (cappedTotal >= 60) {
    const hasUpside =
      careerValue >= 8 ||
      rules.notes.some((n) => /\b(upside|worth applying|strong target|high career value)\b/i.test(n));
    return hasUpside ? "selective_yes" : "no";
  }
  return "no";
};

/** Score-band mapping without gate nuance (78–84 always maps to yes at band level). */
export const mapRecommendationFromScore = (total: number): Recommendation => {
  if (total >= 85) return "yes";
  if (total >= 78) return "yes";
  if (total >= 70) return "selective_yes";
  if (total >= 60) return "no";
  return "no";
};
