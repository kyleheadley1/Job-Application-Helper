/**
 * Safe coercion of live LLM JSON into shapes our strict Zod contracts accept.
 * Keeps auditability: invalid values are dropped or replaced with explicit neutral strings,
 * not silent "best guesses" for domain facts.
 */

import { SCORE_CATEGORY_MAXES } from '../config/scoringPolicy.js';
import type { Recommendation } from '../types/scoring.js';

const SCORE_KEYS = [
  "stackFit",
  "levelFit",
  "domainFit",
  "resumeStoryClarity",
  "functionalOverlap",
  "recruiterFriendliness",
  "careerValue",
] as const;

const SCORE_MAX: Record<(typeof SCORE_KEYS)[number] | "total", number> = {
  ...SCORE_CATEGORY_MAXES,
  total: 100,
};

export const toFiniteNumber = (x: unknown): number | undefined => {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") {
    const t = x.trim().replace(/,/g, "");
    if (t === "") return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** If the first line is a pasted "Company — Title" JD header, strip it. */
export const stripPastedJdHeaderFromCoverLetter = (job: { extracted: { company: string; title: string } }, coverLetter: string): string => {
  const lines = coverLetter.split(/\r?\n/);
  if (lines.length === 0) return coverLetter;
  const t0 = lines[0]?.trim() ?? "";
  if (!t0) return coverLetter;
  const company = job.extracted.company.trim();
  const title = job.extracted.title.trim();
  if (!company || !title) return coverLetter;
  const p1 = new RegExp(`^${escapeRegExp(company)}\\s*[—:–\\-]\\s*${escapeRegExp(title)}\\s*$`, "i");
  const p2 = new RegExp(`^${escapeRegExp(title)}\\s*[—:–\\-]\\s*${escapeRegExp(company)}\\s*$`, "i");
  if (p1.test(t0) || p2.test(t0)) {
    return lines.slice(1).join("\n").replace(/^\s*\n?/, "").trimStart();
  }
  return coverLetter;
};

/** Break a dense SIE paragraph into short blocks for scanability. */
export const formatWhyCompanyForSIE = (whyCompany: string): string => {
  const t = whyCompany.trim();
  if (t.includes("\n\n")) return t;
  const chunks = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (chunks.length < 3) return t;
  return chunks.slice(0, 6).join("\n\n").trim();
};

export const stringifyLocationValue = (loc: unknown): string | undefined => {
  if (loc === null || loc === undefined) return undefined;
  if (typeof loc === "string") {
    const t = loc.trim();
    return t === "" ? undefined : t;
  }
  if (typeof loc !== "object" || Array.isArray(loc)) return undefined;
  const o = loc as Record<string, unknown>;
  if (typeof o.label === "string" && o.label.trim()) return o.label.trim();
  if (typeof o.displayName === "string" && o.displayName.trim()) return o.displayName.trim();
  const city = typeof o.city === "string" ? o.city.trim() : "";
  const region = typeof o.region === "string" ? o.region.trim() : typeof o.state === "string" ? o.state.trim() : "";
  const country = typeof o.country === "string" ? o.country.trim() : "";
  const parts = [city, region, country].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return undefined;
};

const normalizeUrlField = (raw: unknown): string | undefined => {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (t === "" || /^none$/i.test(t) || t === "undefined" || t === "null") return undefined;
  try {
    // eslint-disable-next-line no-new
    new URL(t);
    return t;
  } catch {
    return undefined;
  }
};

const normalizeStringArray = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      if (typeof x === "string") return x.trim();
      if (x === null || x === undefined) return "";
      if (typeof x === "number" && Number.isFinite(x)) return String(x);
      return String(x).trim();
    })
    .filter((s) => s.length > 0);
};

const DEGREE_LEVELS = new Set(["none", "preferred", "required", "equivalent_allowed", "unknown"]);

