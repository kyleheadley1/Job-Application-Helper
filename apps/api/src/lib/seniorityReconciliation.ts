import type { ExtractedJobData } from "../types/job.js";
import { logger } from "./logger.js";
import {
  isEarlyCareerStructuredLevel,
  resolveStructuredSeniorityLevel,
} from "./seniorityGate.js";
import { normalizeText } from "./text.js";

const ENTRY_SENIORITY_RE =
  /\b(junior|entry[-\s]?level|associate|new\s+grad(?:uate)?|software engineer i\b|swe i\b|intern\b|apprentice)\b/i;
const SENIOR_SENIORITY_RE = /\b(senior|staff|principal|sr\.|lead\s+engineer)\b/i;

export const deriveSeniorityFromTitleAndText = (job: ExtractedJobData): string | null => {
  const titleBlob = normalizeText(job.title ?? "");
  const rawLead = normalizeText((job.rawText ?? "").slice(0, 800));

  if (ENTRY_SENIORITY_RE.test(titleBlob)) return "junior";
  if (SENIOR_SENIORITY_RE.test(titleBlob)) return "senior";
  if (ENTRY_SENIORITY_RE.test(rawLead) && !SENIOR_SENIORITY_RE.test(titleBlob)) return "junior";
  return null;
};

const normalizeSeniorityBucket = (value: string): "entry" | "senior" | "other" => {
  const v = normalizeText(value);
  if (/\b(junior|entry|associate|new grad|intern|apprentice|engineer i|swe i)\b/i.test(v)) return "entry";
  if (/\b(senior|staff|principal|lead)\b/i.test(v)) return "senior";
  return "other";
};

export type SeniorityReconciliationResult = {
  job: ExtractedJobData;
  conflictLogged: boolean;
};

/** Prefer title/raw-text junior signals when parsed seniority conflicts (e.g. junior title → senior). */
export const reconcileSeniority = (job: ExtractedJobData): SeniorityReconciliationResult => {
  const structuredLevel = resolveStructuredSeniorityLevel(job);
  if (
    structuredLevel &&
    isEarlyCareerStructuredLevel(structuredLevel) &&
    job.seniority &&
    normalizeSeniorityBucket(job.seniority) === "senior"
  ) {
    logger.warn("Seniority reconciliation: structured mid/junior label overrides body-inferred senior", {
      title: job.title,
      parsedSeniority: job.seniority,
      reconciledSeniority: structuredLevel,
    });
    return {
      job: { ...job, seniority: structuredLevel.toLowerCase() },
      conflictLogged: true,
    };
  }

  const derived = deriveSeniorityFromTitleAndText(job);
  if (!derived || !job.seniority) return { job, conflictLogged: false };

  const parsedBucket = normalizeSeniorityBucket(job.seniority);
  const derivedBucket = normalizeSeniorityBucket(derived);
  const conflict = parsedBucket === "senior" && derivedBucket === "entry";

  if (!conflict) return { job, conflictLogged: false };

  logger.warn("Seniority reconciliation: title/raw text conflicts with parsed seniority", {
    title: job.title,
    parsedSeniority: job.seniority,
    reconciledSeniority: derived,
  });

  return {
    job: { ...job, seniority: derived },
    conflictLogged: true,
  };
};
