import { z } from "zod";
import { env } from "../../config/env.js";
import { resumeProfiles } from "../../config/resumeProfiles.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { ResumeSelection, ResumeType } from "../../types/resume.js";
import type { ScoreBreakdown } from "../../types/scoring.js";
import type { UserProfile } from "../../types/userProfile.js";
import { responsesClient } from "../../services/llm/responsesClient.js";
import { buildResumeSelectionPrompt, resumeSelectionSystemPrompt } from "./prompts.js";
import { normalizeText } from "../../lib/text.js";

const ResumeSelectionSchema = z.object({
  recommendedResume: z.enum(["SWE", "SIE", "EARLY_CAREER"]),
  confidence: z.number().min(0).max(1),
  rationale: z.array(z.string()).default([]),
});

const deterministicResumeSelection = (job: ExtractedJobData): ResumeSelection & { ambiguous: boolean } => {
  const text = normalizeText(
    [
      job.title,
      job.rawText ?? "",
      (job.requirements ?? []).join(" "),
      (job.responsibilities ?? []).join(" "),
    ].join(" "),
  );
  const sieSignals = [
    "forward deployed",
    "solutions engineer",
    "customer-facing implementation",
    "implementation",
    "integrations",
    "customer deployment",
    "technical onboarding",
    "solution design",
    "delivery timelines",
    "integration timelines",
    "partner engineering",
    "pre-sales",
    "post-sales",
    "api integration",
    "workflow implementation",
    "technical implementation",
  ];
  const earlySignals = ["new grad", "entry level", "early career", "rotational", "associate"];
  const sweSignals = ["software engineer", "full-stack", "backend", "api", "product engineer"];

  const sieHits = sieSignals.filter((needle) => text.includes(needle)).length;
  const earlyHits = earlySignals.filter((needle) => text.includes(needle)).length;
  const sweHits = sweSignals.filter((needle) => text.includes(needle)).length;

  const ambiguous = [sieHits, earlyHits, sweHits].filter((count) => count > 0).length > 1;
  let recommendedResume: ResumeType = "SWE";
  if (sieHits > 0 && sieHits >= earlyHits) recommendedResume = "SIE";
  if (earlyHits > 0 && earlyHits > sieHits) recommendedResume = "EARLY_CAREER";

  const profile = resumeProfiles.find((r) => r.type === recommendedResume);
  return {
    recommendedResume,
    confidence: ambiguous ? 0.62 : 0.84,
    rationale: profile?.exampleRationale ?? ["Resume selected from stable role-shape heuristics."],
    ambiguous,
  };
};

export const selectResume = async (params: {
  extracted: ExtractedJobData;
  score: ScoreBreakdown;
  topMatch: string;
  mainRisk: string;
  userProfile: UserProfile;
}): Promise<ResumeSelection> => {
  const deterministic = deterministicResumeSelection(params.extracted);
  if (!deterministic.ambiguous || !env.openAiApiKey) {
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
  const { data } = await responsesClient.runStructured({
    systemPrompt: resumeSelectionSystemPrompt,
    userPrompt: buildResumeSelectionPrompt(params),
    schema: ResumeSelectionSchema,
    fallback,
  });
  return data;
};