/** Preprocess raw model JSON before `ExtractedJobDataSchema` parse. */
export const preprocessExtractionInput = (raw: unknown): unknown => {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };

  const u = normalizeUrlField(o.url);
  if (u === undefined) delete o.url;
  else o.url = u;

  if ("location" in o) {
    const loc = o.location;
    if (loc === null || loc === undefined) delete o.location;
    else if (typeof loc === "string") {
      const t = loc.trim();
      if (t === "") delete o.location;
      else o.location = t;
    } else if (Array.isArray(loc)) {
      const joined = loc.map((x) => (typeof x === "string" ? x.trim() : JSON.stringify(x))).filter(Boolean).join("; ");
      if (joined) o.location = joined;
      else delete o.location;
    } else if (typeof loc === "object") {
      const s = stringifyLocationValue(loc);
      if (s) o.location = s;
      else delete o.location;
    } else delete o.location;
  }

  for (const key of ["stack", "requiredSkills", "preferredSkills", "domainTags", "responsibilities", "requirements"] as const) {
    o[key] = normalizeStringArray(o[key]);
  }

  if (o.salary !== null && o.salary !== undefined && typeof o.salary === "object" && !Array.isArray(o.salary)) {
    const s = o.salary as Record<string, unknown>;
    const min = toFiniteNumber(s.min);
    const max = toFiniteNumber(s.max);
    const currency = typeof s.currency === "string" ? s.currency.trim() : undefined;
    const next: Record<string, unknown> = {};
    if (min !== undefined) next.min = min;
    if (max !== undefined) next.max = max;
    if (currency) next.currency = currency;
    if (Object.keys(next).length === 0) delete o.salary;
    else o.salary = next;
  }

  if (o.yearsExperience !== null && o.yearsExperience !== undefined) {
    if (typeof o.yearsExperience === "number" && Number.isFinite(o.yearsExperience)) {
      const n = o.yearsExperience;
      o.yearsExperience = { raw: String(n), min: n, max: n };
    } else if (typeof o.yearsExperience === "string") {
      const t = o.yearsExperience.trim();
      if (t) o.yearsExperience = { raw: t };
      else delete o.yearsExperience;
    } else if (typeof o.yearsExperience === "object" && !Array.isArray(o.yearsExperience)) {
      const y = o.yearsExperience as Record<string, unknown>;
      const rawStr = typeof y.raw === "string" ? y.raw : undefined;
      const min = toFiniteNumber(y.min);
      const max = toFiniteNumber(y.max);
      const next: Record<string, unknown> = {};
      if (rawStr !== undefined && rawStr.trim()) next.raw = rawStr.trim();
      if (min !== undefined) next.min = min;
      if (max !== undefined) next.max = max;
      if (Object.keys(next).length === 0) delete o.yearsExperience;
      else o.yearsExperience = next;
    } else {
      delete o.yearsExperience;
    }
  }

  if (o.degreeRequirement !== null && o.degreeRequirement !== undefined) {
    if (typeof o.degreeRequirement === "string") {
      const t = o.degreeRequirement.trim();
      if (t) o.degreeRequirement = { raw: t, level: "unknown" };
      else delete o.degreeRequirement;
    } else if (typeof o.degreeRequirement === "object" && !Array.isArray(o.degreeRequirement)) {
      const d = o.degreeRequirement as Record<string, unknown>;
      const rawStr = typeof d.raw === "string" ? d.raw.trim() : undefined;
      const level = typeof d.level === "string" && DEGREE_LEVELS.has(d.level) ? d.level : undefined;
      const next: Record<string, unknown> = {};
      if (rawStr) next.raw = rawStr;
      if (level) next.level = level;
      else if (rawStr) next.level = "unknown";
      if (Object.keys(next).length === 0) delete o.degreeRequirement;
      else o.degreeRequirement = next;
    } else {
      delete o.degreeRequirement;
    }
  }

  for (const key of ["visaRequirement", "citizenshipRequirement", "clearanceRequirement", "seniority"] as const) {
    const v = o[key];
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      const t = v.trim();
      if (t === "") delete o[key];
      else o[key] = t;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      o[key] = String(v);
    } else delete o[key];
  }

  if (typeof o.rawText === "string" && o.rawText.trim() === "") delete o.rawText;

  if (typeof o.company === "string") {
    const t = o.company.trim();
    o.company = t || "Unknown Company";
  } else if (o.company == null) {
    o.company = "Unknown Company";
  }

  if (typeof o.title === "string") {
    const t = o.title.trim();
    o.title = t || "Unknown Title";
  } else if (o.title == null) {
    o.title = "Unknown Title";
  }

  if (o.remoteType !== undefined && o.remoteType !== null) {
    const rt = String(o.remoteType).toLowerCase().trim();
    if (["remote", "hybrid", "onsite", "unknown"].includes(rt)) o.remoteType = rt;
    else delete o.remoteType;
  }

  if (o.locationIsCommutable !== undefined && typeof o.locationIsCommutable !== "boolean") {
    if (o.locationIsCommutable === "true" || o.locationIsCommutable === true) o.locationIsCommutable = true;
    else if (o.locationIsCommutable === "false" || o.locationIsCommutable === false) o.locationIsCommutable = false;
    else delete o.locationIsCommutable;
  }

  if (o.relocationRequired !== undefined && typeof o.relocationRequired !== "boolean") {
    delete o.relocationRequired;
  }

  return o;
};

