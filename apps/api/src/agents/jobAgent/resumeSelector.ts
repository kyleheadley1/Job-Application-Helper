import { z } from "zod";
import { env } from "../../config/env.js";
import { resumeProfiles } from "../../config/resumeProfiles.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { ResumeSelection, ResumeType } from "../../types/resume.js";
import type { ResumeContextSet } from "../../types/resumeContext.js";
import type { ScoreBreakdown } from "../../types/scoring.js";
import type { UserProfile } from "../../types/userProfile.js";
import { responsesClient } from "../../services/llm/responsesClient.js";
import { buildResumeSelectionPrompt, resumeSelectionSystemPrompt } from "./prompts.js";
import { normalizeText } from "../../lib/text.js";
import { logger } from "../../lib/logger.js";
import {
  countStrongSieRoleDescriptorHits,
  fdeSweAlternateSieNote,
  hasBuilderFirstSoftwareContext,
  isFdeBuilderSoftwarePrimaryShape,
} from "../../lib/fdeBuilderRole.js";

const ResumeSelectionSchema = z.object({
  recommendedResume: z.enum(["SWE", "SIE", "EARLY_CAREER"]),
  confidence: z.number().min(0).max(1),
  rationale: z.array(z.string()).default([]),
});

const deterministicResumeSelection = (
  job: ExtractedJobData,
  resumeContexts?: ResumeContextSet,
): ResumeSelection & { ambiguous: boolean } => {
  const text = normalizeText(
    [
      job.title,
      job.rawText ?? "",
      (job.requirements ?? []).join(" "),
      (job.responsibilities ?? []).join(" "),
    ].join(" "),
  );
  /** Do not treat title-only "Forward Deployed" or generic "implementation" as SIE; see countStrongSieRoleDescriptorHits. */
  const explicitEarlyPipeline =
    /\b(new grad|new graduate|entry[-\s]?level|early[-\s]?career|software engineer i\b|swe i\b|intern\b|apprentice|rotational program|rotation program|0\s*[-–]\s*2\s+years|university graduate program)\b/i.test(
      text,
    );
  const earlySignals = ["new grad", "new graduate", "entry level", "early career", "rotational program", "rotation program", "software engineer i", "swe i", "intern", "apprentice", "0-2 years", "0–2 years"];
  const sweSignals = [
    "software engineer",
    "full-stack",
    "backend",
    "api",
    "product engineer",
    "builder",
    "ai engineer",
    "machine learning engineer",
    "applied ai",
    "internal tooling",
    "internal tools",
    "growth systems",
    "automation",
    "growth engineer",
  ];
  const juniorBuilderSignals = [
    "junior",
    "entry-level",
    "entry level",
    "early-career",
    "early career",
    "associate software",
    "associate engineer",
    "product engineer",
    "full-stack",
    "internal tools",
  ];

  const strongSieHits = countStrongSieRoleDescriptorHits(text);
  const fdeBuilderPrimary = isFdeBuilderSoftwarePrimaryShape(job);
  const earlyHits = explicitEarlyPipeline
    ? earlySignals.filter((needle) => text.includes(needle)).length + 2
    : earlySignals.filter((needle) => text.includes(needle)).length;
  const sweHits = sweSignals.filter((needle) => text.includes(needle)).length;
  const juniorBuilderHits = juniorBuilderSignals.filter((needle) => text.includes(needle)).length;

  const metaScoreByType: Record<ResumeType, number> = { SWE: 0, SIE: 0, EARLY_CAREER: 0 };
  if (resumeContexts) {
    const stackAndNeeds = normalizeText(
      [
        ...(job.stack ?? []),
        ...(job.requiredSkills ?? []),
        ...(job.preferredSkills ?? []),
        ...(job.responsibilities ?? []),
        ...(job.requirements ?? []),
      ].join(" "),
    );
    const words = new Set(stackAndNeeds.split(/\s+/).filter(Boolean));
    const types: ResumeType[] = ["SWE", "SIE", "EARLY_CAREER"];
    for (const type of types) {
      const ctx = resumeContexts[type];
      if (!ctx) continue;
      const keywordOverlap = ctx.metadata.keywords.filter((k) => words.has(k)).length;
      const themeOverlap = ctx.metadata.strongestThemes.filter((t) => stackAndNeeds.includes(normalizeText(t))).length;
      metaScoreByType[type] = keywordOverlap + themeOverlap * 2;
    }
  }

  const combinedByType: Record<ResumeType, number> = {
    SWE: metaScoreByType.SWE * 2 + sweHits,
    SIE: metaScoreByType.SIE * 2 + strongSieHits,
    EARLY_CAREER: metaScoreByType.EARLY_CAREER * 2 + earlyHits,
  };

  // SWE-first for general product / AI engineering; only boost EARLY_CAREER when explicit pipeline language matches.
  if (
    /\b(ai engineer|machine learning engineer|software engineer|full[- ]stack|backend engineer)\b/i.test(text) &&
    !explicitEarlyPipeline
  ) {
    combinedByType.SWE += 3;
  }
  if (
    /\b(rotational program|rotation program|campus hire|campus recruiting|early career program)\b/i.test(text) &&
    explicitEarlyPipeline
  ) {
    combinedByType.EARLY_CAREER += 5;
  }
  if (juniorBuilderHits > 0 && strongSieHits < 2 && explicitEarlyPipeline) {
    combinedByType.SWE += 2;
    combinedByType.EARLY_CAREER += 2;
    combinedByType.SIE -= 2;
  } else if (juniorBuilderHits > 0 && strongSieHits < 2 && !explicitEarlyPipeline) {
    combinedByType.SWE += 2;
    combinedByType.EARLY_CAREER = Math.min(combinedByType.EARLY_CAREER, 1);
  }

  if (fdeBuilderPrimary) {
    combinedByType.SWE += 5;
    combinedByType.SIE -= 4;
    if (hasBuilderFirstSoftwareContext(text)) {
      combinedByType.SWE += 2;
    }
  }

  if (strongSieHits >= 2 && /customer[-\s]?facing|onboarding|implementation|integration/.test(text)) {
    combinedByType.SIE += 2;
  }
  const ordered = (Object.entries(combinedByType) as Array<[ResumeType, number]>).sort((a, b) => b[1] - a[1]);
  const ambiguous = Math.abs((ordered[0]?.[1] ?? 0) - (ordered[1]?.[1] ?? 0)) <= 1;
  const recommendedResume: ResumeType = ordered[0]?.[0] ?? "SWE";

  const profile = resumeProfiles.find((r) => r.type === recommendedResume);
  const baseRationale = profile?.exampleRationale ?? ["Resume selected from stable role-shape heuristics."];
  const rationale =
    recommendedResume === "SWE" && fdeBuilderPrimary
      ? [...baseRationale, fdeSweAlternateSieNote]
      : baseRationale;
  return {
    recommendedResume,
    confidence: ambiguous ? 0.62 : 0.84,
    rationale,
    ambiguous,
  };
};

