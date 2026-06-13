/**
 * Deterministic parsing for Simplify / Jobright-style pasted job chrome.
 */
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";
import {
  extractPreScoringMetadata,
  isLocationPrefixedTitle,
  looksLikeLocation,
  type PreScoringJobMetadata,
} from "./preScoringMetadataExtract.js";
import { isBoardMatchChromeLine } from "./jobBoardMatchExtract.js";

export type { PreScoringJobMetadata } from "./preScoringMetadataExtract.js";

export type JobPostingMetadata = {
  companyName: string | null;
  jobTitle: string | null;
  employmentType: string | null;
  location: string | null;
  seniority: string | null;
  salary: string | null;
  workModel: string | null;
  preScoring?: PreScoringJobMetadata;
};

export type CompanyCandidateScore = {
  line: string;
  index: number;
  score: number;
  reasons: string[];
};

const EMPLOYMENT_TYPES = new Set(
  ["contract", "full-time", "full time", "part-time", "part time", "internship", "temporary", "freelance"].map((s) =>
    s.toLowerCase(),
  ),
);

const SENIORITY_LABELS = new Set(
  ["entry", "junior", "mid level", "mid-level", "senior", "staff", "principal", "lead"].map((s) => s.toLowerCase()),
);

const WORK_MODEL_LABELS = new Set(["remote", "hybrid", "in person", "in-person", "onsite", "on-site"].map((s) => s.toLowerCase()));

const NOISE_PREFIXES = [
  "open user menu",
  "updated on",
  "unlock job analytics with",
  "simplify+",
  "applications through a referral",
  "get referrals",
  "connection",
  "logo",
  "history",
  "summary",
  "full job posting",
  "why this job is a match",
  "see more like this?",
  "yes",
  "no",
  "matched based on",
  "change preferences",
  "category",
  "required skills",
  "compensation overview",
];

const NEGATIVE_COMPANY_PREFIXES = ["what ", "how ", "why ", "about ", "our company", "the "];

const ROLE_TITLE_RE =
  /\b((?:full[\s-]?stack|fullstack|frontend|backend|platform|infrastructure|machine learning|site reliability|product)\s+)?(?:engineer|developer|software|devops|sre|scientist|architect|analyst|designer|programmer|enablement)\b|\b(?:forward deployed|ai enablement|ai engineer|full stack|fullstack)\b/i;

const EMPLOYEE_COUNT_RE = /^\d[\d,]*\s*-\s*[\d,]+\s+employees$/i;
const UPDATED_ON_RE = /^updated on\b/i;
const LOCATION_RE = /^[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}(?:,\s*(?:USA|US))?$/;
const SALARY_LINE_RE = /^\$?\d[\d,k.]*\s*-\s*\$?\d[\d,k.]*\s*\/\s*yr$/i;

export const normalizeJobLines = (rawJobText: string): string[] =>
  rawJobText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

const lineLower = (line: string): string => line.trim().toLowerCase();

export const isNoiseLine = (line: string): boolean => {
  const low = lineLower(line);
  if (!low) return true;
  return NOISE_PREFIXES.some((p) => low === p || low.startsWith(p));
};

export const isEmployeeCountLine = (line: string): boolean => EMPLOYEE_COUNT_RE.test(line.trim());

export const isProbablyNotCompany = (line: string): boolean => {
  const trimmed = line.trim();
  const low = lineLower(trimmed);
  if (!low) return true;
  if (isBoardMatchChromeLine(trimmed)) return true;
  if (EMPLOYMENT_TYPES.has(low)) return true;
  if (SENIORITY_LABELS.has(low)) return true;
  if (WORK_MODEL_LABELS.has(low)) return true;
  if (low === "no salary listed") return true;
  if (looksLikeLocation(trimmed)) return true;
  if (UPDATED_ON_RE.test(low)) return true;
  if (isEmployeeCountLine(trimmed)) return true;
  if (SALARY_LINE_RE.test(trimmed)) return true;
  if (LOCATION_RE.test(trimmed)) return true;
  if (/\bemployees?\b/i.test(trimmed) && /\d/.test(trimmed)) return true;
  if (trimmed.split(/\s+/).length > 6) return true;
  if (/[.!?]$/.test(trimmed) && trimmed.split(/\s+/).length > 4) return true;
  if (NEGATIVE_COMPANY_PREFIXES.some((p) => low.startsWith(p))) return true;
  return false;
};

