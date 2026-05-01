import type { ExtractedJobData } from "../../types/job.js";
import type { Recommendation, RuleEvaluation, SalaryAsk, ScoreBreakdown } from "../../types/scoring.js";

export const computeSalaryAsk = (params: {
  extracted: ExtractedJobData;
  score: ScoreBreakdown;
  recommendation: Recommendation;
  rules: RuleEvaluation;
}): SalaryAsk => {
  const { extracted: job, score, recommendation, rules } = params;
  const postedMin = job.salary?.min;
  const postedMax = job.salary?.max;

  if (postedMin && postedMax) {
    const band = postedMax - postedMin;
    let conservativeAdjustment: number =
      recommendation === "yes"
        ? 0.55
        : recommendation === "selective_yes"
          ? 0.51
          : score.total >= 70
            ? 0.48
            : 0.42;
    /** Imperfect level or core stack → upper-mid band (~35–38% of span), not near-top. */
    const levelImperfect = score.levelFit < 10;
    const coreStackWeak = score.stackFit < 18;
    if (levelImperfect || coreStackWeak) {
      conservativeAdjustment = Math.min(conservativeAdjustment, 0.38);
    }
    let ask = Math.round(postedMin + band * conservativeAdjustment);
    /** 200k+ only when fit is elite: high total, strong level/stack, no hard stack mismatch. */
    const eliteForTopSalary =
      score.total >= 82 &&
      score.levelFit >= 10 &&
      score.stackFit >= 20 &&
      !rules.stackMismatch;
    if (ask >= 200_000 && !eliteForTopSalary) {
      ask = Math.min(ask, 190_000);
    }
    return { number: ask, rangeMin: postedMin, rangeMax: postedMax };
  }

  let base = 120000;
  if ((job.yearsExperience?.min ?? 0) <= 2 || (job.seniority ?? "").toLowerCase().includes("junior")) {
    base = 105000;
  }
  if (rules.financePenalty || rules.traditionalCompanyPenalty) base -= 5000;
  if (recommendation === "no") base -= 10000;
  if (score.total >= 80 && recommendation === "yes") base += 5000;

  const spread = score.total >= 80 ? 12000 : 10000;
  return { number: base, rangeMin: base - spread, rangeMax: base + spread };
};
