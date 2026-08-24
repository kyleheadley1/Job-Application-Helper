import type { ExtractedJobData } from "../types/job.js";
import type { UserProfile } from "../types/userProfile.js";
import { classifyJdLines, type TagSourceStrength } from "./jdTagProvenance.js";
import { normalizeText } from "./text.js";

/** Min independent required lines restating the same years bar to treat as reinforced. */
export const REINFORCED_EXPERIENCE_FLOOR_MIN_LINES = 4;

export type ReinforcedExperienceFloor = {
  active: boolean;
  thresholdYears: number;
  reinforcingLineCount: number;
  /** Canonical Key Risk when active and candidate is below the floor. */
  riskNote?: string;
};

const YEARS_IN_LINE_RE =
  /\b((?:\d+)\+|at\s+least\s+(\d+)|minimum\s+of\s+(\d+)|(\d+)\s*[-–]\s*\d+)\s*years?\b/i;

const parseYearsFromLine = (line: string): number | null => {
  const m = line.match(YEARS_IN_LINE_RE);
  if (!m) return null;
  if (m[1]?.endsWith("+")) {
    const n = Number.parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
  }
  for (const g of [m[2], m[3], m[4]]) {
    if (g) {
      const n = Number.parseInt(g, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
};

const isRequiredQualificationLine = (
  line: string,
  strength: TagSourceStrength,
): boolean => {
  if (strength !== "REQUIRED") return false;
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 12) return false;
  // Skip section headers alone.
  if (/^(requirements?|qualifications?|basic qualifications?|minimum qualifications?)$/i.test(trimmed)) {
    return false;
  }
  return true;
};

/**
 * Count independently-stated required qualification lines that carry the same
 * (or compatible) years-of-experience threshold. High counts (4+) signal a
 * deliberately calibrated floor, not a one-line boilerplate bar.
 */
export const detectReinforcedExperienceFloor = (
  job: ExtractedJobData,
): ReinforcedExperienceFloor => {
  const threshold =
    job.yearsExperience?.min ??
    (() => {
      const blob = normalizeText(
        [...(job.requirements ?? []), job.rawText ?? ""].join("\n"),
      );
      const m = blob.match(/\b(\d+)\+\s*years?\b/i);
      return m ? Number.parseInt(m[1], 10) : null;
    })();

  if (threshold == null || !Number.isFinite(threshold) || threshold < 1) {
    return { active: false, thresholdYears: 0, reinforcingLineCount: 0 };
  }

  const lines: string[] = [];
  const seen = new Set<string>();

  const consider = (line: string, strength: TagSourceStrength) => {
    if (!isRequiredQualificationLine(line, strength)) return;
    const years = parseYearsFromLine(line);
    if (years == null) return;
    // Compatible = same floor, or within 1 year of the extracted min (2+ vs 3+ on same JD).
    if (Math.abs(years - threshold) > 1) return;
    const key = normalizeText(line).slice(0, 160);
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(line.trim());
  };

  const raw = job.rawText?.trim() ?? "";
  if (raw) {
    for (const { line, strength } of classifyJdLines(raw)) {
      consider(line, strength);
    }
  }

  // Structured requirements array (often REQUIRED when under Basic Qualifications).
  for (const req of job.requirements ?? []) {
    consider(req, "REQUIRED");
  }

  // Prefer raw-classified count when available; fall back to requirements-only.
  const reinforcingLineCount = lines.length;
  const active = reinforcingLineCount >= REINFORCED_EXPERIENCE_FLOOR_MIN_LINES;

  return {
    active,
    thresholdYears: threshold,
    reinforcingLineCount,
    riskNote: active
      ? `Experience bar is restated across ${reinforcingLineCount} separate required qualifications — likely a strict, deliberately calibrated floor rather than boilerplate.`
      : undefined,
  };
};

/** Attach reinforced line count onto yearsExperience during extraction/sanitize. */
export const attachReinforcedExperienceFloor = (job: ExtractedJobData): ExtractedJobData => {
  const floor = detectReinforcedExperienceFloor(job);
  if (!floor.active && floor.reinforcingLineCount === 0) return job;
  return {
    ...job,
    yearsExperience: {
      ...(job.yearsExperience ?? {}),
      min: job.yearsExperience?.min ?? floor.thresholdYears,
      reinforcedLineCount: floor.reinforcingLineCount,
    },
  };
};

/**
 * Estimate candidate professional YOE from profile hint and/or resume date spans.
 * Returns null when unknown — reinforced floor risk still surfaces, but Level-fit
 * dock scales only when we can measure distance below the bar.
 */
export const estimateCandidateProfessionalYears = (params: {
  profile?: UserProfile;
  resumeText?: string;
}): number | null => {
  if (
    params.profile?.estimatedProfessionalYears != null &&
    Number.isFinite(params.profile.estimatedProfessionalYears)
  ) {
    return params.profile.estimatedProfessionalYears;
  }
  const text = params.resumeText ?? "";
  if (!text.trim()) return null;

  // Prefer Experience section date ranges.
  const expStart = text.search(/\bexperience\b/i);
  const eduStart = text.search(/\beducation\b/i);
  const slice =
    expStart >= 0
      ? text.slice(expStart, eduStart > expStart ? eduStart : text.length)
      : text;

  const ranges: Array<{ start: number; end: number }> = [];
  const rangeRe = /\b(20\d{2})\s*[-–—]\s*(20\d{2}|present|current)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(slice)) !== null) {
    const start = Number.parseInt(m[1], 10);
    const endRaw = m[2].toLowerCase();
    const end =
      endRaw === "present" || endRaw === "current"
        ? new Date().getFullYear()
        : Number.parseInt(m[2], 10);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      ranges.push({ start, end });
    }
  }
  // Lone year bullets (e.g. "2025") — count as half a year each, capped.
  const loneYears = [...slice.matchAll(/\b(20\d{2})\b/g)].map((x) => Number.parseInt(x[1], 10));
  if (ranges.length === 0 && loneYears.length > 0) {
    const unique = [...new Set(loneYears)];
    return Math.min(3, Math.max(0.5, unique.length * 0.5));
  }
  if (ranges.length === 0) return null;

  // Union approximate years covered (coarse: sum span lengths, cap overlaps lightly).
  let total = 0;
  for (const r of ranges) {
    total += Math.max(0.5, r.end - r.start + (r.end === r.start ? 0.5 : 0));
  }
  return Math.min(8, Math.round(total * 2) / 2);
};

/**
 * Level-fit dock when candidate is below a reinforced experience floor.
 * Scales by repetition count and years below the bar.
 */
export const reinforcedFloorLevelFitDock = (params: {
  floor: ReinforcedExperienceFloor;
  candidateYears: number | null;
}): number => {
  if (!params.floor.active) return 0;
  const { thresholdYears, reinforcingLineCount } = params.floor;
  const cy = params.candidateYears;
  if (cy == null) {
    // Unknown YOE — still apply a modest dock for a highly restated bar.
    return reinforcingLineCount >= 6 ? 2 : 1;
  }
  if (cy >= thresholdYears) return 0;
  const yearsBelow = thresholdYears - cy;
  const repetitionFactor = Math.min(
    1.25,
    (reinforcingLineCount - (REINFORCED_EXPERIENCE_FLOOR_MIN_LINES - 1)) / 5,
  );
  // e.g. 0.5yr below × 8 lines → ~3–4; 1yr below × 8 → ~5–6
  const raw = yearsBelow * 4 * (0.55 + repetitionFactor);
  return Math.max(1, Math.min(6, Math.round(raw)));
};