const isTitleCaseOrBrand = (line: string): boolean => {
  const words = line.trim().split(/\s+/);
  if (!words.length) return false;
  if (words.length === 1 && /^[A-Z0-9&.+]+$/.test(words[0]!) && words[0]!.length <= 24) return true;
  return words.every((w) => /^[A-Z][A-Za-z0-9&.'-]*$/.test(w) || /^[A-Z]{2,}$/.test(w));
};

const findLineIndex = (lines: string[], pred: (line: string, i: number) => boolean): number => {
  const idx = lines.findIndex((l, i) => pred(l, i));
  return idx;
};

export const extractJobTitleFromLines = (lines: string[]): string | null => {
  const updatedIdx = findLineIndex(lines, (l) => UPDATED_ON_RE.test(l));
  const searchEnd = updatedIdx >= 0 ? updatedIdx : Math.min(lines.length, 12);

  for (let i = 0; i < searchEnd; i++) {
    const line = lines[i]!;
    if (isNoiseLine(line) || isProbablyNotCompany(line)) continue;
    if (!ROLE_TITLE_RE.test(line)) continue;
    if (line.length > 120) continue;
    return line;
  }

  for (let i = 0; i < searchEnd; i++) {
    const line = lines[i]!;
    if (isNoiseLine(line) || EMPLOYMENT_TYPES.has(lineLower(line))) continue;
    if (isProbablyNotCompany(line)) continue;
    if (line.length >= 8 && line.length <= 100) return line;
  }
  return null;
};

export const extractEmploymentTypeFromLines = (lines: string[]): string | null => {
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const line = lines[i]!;
    if (EMPLOYMENT_TYPES.has(lineLower(line))) return line;
  }
  return null;
};

export const extractWorkModelFromLines = (lines: string[]): string | null => {
  for (const line of lines.slice(0, 30)) {
    const low = lineLower(line);
    if (WORK_MODEL_LABELS.has(low)) return line;
  }
  return null;
};

export const extractSeniorityFromLines = (lines: string[]): string | null => {
  for (const line of lines.slice(0, 30)) {
    if (SENIORITY_LABELS.has(lineLower(line))) return line;
  }
  return null;
};

export const extractLocationFromLines = (lines: string[]): string | null => {
  for (const line of lines.slice(0, 30)) {
    if (LOCATION_RE.test(line.trim())) return line;
  }
  return null;
};

export const extractSalaryLabelFromLines = (lines: string[]): string | null => {
  for (const line of lines.slice(0, 30)) {
    const low = lineLower(line);
    if (low === "no salary listed") return line;
    if (SALARY_LINE_RE.test(line)) return line;
  }
  return null;
};

export const scoreCompanyCandidates = (lines: string[]): CompanyCandidateScore[] => {
  const title = extractJobTitleFromLines(lines);
  const titleIdx = title ? lines.findIndex((l) => l === title) : -1;
  const updatedIdx = findLineIndex(lines, (l) => UPDATED_ON_RE.test(l));
  const scores: CompanyCandidateScore[] = [];

  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const line = lines[i]!;
    if (isNoiseLine(line) || isProbablyNotCompany(line)) continue;
    if (title && line === title) continue;

    let score = 0;
    const reasons: string[] = [];

    const prev = i > 0 ? lines[i - 1]! : "";
    const next = i + 1 < lines.length ? lines[i + 1]! : "";
    if (prev && lineLower(prev) === lineLower(line)) {
      score += 55;
      reasons.push("consecutive_duplicate");
    }
    if (next && lineLower(next) === lineLower(line)) {
      score += 55;
      reasons.push("consecutive_duplicate");
    }
    if (next && isEmployeeCountLine(next)) {
      score += 45;
      reasons.push("before_employee_count");
    }
    if (titleIdx >= 0 && i > titleIdx && (updatedIdx < 0 || i > updatedIdx)) {
      score += 12;
      reasons.push("after_title_updated_block");
    }
    if (i < 25) {
      score += Math.max(0, 8 - Math.floor(i / 3));
      reasons.push("near_top");
    }
    const wordCount = line.split(/\s+/).length;
    if (wordCount >= 1 && wordCount <= 4) {
      score += 10;
      reasons.push("short_brand_length");
    }
    if (isTitleCaseOrBrand(line)) {
      score += 8;
      reasons.push("brand_casing");
    }
    if (next && !isEmployeeCountLine(next) && !isNoiseLine(next) && next.length > 20 && !isProbablyNotCompany(next)) {
      score += 5;
      reasons.push("before_industry_description");
    }

    if (score > 0) scores.push({ line, index: i, score, reasons });
  }

  scores.sort((a, b) => b.score - a.score || a.index - b.index);
  return scores;
};