export const selectResume = async (params: {
  extracted: ExtractedJobData;
  score: ScoreBreakdown;
  topMatch: string;
  mainRisk: string;
  userProfile: UserProfile;
  resumeContexts?: ResumeContextSet;
}): Promise<ResumeSelection> => {
  const deterministic = deterministicResumeSelection(params.extracted, params.resumeContexts);
  if (
    !deterministic.ambiguous ||
    !env.openAiApiKey ||
    (env.triageFastMode && env.triageSkipLlmResumeSelectionInFastMode)
  ) {
    return {
      recommendedResume: deterministic.recommendedResume,
      confidence: deterministic.confidence,
      rationale: deterministic.rationale,
    };
  }

  const fallback = () => ({
    recommendedResume: deterministic.recommendedResume,
    confidence: deterministic.confidence,
    rationale: deterministic.rationale,
  });
  const selected = await responsesClient.runStructured({
    systemPrompt: resumeSelectionSystemPrompt,
    userPrompt: buildResumeSelectionPrompt(params),
    schema: ResumeSelectionSchema,
    fallback,
  });
  if (!selected.success) {
    logger.warn("Resume selection used deterministic fallback", {
      fallbackUsed: selected.diagnostics.fallbackUsed,
      httpStatus: selected.diagnostics.httpStatus,
      errorCode: selected.diagnostics.errorCode,
      parseStage: selected.diagnostics.parseStage,
      reason: selected.diagnostics.reason,
    });
  }
  return selected.data;
};
