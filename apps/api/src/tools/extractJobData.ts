import {
  extractionSystemPrompt,
  buildExtractionPrompt,
  metadataExtractionSystemPrompt,
  buildMetadataExtractionPrompt,
} from "../agents/jobAgent/prompts.js";
import { ExtractedJobFromModelSchema, JobMetadataFromModelSchema } from "../agents/jobAgent/schemas.js";
import type { ExtractedJobData } from "../types/job.js";
import { responsesClient } from "../services/llm/responsesClient.js";
import type { StructuredCallDiagnostics } from "../services/llm/responsesClient.js";
import { logger } from "../lib/logger.js";
import { parseJobText } from "./parseJobText.js";
import {
  extractFromRawText,
  mergeExtractedWithHeuristics,
} from "./deterministicRawTextExtract.js";
import {
  extractJobPostingMetadata,
  isWeakJobTitle,
  isWeakOrPlaceholderCompany,
  logJobPostingMetadataDebug,
  validateExtractedCompany,
  type JobPostingMetadata,
  type PreScoringJobMetadata,
} from "./jobPostingMetadataExtract.js";
import { normalizeLocationPrefixedTitle } from "./preScoringMetadataExtract.js";

const fallbackExtraction = (input: { url?: string; rawText?: string; companyHint?: string }): ExtractedJobData => ({
  company: input.companyHint ?? "Unknown Company",
  title: "Unknown Title",
  url: input.url,
  rawText: input.rawText,
  remoteType: "unknown",
  stack: [],
  requiredSkills: [],
  preferredSkills: [],
  domainTags: [],
  responsibilities: [],
  requirements: [],
});

const applyPreParsedMetadata = (base: ExtractedJobData, meta: JobPostingMetadata): ExtractedJobData => {
  const trusted = meta.preScoring?.confidence === "high" || meta.preScoring?.confidence === "medium";
  const company =
    meta.companyName && (trusted || isWeakOrPlaceholderCompany(base.company)) ? meta.companyName : base.company;
  const title = meta.jobTitle && (trusted || isWeakJobTitle(base.title)) ? meta.jobTitle : base.title;
  return {
    ...base,
    company: company || base.company,
    title: title || base.title,
    employmentType: meta.employmentType ?? base.employmentType,
    location: meta.location ?? base.location ?? undefined,
    seniority: meta.seniority ?? base.seniority ?? undefined,
  };
};

const applyMetadataFallback = (base: ExtractedJobData, meta: {
  companyName: string | null;
  jobTitle: string | null;
  employmentType: string | null;
  location: string | null;
  seniority: string | null;
}): ExtractedJobData => ({
  ...base,
  company: meta.companyName && isWeakOrPlaceholderCompany(base.company) ? meta.companyName : base.company,
  title: meta.jobTitle && isWeakJobTitle(base.title) ? meta.jobTitle : base.title,
  employmentType: meta.employmentType ?? base.employmentType,
  location: base.location ?? meta.location ?? undefined,
  seniority: base.seniority ?? meta.seniority ?? undefined,
});

const finalizeExtracted = (extracted: ExtractedJobData, normalizedText: string, companyHint?: string): ExtractedJobData => {
  let out = extracted;
  if (out.title) {
    const normalizedTitle = normalizeLocationPrefixedTitle(out.title);
    if (normalizedTitle.jobTitle !== out.title) {
      out = {
        ...out,
        title: normalizedTitle.jobTitle,
        location: out.location ?? normalizedTitle.location ?? undefined,
      };
    }
  }
  const company = validateExtractedCompany(
    isWeakOrPlaceholderCompany(out.company) ? null : out.company,
    normalizedText,
  );
  out = {
    ...out,
    company: company ?? (companyHint?.trim() || out.company),
  };
  if (isWeakOrPlaceholderCompany(out.company) && companyHint?.trim()) {
    out = { ...out, company: companyHint.trim() };
  }
  return out;
};

export type ExtractJobDataResult = {
  extracted: ExtractedJobData;
  llmExtractionSucceeded: boolean;
  extractionDiagnostics: StructuredCallDiagnostics;
  heuristicInferredFields: string[];
  preScoringMetadata?: PreScoringJobMetadata;
};

export const extractJobData = async (input: {
  url?: string;
  rawText?: string;
  companyHint?: string;
}): Promise<ExtractJobDataResult> => {
  const fallback = () => fallbackExtraction(input);
  let normalized: string | undefined;
  let preParsed: JobPostingMetadata | undefined;

  if (input.rawText?.trim()) {
    normalized = parseJobText(input.rawText.replace(/\r\n/g, "\n")).normalized;
    preParsed = extractJobPostingMetadata(normalized);
    logJobPostingMetadataDebug(normalized, preParsed, "pre_llm");
  }

  const extractedRun = await responsesClient.runStructured({
    systemPrompt: extractionSystemPrompt,
    userPrompt: buildExtractionPrompt({ ...input, rawText: normalized ?? input.rawText, preParsed }),
    schema: ExtractedJobFromModelSchema,
    fallback,
  });
  const llmExtractionSucceeded = extractedRun.success;
  if (!llmExtractionSucceeded) {
    logger.warn("Job extraction used deterministic fallback", {
      fallbackUsed: extractedRun.diagnostics.fallbackUsed,
      httpStatus: extractedRun.diagnostics.httpStatus,
      errorCode: extractedRun.diagnostics.errorCode,
      parseStage: extractedRun.diagnostics.parseStage,
      reason: extractedRun.diagnostics.reason,
      errorMessage: extractedRun.diagnostics.errorMessage,
    });
  }
  let extracted = extractedRun.data;
  let heuristicInferredFields: string[] = [];

  if (preParsed) {
    extracted = applyPreParsedMetadata(extracted, preParsed);
  }

  if (normalized) {
    const heur = extractFromRawText(normalized, input.companyHint);
    heuristicInferredFields = heur.inferredFields;
    extracted = mergeExtractedWithHeuristics(extracted, heur);
    extracted.rawText = extracted.rawText ?? input.rawText;
    extracted = finalizeExtracted(extracted, normalized, input.companyHint);
  }

  if (normalized && isWeakOrPlaceholderCompany(extracted.company)) {
    const metaRun = await responsesClient.runStructured({
      systemPrompt: metadataExtractionSystemPrompt,
      userPrompt: buildMetadataExtractionPrompt(normalized),
      schema: JobMetadataFromModelSchema,
      fallback: () => ({
        companyName: preParsed?.companyName ?? null,
        jobTitle: preParsed?.jobTitle ?? null,
        employmentType: preParsed?.employmentType ?? null,
        location: preParsed?.location ?? null,
        seniority: preParsed?.seniority ?? null,
        salary: preParsed?.salary ?? null,
        workModel: preParsed?.workModel ?? null,
      }),
    });
    if (!metaRun.success) {
      logger.warn("Metadata fallback extraction used deterministic values", metaRun.diagnostics);
    }
    extracted = applyMetadataFallback(extracted, metaRun.data);
    extracted = finalizeExtracted(extracted, normalized, input.companyHint);
  }

  return {
    extracted,
    llmExtractionSucceeded,
    extractionDiagnostics: extractedRun.diagnostics,
    heuristicInferredFields,
    preScoringMetadata: preParsed?.preScoring,
  };
};
