import { z } from 'zod';
import { scoringPolicy } from '../../config/scoringPolicy.js';
import type { ExtractedJobData } from '../../types/job.js';
import type {
  Recommendation,
  RuleEvaluation,
  ScoreBreakdown,
} from '../../types/scoring.js';
import type { ResumeContextSet } from "../../types/resumeContext.js";
import type { UserProfile } from '../../types/userProfile.js';
import { normalizeText } from '../../lib/text.js';
import { logger } from '../../lib/logger.js';
import { buildScoringPrompt, scoringSystemPrompt } from './prompts.js';
import { preprocessScoringInput } from '../../tools/triageStructuredNormalize.js';
import { responsesClient } from '../../services/llm/responsesClient.js';
import type { StructuredCallDiagnostics } from '../../services/llm/responsesClient.js';
import {
  polishScoringNarrative,
  jdHasAppliedAiSystemsOverlap,
  profileHasAiToolingEvidence,
} from '../../lib/scoringOutputPolish.js';

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
  recommendation: z.enum(['yes', 'selective_yes', 'no']),
  topMatch: z.string(),
  mainRisk: z.string(),
  rationale: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});

type ScoringResult = z.infer<typeof ScoringOutputSchema>;

/** Exported for regression tests (live-output normalization). */
export const ScoringFromModelSchema = z.preprocess(
  preprocessScoringInput,
  ScoringOutputSchema,
);

export const mapRecommendationFromScore = (total: number): Recommendation =>
  scoringPolicy.recommendationMapping.find(
    (entry) => total >= entry.min && total <= entry.max,
  )?.recommendation ?? 'no';

/** True when recommendation should stay conservative (selective_yes allowed). */
export const recommendationHardConstraints = (rules: RuleEvaluation): boolean =>
  Boolean(
    rules.locationMismatch ||
      rules.explicitDegreeRisk ||
      rules.strictNewGradPipeline ||
      rules.explicitCoreLanguageMismatch ||
      rules.visaMismatch ||
      rules.citizenshipMismatch ||
      rules.clearanceMismatch ||
      rules.stackMismatch ||
      rules.domainMismatch ||
      rules.seniorityOverreach,
  );

/**
 * Strong scores default to "yes" when no gates; real gates pull high scores to selective_yes.
 */
export const resolveRecommendation = (total: number, rules: RuleEvaluation): Recommendation => {
  if (total < 60) return "no";
  if (rules.researchHeavyAiRole && total < 70) return "no";
  const base = mapRecommendationFromScore(total);
  if (recommendationHardConstraints(rules)) {
    if (total >= 80 && base === "yes") return "selective_yes";
    return base;
  }
  if (base === "no" && total >= 60) return "selective_yes";
  if (rules.foundingEngineerStretch && total >= 77 && base === "selective_yes") return "yes";
  if (total >= 78 && base === "selective_yes") return "yes";
  return base;
};

