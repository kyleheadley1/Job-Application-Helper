import { extractionSystemPrompt, buildExtractionPrompt } from "../agents/jobAgent/prompts.js";
import { ExtractedJobFromModelSchema } from "../agents/jobAgent/schemas.js";
import type { ExtractedJobData } from "../types/job.js";
import { responsesClient } from "../services/llm/responsesClient.js";
import type { StructuredCallDiagnostics } from "../services/llm/responsesClient.js";
import { logger } from "../lib/logger.js";
import { parseJobText } from "./parseJobText.js";
import {
  extractFromRawText,
  mergeExtractedWithHeuristics,
} from "./deterministicRawTextExtract.js";

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

export type ExtractJobDataResult = {
  extracted: ExtractedJobData;
  llmExtractionSucceeded: boolean;
  extractionDiagnostics: StructuredCallDiagnostics;
  heuristicInferredFields: string[];
};

export const extractJobData = async (input: {
  url?: string;
  rawText?: string;
  companyHint?: string;
}): Promise<ExtractJobDataResult> => {
  const fallback = () => fallbackExtraction(input);
  const extractedRun = await responsesClient.runStructured({
    systemPrompt: extractionSystemPrompt,
    userPrompt: buildExtractionPrompt(input),
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

  if (input.rawText?.trim()) {
    const normalized = parseJobText(input.rawText.replace(/\r\n/g, "\n")).normalized;
    const heur = extractFromRawText(normalized, input.companyHint);
    heuristicInferredFields = heur.inferredFields;
    extracted = mergeExtractedWithHeuristics(extracted, heur);
    extracted.rawText = extracted.rawText ?? input.rawText;
  }

  return { extracted, llmExtractionSucceeded, extractionDiagnostics: extractedRun.diagnostics, heuristicInferredFields };
};
