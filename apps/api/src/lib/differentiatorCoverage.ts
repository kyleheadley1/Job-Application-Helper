import {
  ADJACENT_ROLE_FUNCTION,
  DIFFERENTIATOR_COVERAGE,
  FRONTEND_PRIMARY_ROLE,
  PLATFORM_INFRA_ROLE,
} from "../config/capabilitySurvivabilityPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import type { CapabilityBreakdown } from "../types/scoring.js";
import {
  classifyRoleLane,
  roleLaneIsAdjacent,
  roleLaneIsFrontendPrimary,
  roleLaneIsPlatformInfra,
} from "./roleFunctionClassifier.js";
import { structuredFirstJobBlob } from "./structuredFirstJobBlob.js";
import { normalizeText } from "./text.js";
import type { RoleLaneLabel } from "../types/scoring.js";

export type DifferentiatorCoverageTier = "none" | "partial" | "strong";

export type DifferentiatorCoverageResult = {
  tier: DifferentiatorCoverageTier;
  matchCount: number;
  matchedTags: string[];
  note: string;
};

export type DifferentiatorCoverageOptions = {
  adjacentRoleFunction?: boolean;
  frontendPrimaryRole?: boolean;
  platformInfraRole?: boolean;
  roleLane?: import("../types/scoring.js").RoleLaneLabel;
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

/** Surface-level infra/cloud tokens that look strong on platform JDs without product edge. */
const PLATFORM_GENERIC_TAGS = new Set([
  "backend",
  "rest api",
  "api gateway",
  "microservice",
  "api",
  "aws",
  "lambda",
  "dynamodb",
  "s3",
  "cloudwatch",
  "eventbridge",
  "docker",
  "node",
  "express",
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

export const jobDescriptionBlob = (job: ExtractedJobData): string => structuredFirstJobBlob(job);

export const countDifferentiatorTags = (
  text: string,
  options?: DifferentiatorCoverageOptions,
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
    if (
      options?.frontendPrimaryRole &&
      BUILDING_DIFFERENTIATOR_TAGS.has(tag) &&
      !AI_TOOLING_DIFFERENTIATOR_TAGS.has(tag)
    ) {
      continue;
    }
    // Platform/infra: aws/backend/api/docker alone are surface vocabulary — bench them.
    if (options?.platformInfraRole && PLATFORM_GENERIC_TAGS.has(tag)) {
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
  options?: DifferentiatorCoverageOptions,
): DifferentiatorCoverageResult => {
  const lane: RoleLaneLabel = options?.roleLane ?? classifyRoleLane(job).label;
  const adjacentRoleFunction =
    options?.adjacentRoleFunction ?? roleLaneIsAdjacent(lane);
  const frontendPrimaryRole =
    options?.frontendPrimaryRole ?? roleLaneIsFrontendPrimary(lane);
  const platformInfraRole =
    options?.platformInfraRole ?? roleLaneIsPlatformInfra(lane);
  const blob = jobDescriptionBlob(job);
  const { count, matchedTags } = countDifferentiatorTags(blob, {
    adjacentRoleFunction,
    frontendPrimaryRole,
    platformInfraRole,
  });
  const preFilterFe = frontendPrimaryRole
    ? countDifferentiatorTags(blob, {
        adjacentRoleFunction,
        frontendPrimaryRole: false,
        platformInfraRole,
      })
    : null;
  const preFilterPlatform = platformInfraRole
    ? countDifferentiatorTags(blob, {
        adjacentRoleFunction,
        frontendPrimaryRole,
        platformInfraRole: false,
      })
    : null;

  let tier: DifferentiatorCoverageTier = "none";
  if (count >= DIFFERENTIATOR_COVERAGE.STRONG_MIN_TAGS) {
    tier = "strong";
  } else if (count >= 1) {
    tier = "partial";
  }

  if (
    frontendPrimaryRole &&
    tier === "none" &&
    preFilterFe &&
    preFilterFe.count >= DIFFERENTIATOR_COVERAGE.STRONG_MIN_TAGS
  ) {
    tier = "partial";
  }

  if (
    platformInfraRole &&
    tier === "none" &&
    preFilterPlatform &&
    preFilterPlatform.count >= 1
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

  if (
    platformInfraRole &&
    tier === "strong" &&
    PLATFORM_INFRA_ROLE.DIFFERENTIATOR_TIER_CEILING === "partial"
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
    if (platformInfraRole) {
      return {
        tier: "partial",
        matchCount: count,
        matchedTags,
        note: `Differentiator coverage: partial — ${PLATFORM_INFRA_ROLE.NOTE}`,
      };
    }
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

  if (platformInfraRole) {
    return {
      tier: "none",
      matchCount: 0,
      matchedTags: [],
      note: `Differentiator coverage: none — ${PLATFORM_INFRA_ROLE.NOTE}`,
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
    note: `Differentiator coverage: none — generic stack match (no specialized edge credit)${adjacentNote}`,
  };
};

export const applyDifferentiatorCoverageCap = (
  breakdown: CapabilityBreakdown,
  job: ExtractedJobData,
  options?: DifferentiatorCoverageOptions,
): { breakdown: CapabilityBreakdown; coverage: DifferentiatorCoverageResult } => {
  const lane: RoleLaneLabel = options?.roleLane ?? classifyRoleLane(job).label;
  const adjacentRoleFunction =
    options?.adjacentRoleFunction ?? roleLaneIsAdjacent(lane);
  const frontendPrimaryRole =
    options?.frontendPrimaryRole ?? roleLaneIsFrontendPrimary(lane);
  const platformInfraRole =
    options?.platformInfraRole ?? roleLaneIsPlatformInfra(lane);
  const coverage = evaluateDifferentiatorCoverage(job, {
    adjacentRoleFunction,
    frontendPrimaryRole,
    platformInfraRole,
  });

  if (
    coverage.tier === "strong" &&
    !adjacentRoleFunction &&
    !frontendPrimaryRole &&
    !platformInfraRole
  ) {
    return { breakdown, coverage };
  }

  const normalCap =
    coverage.tier === "none"
      ? null // differentiator absence is additive signal only — do not cap a fully-satisfied match
      : DIFFERENTIATOR_COVERAGE.PARTIAL_CAP;

  let cap = normalCap;
  if (frontendPrimaryRole) {
    const preFilter = countDifferentiatorTags(jobDescriptionBlob(job), {
      adjacentRoleFunction,
      frontendPrimaryRole: false,
      platformInfraRole,
    });
    if (preFilter.count >= DIFFERENTIATOR_COVERAGE.STRONG_MIN_TAGS) {
      cap = FRONTEND_PRIMARY_ROLE.CAP;
    } else if (!cap) {
      // Frontend role shape still applies its own lane cap when no differentiator tags.
      cap = FRONTEND_PRIMARY_ROLE.CAP;
    }
  }
  if (platformInfraRole) {
    cap = PLATFORM_INFRA_ROLE.CAP;
  }

  const adjacentCap = adjacentRoleFunction ? ADJACENT_ROLE_FUNCTION.CAP : null;

  if (!cap && !adjacentCap) {
    return { breakdown, coverage };
  }

  return {
    breakdown: {
      ...breakdown,
      stackFit: Math.min(
        breakdown.stackFit,
        cap?.stackFit ?? Number.POSITIVE_INFINITY,
        adjacentCap?.stackFit ?? Number.POSITIVE_INFINITY,
      ),
      functionalOverlap: Math.min(
        breakdown.functionalOverlap,
        cap?.functionalOverlap ?? Number.POSITIVE_INFINITY,
        adjacentCap?.functionalOverlap ?? Number.POSITIVE_INFINITY,
      ),
    },
    coverage,
  };
};
