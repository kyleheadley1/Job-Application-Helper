import { z } from 'zod';
import { scoringPolicy, SCORE_CATEGORY_MAXES } from '../../config/scoringPolicy.js';
import type { ExtractedJobData } from '../../types/job.js';
import type {
  Recommendation,
  RuleEvaluation,
  ScoreBreakdown,
} from '../../types/scoring.js';
import type { UserProfile } from '../../types/userProfile.js';
import { normalizeText } from '../../lib/text.js';
import { logger } from '../../lib/logger.js';
import { buildScoringPrompt, scoringSystemPrompt } from './prompts.js';
import { preprocessScoringInput } from '../../tools/triageStructuredNormalize.js';
import { responsesClient } from '../../services/llm/responsesClient.js';
import type { StructuredCallDiagnostics } from '../../services/llm/responsesClient.js';
import { polishScoringNarrative } from '../../lib/scoringOutputPolish.js';
import { applyScoringClampLayer } from '../../lib/scoringClampLayer.js';
import { detectCapabilityGap } from '../../lib/capabilityGap.js';
import { computeCompositeScore } from '../../lib/compositeScoreModel.js';
import { userProfile as defaultUserProfile } from '../../config/userProfile.js';

const categorySchema = z.object({
  stackFit: z.number().min(0).max(SCORE_CATEGORY_MAXES.stackFit),
  levelFit: z.number().min(0).max(SCORE_CATEGORY_MAXES.levelFit),
  domainFit: z.number().min(0).max(SCORE_CATEGORY_MAXES.domainFit),
  resumeStoryClarity: z.number().min(0).max(SCORE_CATEGORY_MAXES.resumeStoryClarity),
  functionalOverlap: z.number().min(0).max(SCORE_CATEGORY_MAXES.functionalOverlap),
  recruiterFriendliness: z.number().min(0).max(SCORE_CATEGORY_MAXES.recruiterFriendliness),
  careerValue: z.number().min(0).max(SCORE_CATEGORY_MAXES.careerValue),
  total: z.number().min(0).max(100),
});

const ScoringOutputSchema = z.object({
  score: categorySchema,
  recommendation: z
    .enum(['apply_cold', 'referral_gated', 'stretch_signal', 'skip', 'no', 'yes', 'selective_yes'])
    .optional(),
  topMatch: z.string(),
  mainRisk: z.string(),
  rationale: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});

type ScoringResult = z.infer<typeof ScoringOutputSchema> & { recommendation: Recommendation };

/** Exported for regression tests (live-output normalization). */
export const ScoringFromModelSchema = z.preprocess(
  preprocessScoringInput,
  ScoringOutputSchema,
);

export { computeCompositeScore } from '../../lib/compositeScoreModel.js';

const compositeFromCategories = (params: {
  score: ScoreBreakdown;
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
  profile: UserProfile;
  resumeText?: string;
}) => computeCompositeScore({
  rawScore: params.score,
  rules: params.rules,
  extracted: params.extracted,
  profile: params.profile,
  resumeText: params.resumeText,
});

