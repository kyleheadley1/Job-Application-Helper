import {
  ADJACENT_ROLE_FUNCTION,
  DIFFERENTIATOR_COVERAGE,
  FRONTEND_PRIMARY_ROLE,
} from "../config/capabilitySurvivabilityPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import type { CapabilityBreakdown } from "../types/scoring.js";
import {
  classifyFrontendPrimaryRole,
  classifyRoleFunction,
} from "./roleFunctionClassifier.js";
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

export const API_BUILDING_RE =
  /\b(?:build|design|develop|implement(?:s|ed|ing)?|create|own|ship)\b.{0,48}\b(?:api|rest api|graphql|microservice|backend)\b|\b(?:api|rest api|graphql|microservice|backend).{0,48}\b(?:build|design|develop|implement(?:s|ed|ing)?|create|own|ship|services?|platform)\b/i;

const API_VALIDATION_ONLY_RE =
  /\b(?:api|rest api|integration).{0,32}\b(validat(?:e|ion)|test(?:ing)?|verif(?:y|ication)|uat)\b|\b(validat(?:e|ion)|test(?:ing)?|verif(?:y|ication)|uat).{0,32}\b(?:api|rest api|integration)\b/i;

/** Backend/API tags that require build/own framing to credit on frontend-primary roles. */
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

/** AI-tooling / LLM tags that remain in play even on frontend-primary roles. */
const AI_TOOLING_DIFFERENTIATOR_TAGS = new Set([
  "llm",
  "rag",
  "vector",
  "qdrant",
  "embedding",
  "openai",
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
  options?: { adjacentRoleFunction?: boolean; frontendPrimaryRole?: boolean },
): { count: number; matchedTags: string[] } => {
  const blob = stripWorkAuthorizationPhrases(text);
  const matchedTags: string[] = [];
  const apiBuilding = API_BUILDING_RE.test(blob);
  const validationOnlyApi = API_VALIDATION_ONLY_RE.test(blob) && !apiBuilding;

  const tags = [...DIFFERENTIATOR_COVERAGE.TAGS].sort((a, b) => b.length - a.length);
  for (const tag of tags) {
    if (!blob.includes(tag) || matchedTags.includes(tag)) continue;
    if (validationOnlyApi && (tag === "api" || tag === "rest api") && !apiBuilding) {
      continue;
    }
    if (
      options?.adjacentRoleFunction &&
      BUILDING_DIFFERENTIATOR_TAGS.has(tag) &&
      !apiBuilding
    ) {
      continue;
    }
    // Frontend-primary: never credit backend/API edge from token presence alone —
    // roles consume APIs; building-regex also false-fires on "backend … services".
    // AI-tooling tags still count when present.
    if (
      options?.frontendPrimaryRole &&
      BUILDING_DIFFERENTIATOR_TAGS.has(tag) &&
      !AI_TOOLING_DIFFERENTIATOR_TAGS.has(tag)
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
  options?: { adjacentRoleFunction?: boolean; frontendPrimaryRole?: boolean },
): DifferentiatorCoverageResult => {
  const adjacentRoleFunction =
    options?.adjacentRoleFunction ?? classifyRoleFunction(job).detected;
  const frontendPrimaryRole =
    options?.frontendPrimaryRole ?? classifyFrontendPrimaryRole(job).detected;
  const blob = jobDescriptionBlob(job);
  const { count, matchedTags } = countDifferentiatorTags(blob, {
    adjacentRoleFunction,
    frontendPrimaryRole,
  });
  const preFilter = frontendPrimaryRole
    ? countDifferentiatorTags(blob, {
        adjacentRoleFunction,
        frontendPrimaryRole: false,
      })
    : null;

  let tier: DifferentiatorCoverageTier = "none";
  if (count >= DIFFERENTIATOR_COVERAGE.STRONG_MIN_TAGS) {
    tier = "strong";
  } else if (count >= 1) {
    tier = "partial";
  }

  // Consumption tokens alone looked "strong" but were benched → report partial, not none.
  if (
    frontendPrimaryRole &&
    tier === "none" &&
    preFilter &&
    preFilter.count >= DIFFERENTIATOR_COVERAGE.STRONG_MIN_TAGS
  ) {
    tier = "partial";
  }

  if (
    adjacentRoleFunction &&
    tier === "strong" &&
    ADJACENT_ROLE_FUNCTION.DIFFERENTIATOR_TIER_CEILING === "partial"
  ) {
    tier = "partial";
  }

  if (
    frontendPrimaryRole &&
    tier === "strong" &&
    FRONTEND_PRIMARY_ROLE.DIFFERENTIATOR_TIER_CEILING === "partial"
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
    if (frontendPrimaryRole) {
      const aiKept = matchedTags.filter((t) => AI_TOOLING_DIFFERENTIATOR_TAGS.has(t));
      const aiNote = aiKept.length > 0 ? `; AI-tooling still in play (${aiKept.join(", ")})` : "";
      return {
        tier: "partial",
        matchCount: count,
        matchedTags,
        note: `Differentiator coverage: partial — ${FRONTEND_PRIMARY_ROLE.NOTE}${aiNote}`,
      };
    }
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

  if (frontendPrimaryRole) {
    return {
      tier: "none",
      matchCount: 0,
      matchedTags: [],
      note: `Differentiator coverage: none — ${FRONTEND_PRIMARY_ROLE.NOTE}`,
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
  options?: { adjacentRoleFunction?: boolean; frontendPrimaryRole?: boolean },
): { breakdown: CapabilityBreakdown; coverage: DifferentiatorCoverageResult } => {
  const adjacentRoleFunction =
    options?.adjacentRoleFunction ?? classifyRoleFunction(job).detected;
  const frontendPrimaryRole =
    options?.frontendPrimaryRole ?? classifyFrontendPrimaryRole(job).detected;
  const coverage = evaluateDifferentiatorCoverage(job, {
    adjacentRoleFunction,
    frontendPrimaryRole,
  });

  if (coverage.tier === "strong" && !adjacentRoleFunction && !frontendPrimaryRole) {
    return { breakdown, coverage };
  }

  const normalCap =
    coverage.tier === "none"
      ? DIFFERENTIATOR_COVERAGE.NONE_CAP
      : DIFFERENTIATOR_COVERAGE.PARTIAL_CAP;

  // Frontend-primary that would have been "strong" from API-consumption tokens needs the
  // milder FE cap (~75-76), not the harsh generic none-cap. Pure frontend with no false
  // tags still uses the normal differentiator caps (Fubo stays ~73).
  let cap = normalCap;
  if (frontendPrimaryRole) {
    const preFilter = countDifferentiatorTags(jobDescriptionBlob(job), {
      adjacentRoleFunction,
      frontendPrimaryRole: false,
    });
    if (preFilter.count >= DIFFERENTIATOR_COVERAGE.STRONG_MIN_TAGS) {
      cap = FRONTEND_PRIMARY_ROLE.CAP;
    }
  }

  const adjacentCap = adjacentRoleFunction ? ADJACENT_ROLE_FUNCTION.CAP : null;

  return {
    breakdown: {
      ...breakdown,
      stackFit: Math.min(
        breakdown.stackFit,
        cap.stackFit,
        adjacentCap?.stackFit ?? Number.POSITIVE_INFINITY,
      ),
      functionalOverlap: Math.min(
        breakdown.functionalOverlap,
        cap.functionalOverlap,
        adjacentCap?.functionalOverlap ?? Number.POSITIVE_INFINITY,
      ),
    },
    coverage,
  };
};
