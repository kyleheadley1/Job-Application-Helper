import { z } from "zod";
import type { AssetGenerationSliceDebug, DebugAssetGeneration, GeneratedAssets, JobRecord } from "../../types/job.js";
import type { UserProfile } from "../../types/userProfile.js";
import type { StructuredCallResult } from "../../services/llm/responsesClient.js";
import { responsesClient } from "../../services/llm/responsesClient.js";
import {
  applicationStrategyAssetSystemPrompt,
  buildApplicationStrategyAssetUserPrompt,
  buildCoverLetterAssetUserPrompt,
  buildTailoredBulletsAssetUserPrompt,
  buildTalkingPointsAssetUserPrompt,
  buildWhyCompanyAssetUserPrompt,
  coverLetterAssetSystemPrompt,
  tailoredBulletsAssetSystemPrompt,
  talkingPointsAssetSystemPrompt,
  whyCompanyAssetSystemPrompt,
} from "./prompts.js";
import { formatWhyCompanyForSIE, stripPastedJdHeaderFromCoverLetter } from "../../tools/triageStructuredNormalize.js";

const CoverLetterOut = z.object({ coverLetter: z.string().min(1) });
const WhyCompanyOut = z.object({ whyCompany: z.string().min(1) });
const TalkingOut = z.object({
  talkingPoints: z.array(z.string()).min(3).max(5),
});
const BulletsOut = z.object({
  tailoredBulletCandidates: z.array(z.string()).min(3).max(5),
});
const StrategyOut = z.object({
  emphasize: z.array(z.string()).min(1),
  avoidClaiming: z.array(z.string()).min(1),
  recruiterReplyDraft: z.string().optional(),
});

const toSliceDebug = <T,>(r: StructuredCallResult<T>): AssetGenerationSliceDebug => ({
  success: r.success,
  fallbackUsed: r.diagnostics.fallbackUsed,
  httpStatus: r.diagnostics.httpStatus,
  errorCode: r.diagnostics.errorCode,
  errorType: r.diagnostics.errorType,
  errorMessage: r.diagnostics.errorMessage,
  parseStage: r.diagnostics.parseStage,
  reason: r.diagnostics.reason,
});

export class AssetGenerationSkippedError extends Error {
  readonly code = "ASSET_GENERATION_SKIPPED" as const;
  constructor(message: string) {
    super(message);
    this.name = "AssetGenerationSkippedError";
  }
}

