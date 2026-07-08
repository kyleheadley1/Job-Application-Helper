import { ADJACENT_ROLE_FUNCTION, DIFFERENTIATOR_COVERAGE } from "../config/capabilitySurvivabilityPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import type { CapabilityBreakdown } from "../types/scoring.js";
import { classifyRoleFunction } from "./roleFunctionClassifier.js";
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

const API_BUILDING_RE =
  /\b(?:build|design|develop|implement(?:s|ed|ing)?|create|own|ship).{0,48}\b(?:api|rest api|graphql|microservice|backend)\b|\b(?:api|rest api|graphql|microservice|backend).{0,48}\b(?:build|design|develop|implement(?:s|ed|ing)?|services?|platform)\b/i;

const API_VALIDATION_ONLY_RE =
  /\b(?:api|rest api|integration).{0,32}\b(validat(?:e|ion)|test(?:ing)?|verif(?:y|ication)|uat)\b|\b(validat(?:e|ion)|test(?:ing)?|verif(?:y|ication)|uat).{0,32}\b(?:api|rest api|integration)\b/i;

const BUILDING_DIFFERENTIATOR_TAGS = new Set([
  "backend",
  "rest api",
  "api gateway",
  "microservice",
  "graphql",
  "node",
  "express",
  "api",
]);

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
  options?: { adjacentRoleFunction?: boolean },
): { count: number; matchedTags: string[] } => {
  const blob = stripWorkAuthorizationPhrases(text);
  const matchedTags: string[] = [];
  const validationOnlyApi =
    API_VALIDATION_ONLY_RE.test(blob) && !API_BUILDING_RE.test(blob);

  const tags = [...DIFFERENTIATOR_COVERAGE.TAGS].sort((a, b) => b.length - a.length);
  for (const tag of tags) {
    if (!blob.includes(tag) || matchedTags.includes(tag)) continue;
    if (
      validationOnlyApi &&
      (tag === "api" || tag === "rest api") &&
      !API_BUILDING_RE.test(blob)
    ) {
      continue;
    }
    if (
      options?.adjacentRoleFunction &&
      BUILDING_DIFFERENTIATOR_TAGS.has(tag) &&
      !API_BUILDING_RE.test(blob)
    ) {
      continue;
    }
    matchedTags.push(tag);
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
  options?: { adjacentRoleFunction?: boolean },
): DifferentiatorCoverageResult => {
  const adjacentRoleFunction =
    options?.adjacentRoleFunction ?? classifyRoleFunction(job).detected;
  const { count, matchedTags } = countDifferentiatorTags(jobDescriptionBlob(job), {
    adjacentRoleFunction,
  });

  let tier: DifferentiatorCoverageTier = "none";
  if (count >= DIFFERENTIATOR_COVERAGE.STRONG_MIN_TAGS) {
    tier = "strong";
  } else if (count >= 1) {
    tier = "partial";
  }

  if (
    adjacentRoleFunction &&
    tier === "strong" &&
    ADJACENT_ROLE_FUNCTION.DIFFERENTIATOR_TIER_CEILING === "partial"
  ) {
    tier = "partial";
  }

  if (tier === "strong") {
    const sample = matchedTags.slice(0, 3).join(", ");
    return {
      tier: "strong",
      matchCount: count,
      matchedTags,
      note: `Differentiator coverage: strong — ${sample} edge in play`,
    };
  }

  if (tier === "partial") {
    const adjacentNote = adjacentRoleFunction
      ? ` (${ADJACENT_ROLE_FUNCTION.FLAG})`
      : "";
    return {
      tier: "partial",
      matchCount: count,
      matchedTags,
      note: `Differentiator coverage: partial (${matchedTags.join(", ")}) — capped stack/functional credit${adjacentNote}`,
    };
  }

  const adjacentNote = adjacentRoleFunction ? ` — ${ADJACENT_ROLE_FUNCTION.FLAG}` : "";
  return {
    tier: "none",
    matchCount: 0,
    matchedTags: [],
    note: `Differentiator coverage: none — generic stack match, capped${adjacentNote}`,
  };
};

export const applyDifferentiatorCoverageCap = (
  breakdown: CapabilityBreakdown,
  job: ExtractedJobData,
  options?: { adjacentRoleFunction?: boolean },
): { breakdown: CapabilityBreakdown; coverage: DifferentiatorCoverageResult } => {
  const adjacentRoleFunction =
    options?.adjacentRoleFunction ?? classifyRoleFunction(job).detected;
  const coverage = evaluateDifferentiatorCoverage(job, { adjacentRoleFunction });

  if (coverage.tier === "strong" && !adjacentRoleFunction) {
    return { breakdown, coverage };
  }

  const cap =
    coverage.tier === "none"
      ? DIFFERENTIATOR_COVERAGE.NONE_CAP
      : DIFFERENTIATOR_COVERAGE.PARTIAL_CAP;

  const roleCap = adjacentRoleFunction ? ADJACENT_ROLE_FUNCTION.CAP : null;

  return {
    breakdown: {
      ...breakdown,
      stackFit: Math.min(
        breakdown.stackFit,
        cap.stackFit,
        roleCap?.stackFit ?? Number.POSITIVE_INFINITY,
      ),
      functionalOverlap: Math.min(
        breakdown.functionalOverlap,
        cap.functionalOverlap,
        roleCap?.functionalOverlap ?? Number.POSITIVE_INFINITY,
      ),
    },
    coverage,
  };
};
