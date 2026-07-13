import type { ExtractedJobData } from "../types/job.js";
import { normalizeMatcherText } from "./text.js";

export const GENAI_RESTRICTION_WARNING =
  "This employer restricts GenAI-generated content in applications — use generated drafts as an outline only, do not submit as-is.";

const jobBlob = (job: ExtractedJobData): string =>
  normalizeMatcherText(
    [
      job.rawText ?? "",
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
    ].join("\n"),
  );

/**
 * Applicant-facing GenAI/application-authenticity restrictions.
 * Must NOT fire on product-AI language ("we build AI features").
 */
export const jdProhibitsGenAI = (job: ExtractedJobData): boolean => {
  const blob = jobBlob(job);
  return (
    /\bdo not use (?:genai|generative ai|ai tools?|chatgpt|large language models?|llms?)\b/.test(blob) ||
    /\b(?:genai|generative ai|ai tools?|chatgpt)\b[^.\n]{0,60}\b(?:to generate|for generating|in (?:your|the) application)\b/.test(
      blob,
    ) ||
    /\bprohibit(?:s|ed)?\b[^.\n]{0,40}\b(?:genai|generative ai|ai[- ]generated)\b/.test(blob) ||
    /\b(?:genai|ai)[- ]generated\b[^.\n]{0,40}\b(?:content|materials?|applications?)\b/.test(blob) ||
    /\bsubmit your own work\b/.test(blob) ||
    /\bauthentic application materials?\b/.test(blob) ||
    /\boriginal (?:writing|work|application materials?)\b[^.\n]{0,40}\b(?:required|must|only)\b/.test(blob) ||
    /\bmust (?:be|write) (?:your )?own (?:words|writing|cover letter|application)\b/.test(blob) ||
    /\bno (?:genai|ai|chatgpt)[- ](?:generated|written)\b/.test(blob) ||
    /\bapplications? (?:must|should) (?:not|never) (?:include|contain|use)\b[^.\n]{0,40}\b(?:genai|ai[- ]generated|chatgpt)\b/.test(
      blob,
    )
  );
};