/** Honest, template-backed assets when LLM is unavailable or fails — uses only job + profile fields. */
export const buildDeterministicGeneratedAssets = (job: JobRecord, profile: UserProfile): GeneratedAssets => {
  const { extracted, recommendedResume, rules, mainRisk } = job;
  const company = extracted.company;
  const title = extracted.title;
  const stackLine = [...extracted.stack, ...extracted.requiredSkills].filter(Boolean).join(", ");
  const resp0 = extracted.responsibilities[0];
  const rawSnippet = extracted.rawText?.trim().slice(0, 320);

  const coverLetter = [
    `I'm applying for the ${title} role at ${company}.`,
    profile.headline,
    stackLine ? `The posting mentions: ${stackLine}.` : "",
    `I want to be upfront in the first conversation: ${mainRisk}`,
    `From my side, the through-line is ${profile.recurringStory.slice(0, 2).join("; ")}.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const whyCompany = [
    `${company} is hiring for "${title}".`,
    resp0
      ? `A concrete thread from the posting: ${resp0}`
      : rawSnippet
        ? `From the posting: ${rawSnippet}${extracted.rawText && extracted.rawText.length > 320 ? "…" : ""}`
        : `The role direction matches what I'm targeting: ${profile.targetRoles[0] ?? "product-minded engineering"}.`,
    `What pulls me in is work where ${profile.flagshipProjects[0]?.summary ?? profile.strengths[0]}`,
  ].join(" ");

  const talkingPoints: string[] = [];
  if (recommendedResume === "SIE") {
    talkingPoints.push(
      "I can walk through how I'd run a technical onboarding or integration slice without hand-wavy architecture slides.",
    );
    talkingPoints.push(
      "I'm comfortable translating fuzzy stakeholder requests into a small set of implementable milestones — then executing.",
    );
    talkingPoints.push(
      "I stay close to delivery risk: dependencies, cutover order, and what to validate early with a customer engineer.",
    );
  } else if (recommendedResume === "EARLY_CAREER") {
    talkingPoints.push(
      "I'm early-career with a training-backed foundation; I do best with tight feedback loops and small shipped increments.",
    );
    talkingPoints.push(
      "I've built full-stack project work where the constraint was clarity — scoping, tradeoffs, and readable code.",
    );
    talkingPoints.push(
      "I'm explicit about what I haven't done yet; I'd rather earn trust than bluff depth I don't have.",
    );
  } else {
    talkingPoints.push(
      "I've shipped backend-leaning full-stack work where APIs and internal tools were the spine of the product loop.",
    );
    talkingPoints.push(
      "I'm strongest when the job is ambiguous but measurable — narrow the unknowns, ship, then iterate with stakeholders.",
    );
    talkingPoints.push(
      "I keep claims tied to what I've actually built (see projects below) rather than generic 'passion for excellence'.",
    );
  }
  for (const p of profile.flagshipProjects) {
    if (talkingPoints.length >= 5) break;
    talkingPoints.push(`${p.name}: ${p.summary}`);
  }
  while (talkingPoints.length < 3) {
    talkingPoints.push(`Relevant strength I can substantiate: ${profile.strengths[talkingPoints.length]}.`);
  }

  const tailoredBulletCandidates = profile.flagshipProjects
    .map((p) => `${p.name}: ${p.summary} (Tools I used: ${p.tech.join(", ")}).`)
    .concat(profile.strengths.slice(0, 2).map((s) => `Candidate line — substantiated skill: ${s}.`))
    .slice(0, 5);

  const emphasize: string[] = [
    ...profile.recurringStory.slice(0, 2),
    job.topMatch,
    `Resume selected for this application: ${recommendedResume} — keep the story consistent with that framing.`,
  ].filter(Boolean);

  const avoidClaiming: string[] = [...profile.hardConstraints];
  if (rules.explicitDegreeRisk) {
    avoidClaiming.push(
      "Posting signals a degree gate — do not imply a bachelor's you don't have; be precise about your path or ask about exceptions early.",
    );
  }
  if (rules.visaMismatch) {
    avoidClaiming.push("Visa/sponsorship: do not imply sponsorship where the posting restricts it.");
  }
  if (rules.citizenshipMismatch) {
    avoidClaiming.push("Citizenship requirement: do not claim eligibility you don't meet.");
  }
  if (rules.clearanceMismatch) {
    avoidClaiming.push("Clearance: do not claim cleared work without it.");
  }
  if (rules.seniorityOverreach) {
    avoidClaiming.push("Seniority: posting reads above your level story — don't claim staff-level ownership.");
  }
  if (rules.stackMismatch) {
    avoidClaiming.push("Stack shape: don't claim deep ownership in the posting's infra/SRE lane if that's not your story.");
  }
  if (rules.domainMismatch) {
    avoidClaiming.push("Domain: don't claim specialized domain depth the posting asks for without overlap.");
  }
  if (rules.strictNewGradPipeline || rules.newGradPenalty) {
    avoidClaiming.push("Pipeline: avoid sounding like a campus-hire program match if you're not in that track.");
  }
  if (rules.financePenalty || rules.traditionalCompanyPenalty) {
    avoidClaiming.push("Employer context: expect stricter screens — keep claims conservative and verifiable.");
  }
  avoidClaiming.push(`Main triage risk to respect: ${mainRisk}`);

  const recruiterReplyDraft = `Thanks for considering my application for ${title} at ${company}. Happy to answer a few scoping questions or share a small work sample that maps to the posting — especially around ${stackLine || "the core responsibilities"}.`;

  return {
    coverLetter,
    whyCompany,
    talkingPoints: talkingPoints.slice(0, 5),
    tailoredBulletCandidates,
    emphasize: emphasize.slice(0, 6),
    avoidClaiming: avoidClaiming.slice(0, 12),
    recruiterReplyDraft,
  };
};

export type GenerateJobAssetsParams = {
  job: JobRecord;
  userProfile: UserProfile;
  /** When true, generate even if recommendation is "no". */
  force?: boolean;
};