const deterministicFallback = (
  job: ExtractedJobData,
  rules: RuleEvaluation,
  profile: UserProfile,
  resumeText?: string,
): ScoringResult => {
  const stackHits = [job.stack, job.requiredSkills, job.preferredSkills]
    .flat()
    .join(' ')
    .toLowerCase();
  const fitBlob = normalizeText(
    [
      job.title,
      job.company,
      job.seniority,
      job.location,
      job.rawText,
      ...(job.stack ?? []),
      ...(job.requiredSkills ?? []),
      ...(job.preferredSkills ?? []),
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
    ]
      .filter(Boolean)
      .join(' '),
  );

  let stackFit =
    stackHits.includes('typescript') || stackHits.includes('javascript')
      ? 14
      : 8;
  if (/\btypescript\b/i.test(fitBlob)) stackFit = Math.min(20, stackFit + 2);
  if (/\bnode\.?js\b|\bnode\b/i.test(fitBlob)) stackFit = Math.min(20, stackFit + 1);
  if (/\breact\b/i.test(fitBlob)) stackFit = Math.min(20, stackFit + 1);
  if (/\brest(ful)?\s+apis?\b|\brest\s+api\b/i.test(fitBlob)) stackFit = Math.min(20, stackFit + 1);

  const levelFit = rules.seniorityOverreach ? 6 : 14;
  let domainFit = rules.domainMismatch ? 4 : 7;
  let resumeStoryClarity = rules.stackMismatch ? 5 : 8;
  let functionalOverlap = rules.stackMismatch ? 5 : 10;
  if (/\binternal\s+tools\b/i.test(fitBlob)) functionalOverlap = Math.min(15, functionalOverlap + 1);
  if (/\bai[-\s]?enabled\b|\bllm\b|\bworkflow\b/i.test(fitBlob)) functionalOverlap = Math.min(15, functionalOverlap + 1);

  let recruiterFriendliness = 10;
  if (/\bremote\b|\bdistributed\b|\bwfh\b/i.test(fitBlob)) recruiterFriendliness = Math.min(15, recruiterFriendliness + 1);
  if (/\b(nyc|new york|manhattan|brooklyn|hybrid\s+nyc|hybrid nyc|nyc[-\s]friendly)\b/i.test(fitBlob)) {
    recruiterFriendliness = Math.min(15, recruiterFriendliness + 1);
  }

  let careerValue = 7;
  if (/\bstartup\b|\bseed[-\s]?stage\b/i.test(fitBlob)) careerValue = Math.min(10, careerValue + 1);
  if (/\bproduct\s+engineer\b/i.test(fitBlob)) careerValue = Math.min(10, careerValue + 1);

  if (
    /\b(customer-facing implementation|enterprise apis?|technical onboarding|integrations with)\b/i.test(
      fitBlob,
    )
  ) {
    functionalOverlap = Math.min(15, functionalOverlap + 2);
    stackFit = Math.min(20, stackFit + 1);
    careerValue = Math.min(10, careerValue + 1);
  }

  const appliedAiStrong =
    /\b(llm|rag\b|vector\s+(search|database|db)|embedding|generative ai|ai engineer|agentic|evals?\b|retrieval[-\s]?augmented)\b/i.test(
      fitBlob,
    );
  if (appliedAiStrong) {
    stackFit = Math.min(20, stackFit + 2);
    functionalOverlap = Math.min(15, functionalOverlap + 2);
    resumeStoryClarity = Math.min(10, resumeStoryClarity + 1);
    careerValue = Math.min(10, careerValue + 1);
  }
  if (appliedAiStrong && !rules.domainMismatch) {
    domainFit = Math.max(domainFit, 7);
    if (domainFit === 7 && /\b(agent|agents|evaluation|evals)\b/i.test(fitBlob)) domainFit = 8;
    domainFit = Math.min(10, domainFit);
  }

  const clamped = applyScoringClampLayer({
    score: {
      stackFit,
      levelFit,
      domainFit,
      resumeStoryClarity,
      functionalOverlap,
      recruiterFriendliness,
      careerValue,
      total: 0,
    },
    extracted: job,
    rules,
  });
  const capabilityGap = detectCapabilityGap(job, clamped.score);
  const rulesWithGap = { ...clamped.rules, capabilityGap };
  const composite = compositeFromCategories({
    score: clamped.score,
    extracted: job,
    rules: rulesWithGap,
    profile,
    resumeText,
  });

  return {
    score: composite.score,
    recommendation: composite.recommendation,
    topMatch: 'Backend-leaning product engineering and API overlap.',
    mainRisk:
      composite.hardGateReasons[0] ??
      rules.hardRuleNotes?.[0] ??
      rules.notes[0] ??
      'Recruiter screen realism risk.',
    rationale: [
      `Capability ${composite.score.capability ?? 0} × survivability ${(composite.score.survivability ?? 0).toFixed(2)} → final ${composite.score.total}.`,
      composite.recommendationLabel,
    ],
    risks: [...(rules.hardRuleNotes ?? []), ...rules.notes].slice(0, 2),
  };
};