const deterministicFallback = (
  job: ExtractedJobData,
  rules: RuleEvaluation,
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
      ? 18
      : 10;
  if (/\btypescript\b/i.test(fitBlob)) stackFit = Math.min(25, stackFit + 2);
  if (/\bnode\.?js\b|\bnode\b/i.test(fitBlob))
    stackFit = Math.min(25, stackFit + 1);
  if (/\breact\b/i.test(fitBlob)) stackFit = Math.min(25, stackFit + 1);
  if (/\brest(ful)?\s+apis?\b|\brest\s+api\b/i.test(fitBlob))
    stackFit = Math.min(25, stackFit + 1);

  const levelFit = rules.seniorityOverreach ? 5 : 11;
  let domainFit = rules.domainMismatch ? 4 : 7;
  let resumeStoryClarity = rules.stackMismatch ? 6 : 11;
  let functionalOverlap = rules.stackMismatch ? 4 : 7;
  if (/\binternal\s+tools\b/i.test(fitBlob))
    functionalOverlap = Math.min(10, functionalOverlap + 1);
  if (/\bai[-\s]?enabled\b|\bllm\b|\bworkflow\b/i.test(fitBlob))
    functionalOverlap = Math.min(10, functionalOverlap + 1);

  let recruiterFriendliness = Math.max(
    0,
    12 - Object.keys(rules.penaltyVector ?? {}).length * 2,
  );
  if (/\bremote\b|\bdistributed\b|\bwfh\b/i.test(fitBlob))
    recruiterFriendliness = Math.min(15, recruiterFriendliness + 1);
  if (
    /\b(nyc|new york|manhattan|brooklyn|hybrid\s+nyc|nyc[-\s]friendly)\b/i.test(
      fitBlob,
    )
  ) {
    recruiterFriendliness = Math.min(15, recruiterFriendliness + 1);
  }

  let careerValue = 7;
  if (/\bstartup\b|\bseed[-\s]?stage\b/i.test(fitBlob))
    careerValue = Math.min(10, careerValue + 1);
  if (/\bproduct\s+engineer\b/i.test(fitBlob))
    careerValue = Math.min(10, careerValue + 1);

  // Calibration: for junior-builder roles that mention broad internet-scale / revenue / data-science scope,
  // keep optimism measured unless direct evidence is stronger.
  const earlyCareerBuilderLike = /\b(junior|entry[-\s]?level|early[-\s]?career|associate|1[-\s]?3 years)\b/i.test(
    fitBlob,
  );
  const aspirationalScopeSignals =
    (fitBlob.match(/\b(internet[-\s]?scale|global scale|millions|revenue|growth|data science|ml platform|optimiz(e|ation))\b/gi)
      ?.length ?? 0);
  if (earlyCareerBuilderLike && aspirationalScopeSignals > 0) {
    careerValue = Math.max(0, careerValue - 1);
    recruiterFriendliness = Math.max(0, recruiterFriendliness - 1);
    functionalOverlap = Math.max(0, functionalOverlap - 1);
  }

  const appliedAiStrong =
    /\b(llm|rag\b|vector\s+(search|database|db)|embedding|generative ai|ai engineer|agentic|evals?\b|retrieval[-\s]?augmented)\b/i.test(
      fitBlob,
    );
  if (appliedAiStrong) {
    stackFit = Math.min(25, stackFit + 2);
    functionalOverlap = Math.min(10, functionalOverlap + 2);
    resumeStoryClarity = Math.min(15, resumeStoryClarity + 1);
    careerValue = Math.min(10, careerValue + 1);
  }
  // Python-primary caveat: one venue only — do not subtract when JD also signals TS/Node/API AI work.
  if (
    appliedAiStrong &&
    /\bpython\b/i.test(fitBlob) &&
    !/\btypescript|javascript|node\.?js\b/i.test(fitBlob)
  ) {
    stackFit = Math.max(0, stackFit - 1);
  }
  if (appliedAiStrong && !rules.domainMismatch) {
    domainFit = Math.max(domainFit, 7);
    if (domainFit === 7 && /\b(agent|agents|evaluation|evals)\b/i.test(fitBlob)) domainFit = 8;
    domainFit = Math.min(10, domainFit);
  }
  if (
    /\b(nyc|new york|manhattan|brooklyn|hybrid\s+.{0,40}new\s+york)\b/i.test(fitBlob) &&
    (job.remoteType === "hybrid" || job.remoteType === "onsite" || job.remoteType === "remote")
  ) {
    recruiterFriendliness = Math.min(15, recruiterFriendliness + 1);
  }

  const subtotal =
    stackFit +
    levelFit +
    domainFit +
    resumeStoryClarity +
    functionalOverlap +
    recruiterFriendliness +
    careerValue;
  const penalty = Object.values(rules.penaltyVector ?? {}).reduce(
    (sum, value) => sum + value,
    0,
  );
  const total = Math.max(0, Math.min(100, subtotal - Math.round(penalty / 3)));
  const recommendation = resolveRecommendation(total, rules);
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
    topMatch: 'Backend-leaning product engineering and API overlap.',
    mainRisk:
      rules.hardRuleNotes?.[0] ?? rules.notes[0] ?? 'Recruiter screen realism risk.',
    rationale: [
      'Score uses conservative fit plus recruiter-screen realism.',
      'Deterministic penalties are applied when hard gates are present.',
    ],
    risks: [...(rules.hardRuleNotes ?? []), ...rules.notes],
  };
};

/** Deterministic scoring path exported for calibration tests. */
export const scoreJobDeterministicPreview = (params: {
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
}): ScoringResult => deterministicFallback(params.extracted, params.rules);

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

const hardBlockersDominate = (rules: RuleEvaluation): boolean =>
  Boolean(
    rules.explicitDegreeRisk ||
      rules.citizenshipMismatch ||
      rules.clearanceMismatch ||
      rules.strictNewGradPipeline ||
      rules.seniorityOverreach ||
      rules.domainMismatch,
  );

const sumScoreBreakdown = (s: ScoreBreakdown): number =>
  s.stackFit +
  s.levelFit +
  s.domainFit +
  s.resumeStoryClarity +
  s.functionalOverlap +
  s.recruiterFriendliness +
  s.careerValue;

/**
 * When the JD is applied-AI shaped, the profile shows AI tooling, resume context overlap is strong,
 * and there is no hard mismatch, resume narrative deserves a full 15/15 — do not hold story down for conservative tone alone.
 */
export const applyAlignedResumeStoryClarity = (params: {
  score: ScoreBreakdown;
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
  resumeContexts?: ResumeContextSet;
  userProfile: UserProfile;
}): ScoreBreakdown => {
  const { score, extracted, rules, resumeContexts, userProfile } = params;
  if (rules.domainMismatch || rules.stackMismatch) return score;
  if (rules.seniorityOverreach || rules.explicitDegreeRisk) return score;
  const blob = normalizeText(
    [
      extracted.title,
      extracted.rawText ?? "",
      ...(extracted.responsibilities ?? []),
      ...(extracted.requirements ?? []),
    ].join("\n"),
  );
  if (!jdHasAppliedAiSystemsOverlap(blob) || !profileHasAiToolingEvidence(userProfile)) return score;
  const signal = supportingResumeSignals(extracted, resumeContexts);
  if (signal < 10) return score;
  if (score.resumeStoryClarity >= 15) return score;
  const next = { ...score, resumeStoryClarity: 15 };
  return { ...next, total: sumScoreBreakdown(next) };
};

