import { createHash } from "node:crypto";
import { parseJobText } from "../tools/parseJobText.js";
import { storedCategoryScores } from "./recomputeStoredJobScore.js";
import { normalizeText } from "./text.js";
import type { JobRecord } from "../types/job.js";

/** Canonical normalized JD source text (same merge + parse as triage extraction input). */
export const mergedParsedJdText = (input: {
  rawText?: string;
  fetchedText?: string;
}): string => {
  const mergedText = [input.rawText, input.fetchedText].filter(Boolean).join("\n\n");
  if (!mergedText.trim()) return "";
  return parseJobText(mergedText).normalized;
};

/** Stable SHA-256 of normalized JD posting text for scoring reuse on retriage. */
export const computeJdTextHash = (parsedJdText: string): string => {
  const canonical = normalizeText(parsedJdText);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
};

export const jdTextHashFromInput = (input: {
  rawText?: string;
  fetchedText?: string;
}): string => computeJdTextHash(mergedParsedJdText(input));

/**
 * True when retriage can skip the scoring LLM and reuse stored category scores
 * (levelFit, domainFit, and the other LLM dimensions) from the prior successful run.
 */
export const canReuseStoredScoringCategories = (params: {
  currentJdTextHash: string;
  previousJob?: Pick<
    JobRecord,
    "scoringJdTextHash" | "score" | "debugExtraction"
  >;
}): boolean => {
  const prev = params.previousJob;
  if (!prev?.scoringJdTextHash?.trim()) return false;
  if (prev.scoringJdTextHash !== params.currentJdTextHash) return false;
  if (!prev.debugExtraction?.scoring?.success) return false;

  const cats = storedCategoryScores(prev.score);
  const dims = [
    cats.stackFit,
    cats.levelFit,
    cats.domainFit,
    cats.resumeStoryClarity,
    cats.functionalOverlap,
    cats.recruiterFriendliness,
    cats.careerValue,
  ];
  return dims.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
};
