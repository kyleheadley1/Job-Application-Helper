import { POOL_FRIENDLINESS } from "../config/capabilitySurvivabilityPolicy.js";
import { EMPLOYEE_COUNT_RE } from "../tools/companyCandidateRules.js";
import type { ExtractedJobData } from "../types/job.js";

/** @deprecated prefer POOL_FRIENDLINESS.LARGE_EMPLOYER_EMPLOYEE_FLOOR */
export const LARGE_EMPLOYER_EMPLOYEE_FLOOR = POOL_FRIENDLINESS.LARGE_EMPLOYER_EMPLOYEE_FLOOR;

const INLINE_EMPLOYEE_COUNT_RE =
  /\b(\d{1,3}(?:,\d{3})?)(?:\s*-\s*(\d{1,3}(?:,\d{3})?)|\+)?\s+employees\b/i;

const parseCountToken = (raw: string): number => Number(raw.replace(/,/g, ""));

/**
 * Parse Simplify-style employee-count lines into a numeric floor for the band.
 * "51-200 employees" → 51; "10,001+ employees" → 10001; "1,001-5,000" → 1001.
 */
export const parseEmployeeCountLine = (line: string): number | undefined => {
  const trimmed = line.trim();
  const match = trimmed.match(INLINE_EMPLOYEE_COUNT_RE) ?? trimmed.match(EMPLOYEE_COUNT_RE);
  if (!match) {
    const loose = INLINE_EMPLOYEE_COUNT_RE.exec(trimmed);
    if (!loose?.[1]) return undefined;
    return parseCountToken(loose[1]);
  }
  const inline = INLINE_EMPLOYEE_COUNT_RE.exec(trimmed);
  if (!inline?.[1]) return undefined;
  return parseCountToken(inline[1]);
};

/** Extract companyEmployeeCount from JD text / structured fields when present. */
export const extractCompanyEmployeeCount = (
  job: Pick<ExtractedJobData, "rawText" | "companyEmployeeCount">,
): number | undefined => {
  if (typeof job.companyEmployeeCount === "number" && job.companyEmployeeCount > 0) {
    return job.companyEmployeeCount;
  }
  const text = job.rawText ?? "";
  for (const line of text.split(/\r?\n/)) {
    const count = parseEmployeeCountLine(line);
    if (count != null) return count;
  }
  // Inline anywhere in blob (Simplify sometimes collapses lines).
  const inline = INLINE_EMPLOYEE_COUNT_RE.exec(text);
  if (inline?.[1]) return parseCountToken(inline[1]);
  return undefined;
};

export const isLargeEmployerByHeadcount = (
  job: Pick<ExtractedJobData, "rawText" | "companyEmployeeCount">,
): boolean => {
  const count = extractCompanyEmployeeCount(job);
  return count != null && count >= POOL_FRIENDLINESS.LARGE_EMPLOYER_EMPLOYEE_FLOOR;
};