const supportingResumeSignals = (extracted: ExtractedJobData, resumeContexts?: ResumeContextSet): number => {
  if (!resumeContexts) return 0;
  const text = normalizeText(
    [
      extracted.title,
      ...(extracted.stack ?? []),
      ...(extracted.requiredSkills ?? []),
      ...(extracted.preferredSkills ?? []),
      ...(extracted.responsibilities ?? []),
      ...(extracted.requirements ?? []),
    ].join(" "),
  );
  const normalizedWords = text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[^a-z0-9+]/gi, "").toLowerCase())
    .filter(Boolean);
  const words = new Set(normalizedWords);
  const hasWordLike = (needle: string): boolean => {
    const n = needle.toLowerCase();
    if (words.has(n)) return true;
    return normalizedWords.some((w) => w.startsWith(n) || n.startsWith(w));
  };
  let best = 0;
  for (const type of ["SWE", "SIE", "EARLY_CAREER"] as const) {
    const ctx = resumeContexts[type];
    if (!ctx) continue;
    const keywordOverlap = ctx.metadata.keywords.filter((k) => hasWordLike(k)).length;
    const themeOverlap = ctx.metadata.strongestThemes.filter((t) =>
      normalizeText(t)
        .split(/\s+/)
        .some((w) => hasWordLike(w)),
    ).length;
    const claimOverlap = ctx.metadata.claimSupport.filter((c) => {
      const claimWords = normalizeText(c.claim).split(/\s+/).filter(Boolean);
      return claimWords.some((w) => hasWordLike(w)) && c.evidenceSnippets.length > 0;
    }).length;
    const signal = keywordOverlap + themeOverlap * 2 + claimOverlap * 2;
    if (signal > best) best = signal;
  }
  return best;
};

export const applyResumeSupportAdjustments = (params: {
  score: ScoreBreakdown;
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
  resumeContexts?: ResumeContextSet;
}): ScoreBreakdown => {
  const { score, extracted, rules, resumeContexts } = params;
  if (hardBlockersDominate(rules)) return score;
  const signal = supportingResumeSignals(extracted, resumeContexts);
  const storyDelta = signal >= 10 ? 2 : signal >= 5 ? 1 : signal === 0 ? -1 : 0;
  const overlapDelta = signal >= 8 ? 1 : signal === 0 ? -1 : 0;
  const next = {
    ...score,
    resumeStoryClarity: clamp(score.resumeStoryClarity + clamp(storyDelta, -2, 2), 0, 15),
    functionalOverlap: clamp(score.functionalOverlap + clamp(overlapDelta, -1, 1), 0, 10),
  };
  return {
    ...next,
    total:
      next.stackFit +
      next.levelFit +
      next.domainFit +
      next.resumeStoryClarity +
      next.functionalOverlap +
      next.recruiterFriendliness +
      next.careerValue,
  };
};

export const scoreJob = async (params: {
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
  userProfile: UserProfile;
  resumeContexts?: ResumeContextSet;
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

  const categoryTotal =
    llmResult.score.stackFit +
    llmResult.score.levelFit +
    llmResult.score.domainFit +
    llmResult.score.resumeStoryClarity +
    llmResult.score.functionalOverlap +
    llmResult.score.recruiterFriendliness +
    llmResult.score.careerValue;
  const boundedTotal = Math.max(0, Math.min(100, Math.round(categoryTotal)));
  const adjustedScore = applyResumeSupportAdjustments({
    score: { ...llmResult.score, total: boundedTotal },
    extracted: params.extracted,
    rules: params.rules,
    resumeContexts: params.resumeContexts,
  });

  const polished = polishScoringNarrative({
    narrative: {
      topMatch: llmResult.topMatch,
      mainRisk: llmResult.mainRisk,
      risks: llmResult.risks,
      rationale: llmResult.rationale,
    },
    score: adjustedScore,
    extracted: params.extracted,
    userProfile: params.userProfile,
    rules: params.rules,
  });

  const scoreAfterStory = applyAlignedResumeStoryClarity({
    score: polished.score,
    extracted: params.extracted,
    rules: params.rules,
    resumeContexts: params.resumeContexts,
    userProfile: params.userProfile,
  });

  return {
    scoring: {
      ...llmResult,
      score: scoreAfterStory,
      topMatch: polished.topMatch,
      mainRisk: polished.mainRisk,
      risks: polished.risks,
      rationale: polished.rationale,
      recommendation: resolveRecommendation(scoreAfterStory.total, params.rules),
    },
    scoringDiagnostics: scoredRun.diagnostics,
    scoringLlmSucceeded: scoredRun.success,
  };
};

export type { ScoringResult };
export type { ScoreBreakdown };
