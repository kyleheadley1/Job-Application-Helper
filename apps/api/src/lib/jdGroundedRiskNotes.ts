import type { ExtractedJobData } from "../types/job.js";
import { normalizeText } from "./text.js";

const DEFAULT_CITE_MAX = 72;

/** Strip trailing conjunctions/prepositions left by clause cuts ("… issues to"). */
const stripTrailingDangling = (text: string): string => {
  let t = text.trim().replace(/[,;:]+$/g, "").trim();
  for (let i = 0; i < 3; i++) {
    const next = t
      .replace(/\b(to|and|or|of|for|with|the|a|an|in|on|at|by|as|that|which|who|from|into|onto)\s*$/i, "")
      .trim()
      .replace(/[,;:]+$/g, "")
      .trim();
    if (next === t) break;
    t = next;
  }
  return t;
};

/**
 * Cap a JD cite without cutting mid-word; prefer last space / soft punctuation
 * before maxLen, then drop dangling connectors.
 */
export const trimCiteSpan = (raw: string, maxLen = DEFAULT_CITE_MAX): string => {
  let t = raw.replace(/\s+/g, " ").trim();
  if (!t) return t;
  if (t.length > maxLen) {
    let cut = t.slice(0, maxLen);
    const boundary = Math.max(
      cut.lastIndexOf(" "),
      cut.lastIndexOf(","),
      cut.lastIndexOf(";"),
      cut.lastIndexOf(":"),
      cut.lastIndexOf("—"),
      cut.lastIndexOf("–"),
    );
    if (boundary > Math.floor(maxLen * 0.35)) {
      cut = cut.slice(0, boundary);
    } else {
      // No good boundary — back up to last whitespace even if early
      const sp = cut.lastIndexOf(" ");
      if (sp > 0) cut = cut.slice(0, sp);
    }
    t = cut.trim();
  }
  return stripTrailingDangling(t);
};

/** First short JD span matching any pattern — for Key Risk grounding. */
export const firstJdMatch = (text: string, patterns: RegExp[]): string | null => {
  const hay = text ?? "";
  for (const re of patterns) {
    const m = hay.match(re);
    if (m?.[0]) {
      const trimmed = trimCiteSpan(m[0]);
      if (trimmed) return trimmed;
    }
  }
  return null;
};

export const jdDutiesBlob = (job: ExtractedJobData): string =>
  normalizeText(
    [...(job.requirements ?? []), ...(job.responsibilities ?? []), ...(job.requiredSkills ?? [])].join(
      "\n",
    ),
  );

/** Senior-depth asks that can still hard-gate when a multi-band tag includes Mid. */
export const SENIOR_DEPTH_REQUIREMENT_RE =
  /\b(memory management|load testing|profiling|performance profiling|capacity planning|performance tuning|low[-\s]?level optimization|concurrency primitives|lock[-\s]?free|gc tuning|systems? design interview|distributed systems at scale)\b/i;

export const jdSignalsSeniorDepthRequirements = (job: ExtractedJobData): boolean =>
  SENIOR_DEPTH_REQUIREMENT_RE.test(jdDutiesBlob(job));

export const citeSeniorDepthSpan = (job: ExtractedJobData): string | null =>
  firstJdMatch(jdDutiesBlob(job), [
    /\b(memory management|load testing|performance profiling|capacity planning|performance tuning)\b/i,
    SENIOR_DEPTH_REQUIREMENT_RE,
  ]);

export const citeFintechDomainSpan = (job: ExtractedJobData, fallbackText = ""): string => {
  const duties = jdDutiesBlob(job);
  const blob = `${duties}\n${normalizeText(fallbackText)}`;
  return (
    firstJdMatch(blob, [
      /\bco[-\s]?branded\s+cards?\b/i,
      /\b(crypto|web3|blockchain)\s+payments?\b/i,
      /\b(payment(?:s)?\s+(?:platform|infrastructure|processing|flows?|systems?|apis?|product))\b/i,
      /\b(fintech|financial infrastructure|banking api|underwriting)\b/i,
      /\bpayments?\b/i,
    ]) ?? "fintech/payments"
  );
};

export const citeProductionRigorSpan = (dutiesText: string): string =>
  firstJdMatch(dutiesText, [
    /\b(incident response|production ownership|meaningful scope|end[-\s]?to[-\s]?end ownership|technical ownership|operate in production|production systems?|operational maturity|on[-\s]?call)\b/i,
    /\b(reliability|slo|incident)\b/i,
  ]) ?? "production/reliability expectations";

export const citeBackendApiSpan = (dutiesText: string): string =>
  firstJdMatch(dutiesText, [
    /\b(build|develop|design|implement|maintain|own|ship)\s+(?:and\s+)?(?:maintain\s+)?(?:backend\s+)?apis?\b/i,
    /\bapis?\s+(?:used\s+by|for|and)\s+[\w\s-]{0,40}/i,
    /\b(backend|rest|graphql|microservices?|infra(?:structure)?|server[-\s]?side)\b/i,
  ]) ?? "backend/API product work";

/**
 * Normalize a Key Risk line for cross-JD duplicate detection:
 * strip company labels and punctuation so shared templates collide.
 */
export const normalizeRiskBulletForDedup = (line: string, companyNames: string[] = []): string => {
  let t = line.toLowerCase();
  for (const name of companyNames) {
    if (!name?.trim()) continue;
    t = t.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }
  return t
    .replace(/\b(this company|this employer|the company|unknown company)\b/gi, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/** Jaccard token overlap — near-identical when ≥ threshold. */
export const riskBulletsNearIdentical = (
  a: string,
  b: string,
  threshold = 0.85,
): boolean => {
  if (a === b) return true;
  const ta = new Set(a.split(" ").filter((w) => w.length > 2));
  const tb = new Set(b.split(" ").filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter += 1;
  return inter / Math.max(ta.size, tb.size) >= threshold;
};
