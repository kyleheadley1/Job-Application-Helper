import { extractionSystemPrompt, buildExtractionPrompt } from "../agents/jobAgent/prompts.js";
import { ExtractedJobDataSchema } from "../agents/jobAgent/schemas.js";
import { responsesClient } from "../services/llm/responsesClient.js";
import { parseJobText } from "./parseJobText.js";
import { extractFromRawText, mergeExtractedWithHeuristics, } from "./deterministicRawTextExtract.js";
const fallbackExtraction = (input) => ({
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
export const extractJobData = async (input) => {
    const fallback = () => fallbackExtraction(input);
    const { success: llmExtractionSucceeded, data: baseExtracted } = await responsesClient.runStructured({
        systemPrompt: extractionSystemPrompt,
        userPrompt: buildExtractionPrompt(input),
        schema: ExtractedJobDataSchema,
        fallback,
    });
    let extracted = baseExtracted;
    let heuristicInferredFields = [];
    if (input.rawText?.trim()) {
        const normalized = parseJobText(input.rawText.replace(/\r\n/g, "\n")).normalized;
        const heur = extractFromRawText(normalized, input.companyHint);
        heuristicInferredFields = heur.inferredFields;
        extracted = mergeExtractedWithHeuristics(extracted, heur);
        extracted.rawText = extracted.rawText ?? input.rawText;
    }
    return { extracted, llmExtractionSucceeded, heuristicInferredFields };
};
