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
    const midpoint = Math.round((postedMin + postedMax) / 2);
    const conservativeAdjustment =
      recommendation === "yes"
        ? 0.55
        : recommendation === "selective_yes"
          ? 0.51
          : score.total >= 70
            ? 0.48
            : 0.42;
    const ask = Math.round(postedMin + (postedMax - postedMin) * conservativeAdjustment);
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
