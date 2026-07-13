import { POOL_FRIENDLINESS } from "../config/capabilitySurvivabilityPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import {
  extractCompanyEmployeeCount,
  isLargeEmployerByHeadcount,
} from "./companyEmployeeCount.js";
import { normalizeText } from "./text.js";

/** Household-name employers — matched against display name only. */
export const BRAND_EMPLOYER_RE =
  /\b(google|alphabet|meta|facebook|amazon|microsoft|apple|netflix|stripe|spotify|uber|airbnb|salesforce|databricks|openai|anthropic|notion|figma|palantir|coinbase|robinhood|doordash|instacart)\b/i;

export const NICHE_EMPLOYER_RE =
  /\b(township|municipal|county|borough|village of|school district|public library|nonprofit|ngo)\b/i;

/** Headcount ceiling for startup / small-team scale (matches historical 1–200 bands). */
export const STARTUP_SMALL_TEAM_EMPLOYEE_CEILING = 200;

const STARTUP_SMALL_TEAM_BAND_RE =
  /\b(1[-\s]?10|11[-\s]?50|51[-\s]?200)\s*(employees|employee|people|person|team)\b/i;

const STARTUP_STAGE_RE =
  /\b(seed|series\s+[ab]|pre-seed|founding team|startup|early[-\s]?stage)\b/i;

/** Enterprise chrome when structured headcount is absent or as a non-count signal. */
const ENTERPRISE_CHROME_RE =
  /\b(fortune\s+\d+|global\s+enterprise|publicly\s+traded\s+since\s+19)\b/i;

export type EmployerScaleSignals = {
  employeeCount?: number;
  isLargeEmployer: boolean;
  isStartupSmallByHeadcount: boolean;
  isBrandName: boolean;
  isNicheName: boolean;
};

export const resolveEmployerScale = (
  job: Pick<ExtractedJobData, "rawText" | "companyEmployeeCount" | "company" | "companyDisplayName">,
  companyName?: string,
): EmployerScaleSignals => {
  const company = normalizeText(
    companyName ?? job.companyDisplayName?.trim() ?? job.company?.trim() ?? "",
  );
  const employeeCount = extractCompanyEmployeeCount(job);
  return {
    employeeCount,
    isLargeEmployer: isLargeEmployerByHeadcount(job),
    isStartupSmallByHeadcount:
      employeeCount != null && employeeCount <= STARTUP_SMALL_TEAM_EMPLOYEE_CEILING,
    isBrandName: Boolean(company) && BRAND_EMPLOYER_RE.test(company),
    isNicheName: Boolean(company) && NICHE_EMPLOYER_RE.test(company),
  };
};

/**
 * Startup / small-team scale for traditional-employer veto.
 * Prefer structured/parsed headcount when present; else legacy band + stage language.
 */
export const isStartupSmallTeamScale = (
  job: Pick<ExtractedJobData, "rawText" | "companyEmployeeCount">,
  combinedText: string,
): boolean => {
  const count = extractCompanyEmployeeCount(job);
  if (count != null) {
    return count <= STARTUP_SMALL_TEAM_EMPLOYEE_CEILING || STARTUP_STAGE_RE.test(combinedText);
  }
  return STARTUP_SMALL_TEAM_BAND_RE.test(combinedText) || STARTUP_STAGE_RE.test(combinedText);
};

/**
 * Large / enterprise employer for pool competitiveness (venture ≠ bigco).
 * Headcount is the shared floor; fortune/global chrome remains alongside.
 */
export const isLargeOrEnterpriseEmployerScale = (
  job: Pick<ExtractedJobData, "rawText" | "companyEmployeeCount">,
  combinedText: string,
): boolean =>
  isLargeEmployerByHeadcount(job) || ENTERPRISE_CHROME_RE.test(combinedText);

export const scoreEmployerRecognizabilityFromScale = (
  scale: EmployerScaleSignals,
): number => {
  let score = POOL_FRIENDLINESS.DEFAULT_EMPLOYER_RECOGNIZABILITY;
  if (scale.isBrandName) {
    score = 0.82;
  } else if (scale.isNicheName) {
    score = 0.28;
  }
  if (scale.isLargeEmployer) {
    score = Math.max(score, POOL_FRIENDLINESS.LARGE_EMPLOYER_RECOGNIZABILITY_FLOOR);
  }
  return score;
};
