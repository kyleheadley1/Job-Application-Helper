import { ADJACENT_ROLE_FUNCTION, FRONTEND_PRIMARY_ROLE } from "../config/capabilitySurvivabilityPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import type { CapabilityBreakdown } from "../types/scoring.js";
import {
  countStrongSieRoleDescriptorHits,
  hasBuilderFirstSoftwareContext,
  isFdeBuilderSoftwarePrimaryShape,
} from "./fdeBuilderRole.js";
import { normalizeMatcherText, normalizeText } from "./text.js";

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

export type FrontendPrimaryClassification = {
  detected: boolean;
  note: string;
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

/** Title is frontend / UI-primary (not full-stack / backend). */
const FRONTEND_TITLE_RE =
  /\b(front[\s-]?end(?:\s+engineer|\s+developer)?|frontend(?:\s+engineer|\s+developer)?|ui\s+engineer|ui\s+developer)\b/i;

const FULL_STACK_OR_BACKEND_TITLE_RE =
  /\b(full[\s-]?stack|back[\s-]?end(?:\s+engineer|\s+developer)?|backend(?:\s+engineer|\s+developer)?)\b/i;

const FRONTEND_WORK_PATTERNS: RegExp[] = [
  /\bbuild(?:ing)?\s+ui\b/i,
  /\bui\s+components?\b/i,
  /\btranslate\s+ux\b/i,
  /\bux\s+designs?\b/i,
  /\bresponsive\s+design\b/i,
  /\baccessibility\b/i,
  /\bcross[\s-]?browser\b/i,
  /\bdesign\s+systems?\b/i,
  /\bcomponent\s+library\b/i,
  /\b(ui|user)\s+interface\b/i,
  /\bcustomer[\s-]?facing\s+(?:ui|react|components?)\b/i,
  /\bfrontend\s+(?:product|features?|systems?|engineering|reliability|architecture)\b/i,
  /\breact\s+(?:components?|applications?|native)\b/i,
  /\bpolished\s+(?:ux|ui)\b/i,
];

/** Role owns / builds backend or APIs — blocks frontend-primary when substantial. */
const BACKEND_BUILDING_PATTERNS: RegExp[] = [
  /\b(?:build|design|develop|implement|create|own|ship).{0,48}\b(?:apis?|rest\s+apis?|graphql|microservices?|backend\s+services?)\b/i,
  /\b(?:apis?|rest\s+apis?|graphql|microservices?).{0,48}\b(?:build|design|develop|implement|own|services?)\b/i,
  /\bback[\s-]?end\s+development\b/i,
  /\bserver[\s-]?side\b/i,
  /\bdata\s+models?\b/i,
  /\bbackend\s+services?\b/i,
  /\b(?:node\.?js|express).{0,40}\b(?:backend|apis?|services?)\b/i,
];

/** API/backend mentions framed as consume / integrate from the client — do not block. */
const API_CONSUMPTION_PATTERNS: RegExp[] = [
  /\bintegrat(?:e|ing|ion)\s+with\b[^.\n]{0,40}\b(?:backend\s+)?(?:apis?|rest|graphql|services?)\b/i,
  /\bconsum(?:e|ing)\s+(?:apis?|rest|graphql)\b/i,
  /\bconnect(?:ing)?\s+(?:the\s+)?frontend\s+to\s+(?:services?|apis?|backends?)\b/i,
  /\bwork(?:ing)?\s+with\b[^.\n]{0,40}\b(?:apis?|node\.?js\s+services?)\b/i,
  /\bpartner\s+closely\s+with\s+backend\b/i,
];

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

/**
 * Frontend-primary product role: title/work dominated by UI; backend/API only consumed.
 * Distinct from adjacent analyst/QA (wrong lane) and from full-stack (backend edge in play).
 */
export const classifyFrontendPrimaryRole = (
  job: ExtractedJobData,
): FrontendPrimaryClassification => {
  const title = normalizeMatcherText(job.title ?? "");
  const blob = jobBlob(job);
  const matcherBlob = normalizeMatcherText(blob);

  if (FULL_STACK_OR_BACKEND_TITLE_RE.test(title)) {
    return { detected: false, note: "" };
  }

  const titleIsFrontend =
    FRONTEND_TITLE_RE.test(title) ||
    /\bsoftware engineer,\s*frontend\b/i.test(job.title ?? "") ||
    /\bassociate software engineer,\s*frontend\b/i.test(job.title ?? "");

  if (!titleIsFrontend) {
    return { detected: false, note: "" };
  }

  const frontendHits = countPatternHits(FRONTEND_WORK_PATTERNS, blob);
  const backendBuildHits = countPatternHits(BACKEND_BUILDING_PATTERNS, blob);
  const consumptionHits = countPatternHits(API_CONSUMPTION_PATTERNS, blob);

  // Prefer full-stack when backend building is core, not just consumption phrasing.
  const backendBuildingDominant =
    backendBuildHits >= 2 && backendBuildHits > consumptionHits && frontendHits < 2;

  if (backendBuildingDominant) {
    return { detected: false, note: "" };
  }

  // Frontend title + (UI work signals OR no strong backend-building) → frontend-primary.
  if (frontendHits >= 1 || backendBuildHits === 0 || consumptionHits >= 1) {
    return {
      detected: true,
      note: FRONTEND_PRIMARY_ROLE.FLAG,
    };
  }

  // Title alone is enough when backend building isn't the dominant shape.
  if (titleIsFrontend && !/\bfull[\s-]?stack\b/.test(matcherBlob) && backendBuildHits < 2) {
    return {
      detected: true,
      note: FRONTEND_PRIMARY_ROLE.FLAG,
    };
  }

  return { detected: false, note: "" };
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

export const applyFrontendPrimaryRoleCap = (
  breakdown: CapabilityBreakdown,
  job: ExtractedJobData,
): { breakdown: CapabilityBreakdown; classification: FrontendPrimaryClassification } => {
  const classification = classifyFrontendPrimaryRole(job);
  if (!classification.detected) {
    return { breakdown, classification };
  }

  const cap = FRONTEND_PRIMARY_ROLE.CAP;
  return {
    breakdown: {
      ...breakdown,
      stackFit: Math.min(breakdown.stackFit, cap.stackFit),
      functionalOverlap: Math.min(breakdown.functionalOverlap, cap.functionalOverlap),
    },
    classification,
  };
};