export type GenerateJobAssetsResult = {
  generated: GeneratedAssets;
  debugAssetGeneration?: DebugAssetGeneration;
  skipped?: boolean;
  skipReason?: string;
};

export const generateJobAssets = async (params: GenerateJobAssetsParams): Promise<GenerateJobAssetsResult> => {
  const { job, userProfile, force } = params;

  if (job.recommendation === "no" && !force) {
    return {
      generated: {},
      skipped: true,
      skipReason: "Recommendation is 'no'; asset generation is skipped unless force=true.",
    };
  }

  const fb = buildDeterministicGeneratedAssets(job, userProfile);

  const cl = await responsesClient.runStructured({
    systemPrompt: coverLetterAssetSystemPrompt,
    userPrompt: buildCoverLetterAssetUserPrompt({ job, userProfile }),
    schema: CoverLetterOut,
    fallback: () => ({ coverLetter: fb.coverLetter ?? "" }),
  });

  const why = await responsesClient.runStructured({
    systemPrompt: whyCompanyAssetSystemPrompt,
    userPrompt: buildWhyCompanyAssetUserPrompt({ job, userProfile }),
    schema: WhyCompanyOut,
    fallback: () => ({ whyCompany: fb.whyCompany ?? "" }),
  });

  const talk = await responsesClient.runStructured({
    systemPrompt: talkingPointsAssetSystemPrompt,
    userPrompt: buildTalkingPointsAssetUserPrompt({ job, userProfile }),
    schema: TalkingOut,
    fallback: () => ({ talkingPoints: fb.talkingPoints ?? [] }),
  });

  const bullets = await responsesClient.runStructured({
    systemPrompt: tailoredBulletsAssetSystemPrompt,
    userPrompt: buildTailoredBulletsAssetUserPrompt({ job, userProfile }),
    schema: BulletsOut,
    fallback: () => ({ tailoredBulletCandidates: fb.tailoredBulletCandidates ?? [] }),
  });

  const strat = await responsesClient.runStructured({
    systemPrompt: applicationStrategyAssetSystemPrompt,
    userPrompt: buildApplicationStrategyAssetUserPrompt({ job, userProfile }),
    schema: StrategyOut,
    fallback: () => ({
      emphasize: fb.emphasize ?? [],
      avoidClaiming: fb.avoidClaiming ?? [],
      recruiterReplyDraft: fb.recruiterReplyDraft,
    }),
  });

  const pick = <T,>(ok: boolean, primary: T, alt: T): T => (ok ? primary : alt);

  let coverLetter = pick(cl.success, cl.data.coverLetter, fb.coverLetter);
  if (typeof coverLetter === "string" && coverLetter.trim()) {
    coverLetter = stripPastedJdHeaderFromCoverLetter(job, coverLetter);
  }

  let whyCompany = pick(why.success, why.data.whyCompany, fb.whyCompany);
  if (typeof whyCompany === "string" && whyCompany.trim() && job.recommendedResume === "SIE") {
    whyCompany = formatWhyCompanyForSIE(whyCompany);
  }

  const generated: GeneratedAssets = {
    coverLetter,
    whyCompany,
    talkingPoints: pick(talk.success, talk.data.talkingPoints, fb.talkingPoints),
    tailoredBulletCandidates: pick(bullets.success, bullets.data.tailoredBulletCandidates, fb.tailoredBulletCandidates),
    emphasize: pick(strat.success, strat.data.emphasize, fb.emphasize),
    avoidClaiming: pick(strat.success, strat.data.avoidClaiming, fb.avoidClaiming),
    recruiterReplyDraft: pick(
      strat.success,
      strat.data.recruiterReplyDraft ?? fb.recruiterReplyDraft,
      fb.recruiterReplyDraft,
    ),
  };

  const debugAssetGeneration: DebugAssetGeneration = {
    slices: {
      coverLetter: toSliceDebug(cl),
      whyCompany: toSliceDebug(why),
      talkingPoints: toSliceDebug(talk),
      tailoredBulletCandidates: toSliceDebug(bullets),
      applicationStrategy: toSliceDebug(strat),
    },
  };

  return { generated, debugAssetGeneration };
};
