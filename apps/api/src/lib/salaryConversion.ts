import type { ExtractedJobData } from "../types/job.js";

/** Standard US full-time hours/year (40 × 52). */
export const HOURS_PER_YEAR = 2080;

export type ParsedAnnualSalary = {
  min?: number;
  max?: number;
  currency?: string;
};

const stripCurrency = (s: string): number | undefined => {
  const cleaned = s.replace(/[$,\s]/g, "").replace(/usd/gi, "");
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) && n > 1000 ? n : undefined;
};

const parseMoneyToken = (token: string): number | undefined => {
  const t = token.trim().toLowerCase();
  const k = t.includes("k");
  const n = Number.parseFloat(t.replace(/[$,]/g, "").replace(/k/gi, ""));
  if (!Number.isFinite(n)) return undefined;
  const scaled = k && n < 1000 ? Math.round(n * 1000) : Math.round(n);
  return scaled > 1000 ? scaled : undefined;
};

const parseHourlyToken = (token: string): number | undefined => {
  const n = Number.parseFloat(token.replace(/[$,]/g, ""));
  if (!Number.isFinite(n) || n < 10 || n > 500) return undefined;
  return n;
};

const isReasonableAnnual = (min: number, max: number): boolean =>
  min >= 20_000 && max <= 500_000 && max >= min;

export const hourlyToAnnual = (hourly: number): number => Math.round(hourly * HOURS_PER_YEAR);

const parseAnnualSalaryFromText = (raw: string): ParsedAnnualSalary | undefined => {
  const t = raw.replace(/\u2013|\u2014/g, "-");

  const kBand = /\$\s*([\d,]+)\s*k\s*[-–]\s*\$\s*([\d,]+)\s*k/gi.exec(t);
  if (kBand) {
    const a = Number.parseInt(kBand[1].replace(/,/g, ""), 10) * 1000;
    const b = Number.parseInt(kBand[2].replace(/,/g, ""), 10) * 1000;
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      if (isReasonableAnnual(min, max)) return { min, max, currency: "USD" };
    }
  }

  const patterns: RegExp[] = [
    /\$\s*([\d,]+)\s*[-–]\s*\$\s*([\d,]+)(?:\s*\/\s*(?:yr|year))?/g,
    /\b([\d,]+)\s*usd\s*[-–]\s*([\d,]+)\s*usd\b/gi,
    /\b(?:between|from)\s*\$?\s*([\d,]+)\s*(?:and|to|-|–)\s*\$?\s*([\d,]+)\b/gi,
    /compensation[^$]{0,120}\$\s*([\d,]+)\s*(?:and|to|-|–)\s*\$\s*([\d,]+)/gi,
    /\$\s*([\d,]+)\s*[-–]\s*\$\s*([\d,]+)\s*\/\s*yr/gi,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    const m = re.exec(t);
    if (!m) continue;
    const a = parseMoneyToken(m[1]) ?? stripCurrency(m[1]);
    const b = parseMoneyToken(m[2]) ?? stripCurrency(m[2]);
    if (a && b) {
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      if (isReasonableAnnual(min, max)) return { min, max, currency: "USD" };
    }
  }

  return undefined;
};

const HOURLY_UNIT = String.raw`(?:\/|\s*per\s*)(?:hr|hour|hours)\b`;

const parseHourlySalaryFromText = (raw: string): ParsedAnnualSalary | undefined => {
  const t = raw.replace(/\u2013|\u2014/g, "-");

  const rangePatterns: RegExp[] = [
    new RegExp(
      String.raw`\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:-|–|to)\s*\$\s*([\d,]+(?:\.\d{1,2})?)\s*${HOURLY_UNIT}`,
      "gi",
    ),
    new RegExp(
      String.raw`\$\s*([\d,]+(?:\.\d{1,2})?)\s*${HOURLY_UNIT}\s*(?:-|–|to)\s*\$\s*([\d,]+(?:\.\d{1,2})?)\s*${HOURLY_UNIT}`,
      "gi",
    ),
    new RegExp(
      String.raw`\b([\d,]+(?:\.\d{1,2})?)\s*(?:-|–|to)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:usd\s*)?${HOURLY_UNIT}`,
      "gi",
    ),
    new RegExp(
      String.raw`(?:hourly|rate)\s*(?:rate\s*)?(?:of\s*)?:?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:-|–|to)\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\b`,
      "gi",
    ),
  ];

  for (const re of rangePatterns) {
    re.lastIndex = 0;
    const m = re.exec(t);
    if (!m) continue;
    const low = parseHourlyToken(m[1]);
    const high = parseHourlyToken(m[2]);
    if (low === undefined || high === undefined) continue;
    const min = hourlyToAnnual(Math.min(low, high));
    const max = hourlyToAnnual(Math.max(low, high));
    if (isReasonableAnnual(min, max)) return { min, max, currency: "USD" };
  }

  const singlePatterns: RegExp[] = [
    new RegExp(String.raw`\$\s*([\d,]+(?:\.\d{1,2})?)\s*${HOURLY_UNIT}`, "gi"),
    new RegExp(String.raw`\b([\d,]+(?:\.\d{1,2})?)\s*(?:usd\s*)?${HOURLY_UNIT}`, "gi"),
    new RegExp(
      String.raw`(?:hourly|rate)\s*(?:rate\s*)?(?:of\s*)?:?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\b`,
      "gi",
    ),
  ];

  for (const re of singlePatterns) {
    re.lastIndex = 0;
    const m = re.exec(t);
    if (!m) continue;
    const hourly = parseHourlyToken(m[1]);
    if (hourly === undefined) continue;
    const annual = hourlyToAnnual(hourly);
    if (isReasonableAnnual(annual, annual)) return { min: annual, max: annual, currency: "USD" };
  }

  return undefined;
};

/** Parse yearly or hourly compensation from JD text into annual min/max USD. */
export const parseSalaryFromText = (raw: string): ParsedAnnualSalary | undefined =>
  parseAnnualSalaryFromText(raw) ?? parseHourlySalaryFromText(raw);

/** Best posted annual band from structured fields, then JD text (including hourly → annual). */
export const resolvePostedSalary = (job: ExtractedJobData): ParsedAnnualSalary => {
  const min = job.salary?.min;
  const max = job.salary?.max;
  const currency = job.salary?.currency ?? "USD";

  if (typeof min === "number" && typeof max === "number" && min > 0 && max > 0) {
    return { min: Math.min(min, max), max: Math.max(min, max), currency };
  }

  if (typeof min === "number" && min > 0 && (!max || max <= 0)) {
    return { min, max: min, currency };
  }

  if (typeof max === "number" && max > 0 && (!min || min <= 0)) {
    return { min: max, max, currency };
  }

  const parsed = job.rawText?.trim() ? parseSalaryFromText(job.rawText) : undefined;
  if (parsed?.min && parsed?.max) return parsed;

  return {};
};