const pickScoreFromRoot = (o: Record<string, unknown>): Record<string, unknown> | undefined => {
  const out: Record<string, unknown> = {};
  let any = false;
  for (const k of SCORE_KEYS) {
    const n = toFiniteNumber(o[k]);
    if (n !== undefined) {
      out[k] = n;
      any = true;
    }
  }
  const total = toFiniteNumber(o.total);
  if (total !== undefined) {
    out.total = total;
    any = true;
  }
  return any ? out : undefined;
};

const normalizeAndReconcileScore = (scoreObj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of SCORE_KEYS) {
    const n = toFiniteNumber(scoreObj[k]);
    out[k] = n === undefined ? 0 : clamp(Math.round(n), 0, SCORE_MAX[k]);
  }
  const sum = SCORE_KEYS.reduce((acc, k) => acc + (out[k] as number), 0);
  out.total = clamp(sum, 0, SCORE_MAX.total);
  return out;
};

const coerceTopMatchString = (raw: unknown): string => {
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.length > 0) return t;
  }
  if (Array.isArray(raw)) {
    const parts = raw.map((x) => (typeof x === "string" ? x.trim() : JSON.stringify(x))).filter((s) => s.length > 0);
    if (parts.length) return parts.join("; ");
  }
  if (typeof raw === "boolean") {
    return raw ? "Strong primary fit on stated responsibilities and stack." : "Limited stated overlap with the candidate profile on this posting.";
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return `Model numeric summary: ${raw}`;
  }
  return "See score breakdown and rationale for where fit concentrates.";
};

const coerceMainRiskString = (raw: unknown): string => {
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.length > 0) return t;
  }
  if (Array.isArray(raw)) {
    const parts = raw.map((x) => (typeof x === "string" ? x.trim() : JSON.stringify(x))).filter((s) => s.length > 0);
    if (parts.length) return parts.join(" ");
  }
  if (typeof raw === "boolean") {
    return raw ? "Rules flagged at least one material recruiter-screen risk." : "No single dominant risk identified from the evaluated rules.";
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return `Risk priority index: ${raw}`;
  }
  return "Recruiter screen realism risk (unspecified).";
};

const coerceRecommendation = (raw: unknown): Recommendation => {
  const values = [
    "apply_cold",
    "referral_gated",
    "stretch_signal",
    "skip",
    "no",
    "yes",
    "selective_yes",
  ] as const;
  if (typeof raw === "string" && (values as readonly string[]).includes(raw)) {
    return raw as Recommendation;
  }
  return "referral_gated";
};

/** Preprocess raw model JSON before `ScoringOutputSchema` parse. */
export const preprocessScoringInput = (raw: unknown): unknown => {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };

  // Fields that belong to asset generation only — strip so the model is not confused into wrong shapes.
  delete o.emphasize;
  delete o.avoidClaiming;
  delete o.recruiterReplyDraft;

  let scoreObj = o.score;
  if (!scoreObj || typeof scoreObj !== "object" || Array.isArray(scoreObj)) {
    const picked = pickScoreFromRoot(o);
    if (picked) scoreObj = picked;
  }
  if (scoreObj && typeof scoreObj === "object" && !Array.isArray(scoreObj)) {
    o.score = normalizeAndReconcileScore(scoreObj as Record<string, unknown>);
  }

  o.topMatch = coerceTopMatchString(o.topMatch);
  o.mainRisk = coerceMainRiskString(o.mainRisk);
  o.recommendation = coerceRecommendation(o.recommendation);

  if (!Array.isArray(o.rationale)) o.rationale = [];
  else o.rationale = normalizeStringArray(o.rationale);
  if (!Array.isArray(o.risks)) o.risks = [];
  else o.risks = normalizeStringArray(o.risks);

  return o;
};
