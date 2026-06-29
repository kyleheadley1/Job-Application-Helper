import { DIFFERENTIATOR_COVERAGE } from "../config/capabilitySurvivabilityPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import type { CapabilityBreakdown } from "../types/scoring.js";
import { normalizeText } from "./text.js";

export type DifferentiatorCoverageTier = "none" | "partial" | "strong";

export type DifferentiatorCoverageResult = {
  tier: DifferentiatorCoverageTier;
  matchCount: number;
  matchedTags: string[];
  note: string;
};

/** Authentication-context tags — not employment/work authorization. */
const AUTH_DIFFERENTIATOR_PATTERNS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "oauth", pattern: /\boauth\b/i },
  { tag: "openid", pattern: /\bopenid\b/i },
  { tag: "auth flow", pattern: /\bauth flow\b/i },
  { tag: "authentication", pattern: /\bauthentication\b/i },
  { tag: "sso", pattern: /\bsso\b/i },
  { tag: "jwt", pattern: /\bjwt\b/i },
  { tag: "session", pattern: /\bsession\b/i },
  { tag: "github app", pattern: /\bgithub app\b/i },
  { tag: "github oauth", pattern: /\bgithub oauth\b/i },
];

const WORK_AUTHORIZATION_RE =
  /\b(legally\s+authorized\s+to\s+work|work\s+authorization|authorized\s+to\s+work|authoriz(?:e|ed|ation)\s+to\s+work)\b/i;

/** Strip employment-authorization phrases so bare auth substrings cannot match. */
export const stripWorkAuthorizationPhrases = (text: string): string =>
  normalizeText(text).replace(WORK_AUTHORIZATION_RE, " ");

export const jobDescriptionBlob = (job: ExtractedJobData): string =>
  normalizeText(
    [
      job.rawText ?? "",
      job.title ?? "",
      ...(job.stack ?? []),
      ...(job.requiredSkills ?? []),
      ...(job.preferredSkills ?? []),
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
    ].join("\n"),
  );

export const countDifferentiatorTags = (
  text: string,
): { count: number; matchedTags: string[] } => {
  const blob = stripWorkAuthorizationPhrases(text);
  const matchedTags: string[] = [];

  const tags = [...DIFFERENTIATOR_COVERAGE.TAGS].sort((a, b) => b.length - a.length);
  for (const tag of tags) {
    if (blob.includes(tag) && !matchedTags.includes(tag)) matchedTags.push(tag);
  }

  for (const { tag, pattern } of AUTH_DIFFERENTIATOR_PATTERNS) {
    if (pattern.test(blob) && !matchedTags.includes(tag)) {
      matchedTags.push(tag);
    }
  }

  return { count: matchedTags.length, matchedTags };
};

export const evaluateDifferentiatorCoverage = (
  job: ExtractedJobData,
): DifferentiatorCoverageResult => {
  const { count, matchedTags } = countDifferentiatorTags(jobDescriptionBlob(job));

  if (count >= DIFFERENTIATOR_COVERAGE.STRONG_MIN_TAGS) {
    const sample = matchedTags.slice(0, 3).join(", ");
    return {
      tier: "strong",
      matchCount: count,
      matchedTags,
      note: `Differentiator coverage: strong — ${sample} edge in play`,
    };
  }

  if (count >= 1) {
    return {
      tier: "partial",
      matchCount: count,
      matchedTags,
      note: `Differentiator coverage: partial (${matchedTags.join(", ")}) — capped stack/functional credit`,
    };
  }

  return {
    tier: "none",
    matchCount: 0,
    matchedTags: [],
    note: "Differentiator coverage: none — generic stack match, capped",
  };
};

export const applyDifferentiatorCoverageCap = (
  breakdown: CapabilityBreakdown,
  job: ExtractedJobData,
): { breakdown: CapabilityBreakdown; coverage: DifferentiatorCoverageResult } => {
  const coverage = evaluateDifferentiatorCoverage(job);

  if (coverage.tier === "strong") {
    return { breakdown, coverage };
  }

  const cap =
    coverage.tier === "none"
      ? DIFFERENTIATOR_COVERAGE.NONE_CAP
      : DIFFERENTIATOR_COVERAGE.PARTIAL_CAP;

  return {
    breakdown: {
      ...breakdown,
      stackFit: Math.min(breakdown.stackFit, cap.stackFit),
      functionalOverlap: Math.min(breakdown.functionalOverlap, cap.functionalOverlap),
    },
    coverage,
  };
};
