import { z } from "zod";
import { scoringPolicy } from "../../config/scoringPolicy.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { Recommendation, RuleEvaluation, ScoreBreakdown } from "../../types/scoring.js";
import type { UserProfile } from "../../types/userProfile.js";
import { normalizeText } from "../../lib/text.js";
import { logger } from "../../lib/logger.js";
import { buildScoringPrompt, scoringSystemPrompt } from "./prompts.js";
import { preprocessScoringInput } from "../../tools/triageStructuredNormalize.js";
import { responsesClient } from "../../services/llm/responsesClient.js";
import type { StructuredCallDiagnostics } from "../../services/llm/responsesClient.js";

const ScoringOutputSchema = z.object({
  score: z.object({
    stackFit: z.number().min(0).max(25),
    levelFit: z.number().min(0).max(15),
    domainFit: z.number().min(0).max(10),
    resumeStoryClarity: z.number().min(0).max(15),
    functionalOverlap: z.number().min(0).max(10),
    recruiterFriendliness: z.number().min(0).max(15),
    careerValue: z.number().min(0).max(10),
    total: z.number().min(0).max(100),
  }),
  recommendation: z.enum(["yes", "selective_yes", "no"]),
  topMatch: z.string(),
  mainRisk: z.string(),
  rationale: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});

type ScoringResult = z.infer<typeof ScoringOutputSchema>;

/** Exported for regression tests (live-output normalization). */
export const ScoringFromModelSchema = z.preprocess(preprocessScoringInput, ScoringOutputSchema);

export const mapRecommendationFromScore = (total: number): Recommendation =>
  scoringPolicy.recommendationMapping.find((entry) => total >= entry.min && total <= entry.max)?.recommendation ?? "no";

const deterministicFallback = (job: ExtractedJobData, rules: RuleEvaluation): ScoringResult => {
  const stackHits = [job.stack, job.requiredSkills, job.preferredSkills].flat().join(" ").toLowerCase();
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
      .join(" "),
  );

  let stackFit = stackHits.includes("typescript") || stackHits.includes("javascript") ? 18 : 10;
  if (/\btypescript\b/i.test(fitBlob)) stackFit = Math.min(25, stackFit + 2);
  if (/\bnode\.?js\b|\bnode\b/i.test(fitBlob)) stackFit = Math.min(25, stackFit + 1);
  if (/\breact\b/i.test(fitBlob)) stackFit = Math.min(25, stackFit + 1);
  if (/\brest(ful)?\s+apis?\b|\brest\s+api\b/i.test(fitBlob)) stackFit = Math.min(25, stackFit + 1);

  const levelFit = rules.seniorityOverreach ? 5 : 11;
  const domainFit = rules.domainMismatch ? 4 : 7;
  const resumeStoryClarity = rules.stackMismatch ? 6 : 11;
  let functionalOverlap = rules.stackMismatch ? 4 : 7;
  if (/\binternal\s+tools\b/i.test(fitBlob)) functionalOverlap = Math.min(10, functionalOverlap + 1);
  if (/\bai[-\s]?enabled\b|\bllm\b|\bworkflow\b/i.test(fitBlob)) functionalOverlap = Math.min(10, functionalOverlap + 1);

  let recruiterFriendliness = Math.max(0, 12 - Object.keys(rules.penaltyVector ?? {}).length * 2);
  if (/\bremote\b|\bdistributed\b|\bwfh\b/i.test(fitBlob)) recruiterFriendliness = Math.min(15, recruiterFriendliness + 1);
  if (/\b(nyc|new york|manhattan|brooklyn|hybrid\s+nyc|nyc[-\s]friendly)\b/i.test(fitBlob)) {
    recruiterFriendliness = Math.min(15, recruiterFriendliness + 1);
  }

  let careerValue = 7;
  if (/\bstartup\b|\bseed[-\s]?stage\b/i.test(fitBlob)) careerValue = Math.min(10, careerValue + 1);
  if (/\bproduct\s+engineer\b/i.test(fitBlob)) careerValue = Math.min(10, careerValue + 1);

  const subtotal =
    stackFit + levelFit + domainFit + resumeStoryClarity + functionalOverlap + recruiterFriendliness + careerValue;
  const penalty = Object.values(rules.penaltyVector ?? {}).reduce((sum, value) => sum + value, 0);
  const total = Math.max(0, Math.min(100, subtotal - Math.round(penalty / 3)));
  const recommendation = mapRecommendationFromScore(total);
  return {
    score: {
      stackFit,
      levelFit,
      domainFit,
      resumeStoryClarity,
      functionalOverlap,
      recruiterFriendliness,
      careerValue,
      total,
    },
    recommendation,
    topMatch: "Backend-leaning product engineering and API overlap.",
    mainRisk: rules.notes[0] ?? "Recruiter screen realism risk.",
    rationale: [
      "Score uses conservative fit plus recruiter-screen realism.",
      "Deterministic penalties are applied when hard gates are present.",
    ],
    risks: rules.notes,
  };
};

export const scoreJob = async (params: {
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
  userProfile: UserProfile;
}): Promise<{
  scoring: ScoringResult;
  scoringDiagnostics: StructuredCallDiagnostics;
  scoringLlmSucceeded: boolean;
}> => {
  const fallback = () => deterministicFallback(params.extracted, params.rules);
  const scoredRun = await responsesClient.runStructured({
    systemPrompt: scoringSystemPrompt,
    userPrompt: buildScoringPrompt({
      extracted: params.extracted,
      rules: params.rules,
      userProfile: params.userProfile,
      scoringPolicy,
    }),
    schema: ScoringFromModelSchema,
    fallback,
  });
  if (!scoredRun.success) {
    logger.warn("Job scoring used deterministic fallback", {
      fallbackUsed: scoredRun.diagnostics.fallbackUsed,
      httpStatus: scoredRun.diagnostics.httpStatus,
      errorCode: scoredRun.diagnostics.errorCode,
      parseStage: scoredRun.diagnostics.parseStage,
      reason: scoredRun.diagnostics.reason,
      errorMessage: scoredRun.diagnostics.errorMessage,
    });
  }
  const llmResult = scoredRun.data;

  const categoryTotal =
    llmResult.score.stackFit +
    llmResult.score.levelFit +
    llmResult.score.domainFit +
    llmResult.score.resumeStoryClarity +
    llmResult.score.functionalOverlap +
    llmResult.score.recruiterFriendliness +
    llmResult.score.careerValue;
  const boundedTotal = Math.max(0, Math.min(100, Math.round(categoryTotal)));
  const recommendation = mapRecommendationFromScore(boundedTotal);

  return {
    scoring: {
      ...llmResult,
      score: { ...llmResult.score, total: boundedTotal },
      recommendation,
    },
    scoringDiagnostics: scoredRun.diagnostics,
    scoringLlmSucceeded: scoredRun.success,
  };
};

export type { ScoringResult };
export type { ScoreBreakdown };
