import type { JobRecord } from "../types/job.js";
import type { RuleEvaluation, ScoreBreakdown, ScoreDisplay } from "../types/scoring.js";
import type { CertificationBoostMeta } from "./certificationBoost.js";
import { clampScoreToCategoryMaxes, sumScoreBreakdown } from "./scoringCaps.js";

const SPECIALIZATION_GAP_KINDS = new Set([
  "backend_stack",
  "design_portfolio",
  "enterprise_iam",
]);

const sanitizeSurvivabilityBreakdown = (score: ScoreBreakdown): ScoreBreakdown => {
  const raw = score.survivabilityBreakdown;
  if (!raw) return score;

  let certificationBoost = score.certificationBoost;
  const numeric: Record<string, number> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      numeric[key] = value;
      continue;
    }
    if (
      key === "certificationBoost" &&
      value &&
      typeof value === "object" &&
      !certificationBoost
    ) {
      certificationBoost = value as CertificationBoostMeta;
    }
  }

  return {
    ...score,
    survivabilityBreakdown: Object.keys(numeric).length ? numeric : undefined,
    certificationBoost,
  };
};

/** Drop cached scoreDisplay rows missing fields added after they were persisted. */
const sanitizeScoreDisplay = (display: ScoreDisplay | undefined): ScoreDisplay | undefined => {
  if (!display) return undefined;
  if (!display.referralAdvice || !display.referralUrgency) return undefined;
  return display;
};

/** Keep legacy totals compatible with ScoreBreakdownSchema superRefine after category clamp. */
const reconcileLegacyTotal = (score: ScoreBreakdown): ScoreBreakdown => {
  if (score.capability != null) return score;
  const legacySum = sumScoreBreakdown(score);
  if (score.total > legacySum + 2) {
    return { ...score, total: Math.min(score.total, legacySum) };
  }
  return score;
};

export const sanitizeScoreBreakdown = (score: ScoreBreakdown): ScoreBreakdown => {
  let next = clampScoreToCategoryMaxes(score);
  next = sanitizeSurvivabilityBreakdown(next);
  next = reconcileLegacyTotal(next);
  return {
    ...next,
    scoreDisplay: sanitizeScoreDisplay(next.scoreDisplay),
  };
};

const sanitizeRules = (rules: RuleEvaluation): RuleEvaluation => {
  const gap = rules.specializationGap;
  if (!gap || SPECIALIZATION_GAP_KINDS.has(gap.kind)) return rules;
  const { specializationGap: _removed, ...rest } = rules;
  return rest as RuleEvaluation;
};

export const sanitizeStoredJobRecord = <T extends JobRecord>(job: T): T => ({
  ...job,
  rules: sanitizeRules(job.rules),
  score: sanitizeScoreBreakdown(job.score),
  scoreHistory: job.scoreHistory?.map((entry) => ({
    ...entry,
    score: sanitizeScoreBreakdown(entry.score),
  })),
});
