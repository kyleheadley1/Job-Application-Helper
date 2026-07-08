import { ADJACENT_ROLE_FUNCTION } from "../config/capabilitySurvivabilityPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import type { CapabilityBreakdown } from "../types/scoring.js";
import {
  countStrongSieRoleDescriptorHits,
  hasBuilderFirstSoftwareContext,
  isFdeBuilderSoftwarePrimaryShape,
} from "./fdeBuilderRole.js";
import { normalizeText } from "./text.js";

export type AdjacentRoleFunctionKind =
  | "implementation_analyst"
  | "business_systems_analyst"
  | "qa_engineer"
  | "solutions_engineer"
  | "technical_analyst"
  | "sales_engineer";

export type RoleFunctionClassification = {
  detected: boolean;
  kind: AdjacentRoleFunctionKind | null;
  label: string | null;
  note: string;
  sieResumeSignal: boolean;
};

const jobBlob = (job: ExtractedJobData): string =>
  normalizeText(
    [
      job.company,
      job.title,
      job.rawText ?? "",
      ...(job.stack ?? []),
      ...(job.requiredSkills ?? []),
      ...(job.preferredSkills ?? []),
      ...(job.domainTags ?? []),
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
    ].join("\n"),
  );

const ADJACENT_TITLE_PATTERNS: Array<{ kind: AdjacentRoleFunctionKind; pattern: RegExp }> = [
  { kind: "implementation_analyst", pattern: /\b(?:technical\s+)?implementation\s+analyst\b/i },
  { kind: "business_systems_analyst", pattern: /\bbusiness\s+systems?\s+analyst\b/i },
  { kind: "qa_engineer", pattern: /\bqa\s+engineer\b/i },
  { kind: "solutions_engineer", pattern: /\bsolutions\s+engineer\b/i },
  { kind: "technical_analyst", pattern: /\btechnical\s+analyst\b/i },
  { kind: "sales_engineer", pattern: /\bsales\s+engineer\b/i },
];

const ANALYST_CORE_PATTERNS: RegExp[] = [
  /\brequirements?\s+doc(?:umentation)?\b/i,
  /\bfunctional\s+requirements?\b/i,
  /\btest\s+plans?\b/i,
  /\bqa\s+test\b/i,
  /\buat\b/i,
  /\buser\s+acceptance\b/i,
  /\bstakeholder\s+coordination\b/i,
  /\bcross[-\s]?functional\s+coordination\b/i,
  /\bimplementation\s+support\b/i,
  /\bconfiguration\s+and\s+testing\b/i,
  /\bvalidate\s+(?:api|integration|system)\b/i,
  /\bapi\s+validat(?:e|ion)\b/i,
  /\bintegration\s+validat(?:e|ion)\b/i,
  /\bprocess\s+documentation\b/i,
  /\bbusiness\s+analysis\b/i,
  /\bworkflow\s+mapping\b/i,
];

const SOFTWARE_BUILDING_PATTERNS: RegExp[] = [
  /\b(?:build|develop|write|ship|own|design|implement)\s+(?:and\s+)?(?:software|code|features?|systems?|services?|applications?)\b/i,
  /\bsoftware\s+engineer(?:ing)?\b/i,
  /\bbackend\s+engineer\b/i,
  /\bfull[-\s]?stack\s+engineer\b/i,
  /\bplatform\s+engineer\b/i,
  /\bproduction\s+code\b/i,
  /\b(?:build|develop|implement).{0,40}\b(?:api|rest|graphql|microservice)\b/i,
  /\b(?:api|rest|graphql|microservice).{0,40}\b(?:build|develop|implement|design|own)\b/i,
];

const QA_AS_PRODUCT_RE =
  /\b(testing as a service|test automation service|managed qa|quality assurance services?|qa wolf|scalence)\b/i;

const CORE_SWE_TITLE_RE =
  /\b(software engineer|backend engineer|full[-\s]?stack engineer|platform engineer|product engineer|machine learning engineer|ai engineer)\b/i;

const countPatternHits = (patterns: RegExp[], blob: string): number =>
  patterns.reduce((count, pattern) => {
    pattern.lastIndex = 0;
    return count + (pattern.test(blob) ? 1 : 0);
  }, 0);

const matchAdjacentTitle = (
  title: string,
): { kind: AdjacentRoleFunctionKind; label: string } | null => {
  for (const { kind, pattern } of ADJACENT_TITLE_PATTERNS) {
    const match = title.match(pattern);
    if (match?.[0]) {
      return { kind, label: match[0].trim() };
    }
  }
  return null;
};

export const hasSiePrimaryResumeSignal = (job: ExtractedJobData): boolean => {
  const blob = jobBlob(job);
  const strongSie = countStrongSieRoleDescriptorHits(blob) >= 2;
  const builderFirst = hasBuilderFirstSoftwareContext(blob) || isFdeBuilderSoftwarePrimaryShape(job);
  return strongSie && !builderFirst;
};

export const classifyRoleFunction = (job: ExtractedJobData): RoleFunctionClassification => {
  const blob = jobBlob(job);
  const title = job.title?.trim() ?? "";
  const titleMatch = matchAdjacentTitle(title);
  const analystSignals = countPatternHits(ANALYST_CORE_PATTERNS, blob);
  const buildingSignals = countPatternHits(SOFTWARE_BUILDING_PATTERNS, blob);
  const sieResumeSignal = hasSiePrimaryResumeSignal(job);
  const qaAsProduct =
    QA_AS_PRODUCT_RE.test(blob) ||
    (/\bqa\s+engineer\b/i.test(title) &&
      /\b(test automation|manual testing|quality assurance|test plans?|bug reports?)\b/i.test(blob));

  const titleIsCoreSwe = CORE_SWE_TITLE_RE.test(title);
  if (titleIsCoreSwe && buildingSignals >= 2 && analystSignals === 0) {
    return {
      detected: false,
      kind: null,
      label: null,
      note: "",
      sieResumeSignal,
    };
  }

  const detected =
    Boolean(titleMatch) ||
    qaAsProduct ||
    (analystSignals >= 2 && buildingSignals < 2) ||
    (Boolean(titleMatch) && analystSignals >= 1) ||
    (sieResumeSignal && analystSignals >= 1 && buildingSignals < 2);

  if (!detected) {
    return {
      detected: false,
      kind: null,
      label: null,
      note: "",
      sieResumeSignal,
    };
  }

  const kind = titleMatch?.kind ?? (qaAsProduct ? "qa_engineer" : "implementation_analyst");
  const label = titleMatch?.label ?? kind.replace(/_/g, " ");

  return {
    detected: true,
    kind,
    label,
    note: ADJACENT_ROLE_FUNCTION.FLAG,
    sieResumeSignal,
  };
};

export const applyAdjacentRoleFunctionCap = (
  breakdown: CapabilityBreakdown,
  job: ExtractedJobData,
): { breakdown: CapabilityBreakdown; classification: RoleFunctionClassification } => {
  const classification = classifyRoleFunction(job);
  if (!classification.detected) {
    return { breakdown, classification };
  }

  const cap = ADJACENT_ROLE_FUNCTION.CAP;
  return {
    breakdown: {
      ...breakdown,
      stackFit: Math.min(breakdown.stackFit, cap.stackFit),
      functionalOverlap: Math.min(breakdown.functionalOverlap, cap.functionalOverlap),
    },
    classification,
  };
};
