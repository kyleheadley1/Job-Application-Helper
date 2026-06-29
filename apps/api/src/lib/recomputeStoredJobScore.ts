import { evaluateRules } from "../agents/jobAgent/rules.js";
import { computeSalaryAsk } from "../agents/jobAgent/salaryAsk.js";
import { RECOMMENDATION_LABELS } from "../config/capabilitySurvivabilityPolicy.js";
import { userProfile as defaultUserProfile } from "../config/userProfile.js";
import { detectCapabilityGap, detectSpecializationGap } from "./capabilityGap.js";
import { computeCompositeScore } from "./compositeScoreModel.js";
import { applyJdLanguageOutputBoundary } from "./jdLanguageOutputBoundary.js";
import { guardCompositeRecommendation } from "./recommendationGuard.js";
import { detectReferralPathway } from "./referralPathway.js";
import { withSanitizedRuleNotes } from "./riskDisplaySanitizer.js";
import { applyScoringClampLayer } from "./scoringClampLayer.js";
import { buildScoreDisplay } from "./scoreDisplayModel.js";
import type { JobRecord } from "../types/job.js";
import type { ResumeContextSet } from "../types/resumeContext.js";
import type { UserProfile } from "../types/userProfile.js";
import type { Recommendation, RuleEvaluation, SalaryAsk, ScoreBreakdown } from "../types/scoring.js";

/** Strip composite / display fields; keep stored LLM category scores only. */
export const storedCategoryScores = (score: ScoreBreakdown): ScoreBreakdown => ({
  stackFit: score.stackFit,
  levelFit: score.levelFit,
  domainFit: score.domainFit,
  resumeStoryClarity: score.resumeStoryClarity,
  functionalOverlap: score.functionalOverlap,
  recruiterFriendliness: score.recruiterFriendliness,
  careerValue: score.careerValue,
  total: 0,
});

export type RecomputedStoredJobScore = {
  rules: RuleEvaluation;
  score: ScoreBreakdown;
  recommendation: Recommendation;
  salaryAsk: SalaryAsk;
  referralPathwayAvailable?: boolean;
  referralPathwayNotes?: string;
};

/**
 * Deterministic re-score: re-run rules + composite on stored extraction and category scores.
 * Does not call the scoring LLM or re-extract the JD.
 */
export const recomputeStoredJobScore = (params: {
  job: JobRecord;
  profile?: UserProfile;
  resumeContexts?: ResumeContextSet;
}): RecomputedStoredJobScore => {
  const profile = params.profile ?? defaultUserProfile;
  const { job, resumeContexts } = params;
  const activeResumeType = job.recommendedResume ?? "SWE";
  const resumeText =
    resumeContexts?.[activeResumeType]?.rawText ?? resumeContexts?.SWE?.rawText;

  const rules = withSanitizedRuleNotes(
    evaluateRules(job.extracted, profile, { resumeContexts, activeResumeType }),
    job.extracted,
    profile,
  );

  const clamped = applyScoringClampLayer({
    score: storedCategoryScores(job.score),
    extracted: job.extracted,
    rules,
  });

  const capabilityGap = detectCapabilityGap(job.extracted, clamped.score, resumeText);
  const specializationGap = detectSpecializationGap(job.extracted, clamped.score, resumeText);
  const rulesWithGap: RuleEvaluation = {
    ...clamped.rules,
    capabilityGap,
    specializationGap,
  };

  const composite = computeCompositeScore({
    rawScore: clamped.score,
    rules: rulesWithGap,
    extracted: job.extracted,
    profile,
    resumeText,
  });

  const finalRules = applyJdLanguageOutputBoundary(job.extracted, rulesWithGap);

  const referralPathway = detectReferralPathway({
    profile,
    extracted: job.extracted,
    resumeText,
  });

  const scoreDisplay = buildScoreDisplay({
    score: composite.score,
    rules: finalRules,
    extracted: job.extracted,
    profile,
    recommendation: composite.recommendation,
    referralPathwayAvailable: referralPathway.referralPathwayAvailable,
    referralPathwayNotes: referralPathway.referralPathwayNotes,
  });

  const finalRecommendation = guardCompositeRecommendation({
    recommendation: composite.recommendation,
    capability: composite.score.capability ?? 0,
    survivability: composite.score.survivability ?? 0,
    rules: finalRules,
    survivabilityPenalties: scoreDisplay?.survivabilityPenalties ?? [],
  });

  const scoreDisplayFinal = buildScoreDisplay({
    score: composite.score,
    rules: finalRules,
    extracted: job.extracted,
    profile,
    recommendation: finalRecommendation,
    referralPathwayAvailable: referralPathway.referralPathwayAvailable,
    referralPathwayNotes: referralPathway.referralPathwayNotes,
  });

  const scoreWithDisplay: ScoreBreakdown = scoreDisplayFinal
    ? {
        ...composite.score,
        scoreDisplay: scoreDisplayFinal,
        recommendationLabel: scoreDisplayFinal.bandHeadline,
      }
    : {
        ...composite.score,
        recommendationLabel:
          RECOMMENDATION_LABELS[finalRecommendation] ?? composite.recommendationLabel,
      };

  const salaryAsk = computeSalaryAsk({
    extracted: job.extracted,
    score: scoreWithDisplay,
    recommendation: finalRecommendation,
    rules: finalRules,
  });

  return {
    rules: finalRules,
    score: scoreWithDisplay,
    recommendation: finalRecommendation,
    salaryAsk,
    referralPathwayAvailable: referralPathway.referralPathwayAvailable,
    referralPathwayNotes: referralPathway.referralPathwayNotes,
  };
};