/** Deterministic scoring path exported for calibration tests. */
export const scoreJobDeterministicPreview = (params: {
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
  userProfile?: UserProfile;
  resumeText?: string;
}): ScoringResult =>
  deterministicFallback(
    params.extracted,
    params.rules,
    params.userProfile ?? defaultUserProfile,
    params.resumeText,
  );

export const scoreJob = async (params: {
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
  userProfile: UserProfile;
  resumeContexts?: import("../../types/resumeContext.js").ResumeContextSet;
  preScoringMetadata?: {
    companyName: string | null;
    jobTitle: string | null;
    location: string | null;
    confidence?: 'high' | 'medium' | 'low';
  };
}): Promise<{
  scoring: ScoringResult;
  rules: RuleEvaluation;
  scoringDiagnostics: StructuredCallDiagnostics;
  scoringLlmSucceeded: boolean;
}> => {
  const fallback = () =>
    deterministicFallback(
      params.extracted,
      params.rules,
      params.userProfile,
      params.resumeContexts?.SWE?.rawText,
    );
  const scoredRun = await responsesClient.runStructured({
    systemPrompt: scoringSystemPrompt,
    userPrompt: buildScoringPrompt({
      extracted: params.extracted,
      rules: params.rules,
      userProfile: params.userProfile,
      scoringPolicy,
      parsedMetadata: params.preScoringMetadata ?? {
        companyName: params.extracted.company,
        jobTitle: params.extracted.title,
        location: params.extracted.location ?? null,
        confidence: 'medium',
      },
    }),
    schema: ScoringFromModelSchema,
    fallback,
  });
  if (!scoredRun.success) {
    logger.warn('Job scoring used deterministic fallback', {
      fallbackUsed: scoredRun.diagnostics.fallbackUsed,
      httpStatus: scoredRun.diagnostics.httpStatus,
      errorCode: scoredRun.diagnostics.errorCode,
      parseStage: scoredRun.diagnostics.parseStage,
      reason: scoredRun.diagnostics.reason,
      errorMessage: scoredRun.diagnostics.errorMessage,
    });
  }
  const llmResult = scoredRun.data;
  const rawScore = llmResult.score;
  console.log('RAW_LLM_SCORES', JSON.stringify({
    stackFit: rawScore.stackFit,
    levelFit: rawScore.levelFit,
    functionalOverlap: rawScore.functionalOverlap,
    total: rawScore.total,
  }));

  const clamped = applyScoringClampLayer({
    score: llmResult.score,
    extracted: params.extracted,
    rules: params.rules,
  });
  const capabilityGap = detectCapabilityGap(params.extracted, clamped.score);
  const rulesWithGap: RuleEvaluation = {
    ...clamped.rules,
    capabilityGap,
  };
  const composite = compositeFromCategories({
    score: clamped.score,
    extracted: params.extracted,
    rules: rulesWithGap,
    profile: params.userProfile,
    resumeText: params.resumeContexts?.SWE?.rawText,
  });

  const polished = polishScoringNarrative({
    narrative: {
      topMatch: llmResult.topMatch,
      mainRisk: llmResult.mainRisk,
      risks: llmResult.risks,
      rationale: llmResult.rationale,
    },
    score: composite.score,
    extracted: params.extracted,
    userProfile: params.userProfile,
    rules: rulesWithGap,
  });

  return {
    scoring: {
      ...llmResult,
      score: polished.score,
      topMatch: polished.topMatch,
      mainRisk: polished.mainRisk,
      risks: polished.risks,
      rationale: polished.rationale,
      recommendation: composite.recommendation,
    },
    rules: rulesWithGap,
    scoringDiagnostics: scoredRun.diagnostics,
    scoringLlmSucceeded: scoredRun.success,
  };
};

export type { ScoringResult };
export type { ScoreBreakdown };