export const extractCompanyName = (rawJobText: string): string | null => {
  const lines = normalizeJobLines(rawJobText);
  const ranked = scoreCompanyCandidates(lines);
  if (!ranked.length) return null;
  return ranked[0]!.line;
};

export const extractJobPostingMetadata = (rawJobText: string): JobPostingMetadata => {
  const lines = normalizeJobLines(rawJobText);
  const preScoring = extractPreScoringMetadata(rawJobText);
  const simplify = {
    companyName: extractCompanyName(rawJobText),
    jobTitle: extractJobTitleFromLines(lines),
    employmentType: extractEmploymentTypeFromLines(lines),
    location: extractLocationFromLines(lines),
    seniority: extractSeniorityFromLines(lines),
    salary: extractSalaryLabelFromLines(lines),
    workModel: extractWorkModelFromLines(lines),
  };

  const preferPreScoring = preScoring.confidence === "high" || preScoring.confidence === "medium";
  return {
    companyName: preferPreScoring ? preScoring.companyName ?? simplify.companyName : simplify.companyName ?? preScoring.companyName,
    jobTitle: preferPreScoring ? preScoring.jobTitle ?? simplify.jobTitle : simplify.jobTitle ?? preScoring.jobTitle,
    location: preScoring.location ?? simplify.location,
    employmentType: simplify.employmentType,
    seniority: simplify.seniority,
    salary: simplify.salary,
    workModel: simplify.workModel,
    preScoring,
  };
};

export const isWeakOrPlaceholderCompany = (company: string | undefined | null): boolean => {
  const t = company?.trim();
  if (!t) return true;
  if (/^unknown company$/i.test(t)) return true;
  return isProbablyNotCompany(t) || isNoiseLine(t);
};

export const isWeakJobTitle = (title: string | undefined | null): boolean => {
  const t = title?.trim();
  if (!t || /^unknown title$/i.test(t)) return true;
  if (/^\d{1,3}%$/.test(t)) return true;
  if (isBoardMatchChromeLine(t)) return true;
  if (EMPLOYMENT_TYPES.has(lineLower(t))) return true;
  if (isNoiseLine(t)) return true;
  if (isLocationPrefixedTitle(t)) return true;
  if (looksLikeLocation(t)) return true;
  if (!ROLE_TITLE_RE.test(t) && t.length < 12) return true;
  return false;
};

/** If Unknown/wrong company, recover from repeated line before employee count. */
export const validateExtractedCompany = (
  company: string | null | undefined,
  rawJobText: string,
): string | null => {
  if (company?.trim() && !isWeakOrPlaceholderCompany(company)) return company.trim();

  const lines = normalizeJobLines(rawJobText);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const prev = lines[i - 1]!;
    if (lineLower(prev) !== lineLower(line)) continue;
    if (isNoiseLine(line) || isProbablyNotCompany(line)) continue;
    const next = lines[i + 1];
    if (next && isEmployeeCountLine(next)) return line;
  }

  const extracted = extractCompanyName(rawJobText);
  return extracted;
};

export const logJobPostingMetadataDebug = (
  rawJobText: string,
  meta: JobPostingMetadata,
  selectedReason?: string,
): void => {
  if (env.nodeEnv !== "development") return;
  const lines = normalizeJobLines(rawJobText);
  const candidates = scoreCompanyCandidates(lines).slice(0, 8);
  logger.info("job posting metadata extract", {
    firstLines: lines.slice(0, 30),
    extractedJobTitle: meta.jobTitle,
    extractedCompanyName: meta.companyName,
    extractedLocation: meta.location,
    preScoring: meta.preScoring,
    companyCandidates: candidates,
    selectedReason: selectedReason ?? (candidates[0]?.reasons.join(", ") || meta.preScoring?.rawTitleSource || "none"),
  });
};
