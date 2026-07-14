import type { ExtractedJobData } from "../types/job.js";
import { repairMidWordLineBreaks } from "./repairMidWordLineBreaks.js";
import { normalizeText } from "./text.js";

export type NamedHardRequirementGap = {
  name: string;
  evidence: string;
  note: string;
};

/**
 * Hard "must have experience with [Named Product]" sentences — not comma skill chips.
 * Product/platform names need not exist in techCanon to surface a Key Risk.
 */
const MUST_HAVE_NAMED_EXPERIENCE_RE =
  /\bmust\s+have\s+(?:hands[-\s]?on\s+)?experience\s+with\s+([A-Z][A-Za-z0-9][A-Za-z0-9./+#&'-]*(?:[ \t]+[A-Z][A-Za-z0-9][A-Za-z0-9./+#&'-]*){0,4})/gi;

/** Reject captures that are clearly multi-skill lists or soft prose, not a named singular tool. */
const isGenericOrListCapture = (name: string): boolean => {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 64) return true;
  if (/,|;|\//.test(trimmed) && !/\b(CI\/CD|C\/C\+\+)\b/i.test(trimmed)) return true;
  if (/\b(and|or|including|such as|e\.g\.|eg\.?)\b/i.test(trimmed)) return true;
  // Lowercase-heavy phrase → not a Proper Noun / product name.
  const words = trimmed.split(/\s+/);
  if (words.length >= 2 && words.every((w) => /^[a-z]/.test(w))) return true;
  // Pure generic capability phrasing without a product brand.
  if (
    /^(cloud[-\s]?based frameworks?|software design|software development|version control|source control|coding standards|business systems|object[-\s]?oriented programming|event[-\s]?driven programming)$/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  return false;
};

const hardRequirementProseBlob = (job: ExtractedJobData): string =>
  repairMidWordLineBreaks(
    [
      ...(job.requirements ?? []),
      ...(job.requiredSkills ?? []),
      job.rawText ?? "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

/** Extract named tools/platforms from explicit must-have-experience-with sentences. */
export const extractNamedHardRequirements = (job: ExtractedJobData): string[] => {
  const blob = hardRequirementProseBlob(job);
  const found: string[] = [];
  MUST_HAVE_NAMED_EXPERIENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MUST_HAVE_NAMED_EXPERIENCE_RE.exec(blob)) !== null) {
    const name = (match[1] ?? "").trim().replace(/[.,;:]+$/, "");
    if (isGenericOrListCapture(name)) continue;
    if (found.some((n) => normalizeText(n) === normalizeText(name))) continue;
    found.push(name);
  }
  return found;
};

const candidateHasNamedTool = (name: string, candidateBlob: string): boolean => {
  const normName = normalizeText(name);
  const normCand = normalizeText(candidateBlob);
  if (!normName || !normCand) return false;
  if (normCand.includes(normName)) return true;
  // Fuzzy: drop a trailing plural "s" / "interfaces" soft match.
  const stem = normName.replace(/\s+interfaces?$/, "").replace(/s$/, "");
  if (stem.length >= 4 && normCand.includes(stem)) return true;
  // Contiguous letters only (TULIP from "TULIP Interfaces")
  const compact = normName.replace(/\s+/g, "");
  if (compact.length >= 4 && normCand.replace(/\s+/g, "").includes(compact)) return true;
  return false;
};

export const namedHardRequirementRiskNote = (name: string): string =>
  `JD requires named tool/platform ${name} — no experience found in your background.`;

/**
 * Named hard requirements absent from the candidate background.
 * Does not require the term to exist in techCanon.
 */
export const detectNamedHardRequirementGaps = (
  job: ExtractedJobData,
  candidateBlob: string,
): NamedHardRequirementGap[] => {
  const names = extractNamedHardRequirements(job);
  const gaps: NamedHardRequirementGap[] = [];
  for (const name of names) {
    if (candidateHasNamedTool(name, candidateBlob)) continue;
    gaps.push({
      name,
      evidence: `Must have experience with ${name}`,
      note: namedHardRequirementRiskNote(name),
    });
  }
  return gaps;
};
