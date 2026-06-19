/**
 * Shared heuristics to reject JD body prose as company names and accept brand-like headers.
 */

/** Job-board activity lines after the listing company (Jobright, LinkedIn-style). */
export const ACTIVITY_TIMESTAMP_RE =
  /^[·•]\s*(?:\d+.*\bago\b|(?:reposted|posted|updated|active|promoted)\b.*)/i;

export const ACTIVITY_LINE_RE =
  /^(?:[·•]\s*)?(?:reposted|posted|updated|promoted|active)\b.+?\bago\b/i;

const BODY_SECTION_HEADERS = new Set(
  [
    "responsibilities",
    "qualification",
    "qualifications",
    "required",
    "preferred",
    "what you'll be doing",
    "what you’ll be doing",
    "about the role",
    "about you",
    "what the job involves",
    "who you are",
  ].map((s) => s.toLowerCase()),
);

const PROSE_INDICATOR_RE =
  /\b(including|using|with|stakeholders|clients|users|teams|members|leaders|engineers|scientists|mathematicians|statisticians|responsibilities|qualifications|required|preferred|experience|skills|communicating|solving|conducting|participating|managing|developing|designing|implementing|working|collaborating)\b/i;

const COMMON_VERB_PREPOSITION_RE =
  /\b(in|on|at|to|for|of|and|or|the|a|an|with|including|using|from|by|as|is|are|was|were|be|have|has|had|will|would|can|could|should|may|might|must|do|does|did|that|this|these|those|their|our|your|we|you|they|it|its)\b/i;

const CONNECTOR_WORDS = new Set(["of", "and", "&", "the", "-"]);

const LOCATION_COUNTRY_RE = /^(united states|united kingdom|canada|australia|germany|france|india|remote)$/i;
const LOCATION_CITY_STATE_RE = /^[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}(?:,\s*(?:USA|US))?$/;

const lineLower = (line: string): string => line.trim().toLowerCase();

function looksLikeLocationLine(line: string): boolean {
  const t = line.trim();
  if (LOCATION_COUNTRY_RE.test(t)) return true;
  if (LOCATION_CITY_STATE_RE.test(t)) return true;
  if (/^(remote|hybrid|on-site|onsite)$/i.test(t)) return true;
  return false;
}

export const isActivityTimestampLine = (line: string): boolean => {
  const t = line.trim();
  if (!t) return false;
  return ACTIVITY_TIMESTAMP_RE.test(t) || ACTIVITY_LINE_RE.test(t);
};

export const isBodySectionHeaderLine = (line: string): boolean =>
  BODY_SECTION_HEADERS.has(lineLower(line));

export const findBodySectionStartIndex = (lines: string[]): number => {
  for (let i = 0; i < lines.length; i++) {
    if (isBodySectionHeaderLine(lines[i]!)) return i;
  }
  return lines.length;
};

export const isInBodySection = (lines: string[], index: number): boolean =>
  index >= findBodySectionStartIndex(lines);

/** Explicit labeled company lines allowed inside body sections. */
export const parseExplicitCompanyLabel = (line: string): string | null => {
  const trimmed = line.trim();
  const labeled = trimmed.match(/^(?:company|employer)\s*:\s*(.+)$/i);
  if (labeled?.[1]) return labeled[1].trim();
  const about = trimmed.match(/^about\s+([A-Z][A-Za-z0-9&.'\-\s]{1,40})$/i);
  if (about?.[1] && looksLikeBrandCompanyName(about[1])) return about[1].trim();
  return null;
};

export const isHardRejectedCompanyCandidate = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.length > 60) return true;
  if (trimmed.split(/\s+/).length > 5) return true;
  if (/[,;.:]/.test(trimmed)) return true;
  if (PROSE_INDICATOR_RE.test(trimmed)) return true;
  if (looksLikeLocationLine(trimmed)) return true;
  if (isBodySectionHeaderLine(trimmed)) return true;
  if (isActivityTimestampLine(trimmed)) return true;
  return false;
};

export function looksLikeBrandCompanyName(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 60) return false;
  if (isHardRejectedCompanyCandidate(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 1 || words.length > 4) return false;
  if (PROSE_INDICATOR_RE.test(t)) return false;

  return words.every((w, i) => {
    const low = w.toLowerCase();
    if (CONNECTOR_WORDS.has(low) && i > 0 && i < words.length - 1) return true;
    if (/^[A-Z0-9&.+]{2,}$/.test(w)) return true;
    if (/^[A-Z][A-Za-z0-9&.'-]*$/.test(w)) {
      if (words.length === 1) return true;
      if (COMMON_VERB_PREPOSITION_RE.test(low) && !CONNECTOR_WORDS.has(low)) return false;
      return true;
    }
    return false;
  });
}

/** First header line immediately before a job-board activity/timestamp line. */
export const extractHeaderCompanyBeforeActivity = (lines: string[]): string | null => {
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const next = lines[i + 1];
    if (!next || !isActivityTimestampLine(next)) continue;
    if (isHardRejectedCompanyCandidate(line)) continue;
    if (!looksLikeBrandCompanyName(line)) continue;
    return line;
  }
  return null;
};

/** "Battelle is a research and development organization..." → Battelle */
export const extractCompanyFromSelfDescription = (rawJobText: string): string | null => {
  const lines = rawJobText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 40)) {
    const m = line.match(/^([A-Z][A-Za-z0-9&.'-]{1,30})\s+is\s+(?:a|an|the)\s+/);
    if (!m?.[1]) continue;
    const candidate = m[1].trim();
    if (looksLikeBrandCompanyName(candidate)) return candidate;
  }
  return null;
};
