import type { ExtractedJobData } from "../../types/job.js";
import type { Recommendation, RuleEvaluation, SalaryAsk, ScoreBreakdown } from "../../types/scoring.js";
import { normalizeText } from "../../lib/text.js";
import { jdHasAppliedAiSystemsOverlap } from "../../lib/scoringOutputPolish.js";

const roundToNearest5k = (n: number): number => Math.round(n / 5_000) * 5_000;

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
    /** Mature employer + explicit core-language mismatch: keep ask in a conservative band (~165–175k on wide postings). */
    if (
      rules.explicitCoreLanguageMismatch === true &&
      rules.matureStructuredEmployer === true &&
      band >= 60_000
    ) {
      const conservativeCap = Math.round(postedMin + band * 0.26);
      ask = Math.min(ask, conservativeCap, 175_000);
    }
    /** Plaid-like mature backend/API roles: viable but imperfect fits should stay near lower-mid ($190k-ish on 176–244k bands). */
    if (
      rules.backendProductApiRole === true &&
      rules.infraCoreRole !== true &&
      rules.matureStructuredEmployer === true &&
      postedMin >= 170_000 &&
      recommendation !== "no" &&
      score.total < 82
    ) {
      const conservativeMid = Math.round(postedMin + band * 0.24);
      ask = Math.min(ask, conservativeMid);
      ask = Math.max(ask, 190_000);
    }
    /** Wide $150k+ bands: never anchor below $120k for viable fits (does not override mature-language caps above). */
    if (
      postedMin >= 150_000 &&
      recommendation !== "no" &&
      score.total >= 65 &&
      !rules.stackMismatch
    ) {
      ask = Math.max(ask, 120_000);
    }
    // For narrower/modest posted bands, strong fits can anchor near the top.
    if (score.total >= 78 && band <= 150_000 && postedMax < 150_000 && recommendation !== "no") {
      ask = postedMax;
    } else if (score.total >= 78 && band <= 90_000 && recommendation !== "no" && postedMax < 150_000) {
      ask = Math.max(ask, Math.round(postedMin + band * 0.88));
    } else if (
      score.total >= 70 &&
      score.total <= 77 &&
      recommendation !== "no" &&
      postedMax < 150_000 &&
      band <= 90_000
    ) {
      ask = Math.max(ask, Math.round(postedMin + band * 0.66));
    }
    ask = Math.min(postedMax, Math.max(postedMin, ask));
    ask = roundToNearest5k(ask);
    return { number: ask, rangeMin: postedMin, rangeMax: postedMax };
  }

  const impliedBlob = normalizeText(
    [
      job.title,
      job.rawText ?? "",
      job.seniority ?? "",
      job.location ?? "",
      ...(job.stack ?? []),
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
    ].join(" "),
  );

  const entryLevelAiShape =
    rules.earlyCareerFriendlyRole ||
    (job.yearsExperience?.min ?? 99) <= 2 ||
    /\b(intern|junior|entry[-\s]?level|associate\s+engineer)\b/i.test(impliedBlob);

  const remoteUsShape =
    /\b(remote|anywhere(\s+in)?\s+the\s+us|work\s+from\s+home|wfh)\b/i.test(impliedBlob) &&
    /\b(us|u\.s\.|united states|usa)\b/i.test(impliedBlob);

  const explicitlyLowPayingPosted =
    typeof postedMax === "number" && postedMax > 0 && postedMax < 115_000;

  if (
    entryLevelAiShape &&
    jdHasAppliedAiSystemsOverlap(impliedBlob) &&
    remoteUsShape &&
    !rules.financePenalty &&
    !rules.traditionalCompanyPenalty &&
    !explicitlyLowPayingPosted
  ) {
    const mid = 127_500;
    return { number: roundToNearest5k(mid), rangeMin: 120_000, rangeMax: 135_000 };
  }

  let base = 120000;
  if ((job.yearsExperience?.min ?? 0) <= 2 || (job.seniority ?? "").toLowerCase().includes("junior")) {
    if (
      jdHasAppliedAiSystemsOverlap(impliedBlob) &&
      !rules.financePenalty &&
      !rules.traditionalCompanyPenalty
    ) {
      base = 120000;
    } else {
      base = 105000;
    }
  }
  if (rules.financePenalty || rules.traditionalCompanyPenalty) base -= 5000;
  if (recommendation === "no") base -= 10000;
  if (score.total >= 80 && recommendation === "yes") base += 5000;

  const spread = score.total >= 80 ? 12000 : 10000;
  return { number: roundToNearest5k(base), rangeMin: base - spread, rangeMax: base + spread };
};
