const PROSE_RE =
  /\b(including|using|with|stakeholders|clients|customers|users|teams|members|leaders|engineers|scientists|mathematicians|statisticians|communicating|working|collaborating|requirements?|responsibilities|qualification|qualifications|preferred|required|skills?|experience)\b/i;

const JOB_TITLE_LIKE_RE =
  /\b((?:full[\s-]?stack|frontend|backend|platform|product|deployment|forward deployed|machine learning|site reliability|ai enablement)\s+)?(?:engineer|developer|software|devops|sre|scientist|architect|analyst|designer|programmer|manager|director|lead|specialist|coordinator)\b|\b(?:product\s*&\s*deployment|forward deployed)\b/i;

const LEGAL_ENTITY_SUFFIX_RE =
  /(?:,\s*)?(Inc|LLC|Corp|Corporation|Ltd|Co|Company|LP|LLP|PLC|GmbH)\.?$/i;

const LOCATION_EXACT = new Set(
  ["us", "u.s.", "usa", "u.s.a.", "united states", "remote", "onsite", "on-site", "hybrid", "in person"].map(
    (s) => s.toLowerCase(),
  ),
);

const SENIORITY_EXACT = new Set(
  ["entry level", "entry-level", "mid level", "mid-level", "senior level", "junior", "senior", "staff", "principal", "lead", "intern"].map(
    (s) => s.toLowerCase(),
  ),
);

const ACTIVITY_LINE_RE =
  /^(?:[·•\-|]\s*)?(?:(?:reposted|posted|updated|promoted|active)\b.+?\bago\b|on\s+\d{1,2}\/\d{1,2}\/\d{2,4})/i;

export function isLocationLikeCompanyName(name: string): boolean {
  const trimmed = name.trim();
  const key = trimmed.toLowerCase();
  if (!key) return true;
  if (LOCATION_EXACT.has(key)) return true;
  if (/^[a-z]{1,3}$/.test(trimmed)) return true;
  if (/\b(?:USA|U\.S\.|United States)\b/i.test(trimmed)) return true;
  if (/\bmore locations?\b/i.test(trimmed)) return true;
  if (/\+\s*\d+\s+more/i.test(trimmed)) return true;
  if (/^[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}/i.test(trimmed)) return true;
  return false;
}

function isSeniorityLikeCompanyName(name: string): boolean {
  const key = name.trim().toLowerCase();
  if (!key) return true;
  if (SENIORITY_EXACT.has(key)) return true;
  if (/^(entry|junior|mid|senior|staff|principal|lead)[\s-]?level$/i.test(key)) return true;
  return false;
}

function isLegalEntityCompanyName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 48) return false;
  if (!LEGAL_ENTITY_SUFFIX_RE.test(trimmed)) return false;
  if (!/^[A-Z]/.test(trimmed)) return false;
  if (isSeniorityLikeCompanyName(trimmed)) return false;
  if (isLocationLikeCompanyName(trimmed)) return false;
  return true;
}

function isJobTitleLikeLine(line: string): boolean {
  return JOB_TITLE_LIKE_RE.test(line.trim());
}

export function isProseCompanyName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (/^[A-Za-z0-9]{1,4}\.[A-Za-z][A-Za-z0-9'-]{0,24}$/.test(trimmed)) return false;
  if (isJobTitleLikeLine(trimmed)) return true;
  if (isSeniorityLikeCompanyName(trimmed)) return true;
  if (isLegalEntityCompanyName(trimmed)) return false;
  if (trimmed.length > 60) return true;
  if (trimmed.split(/\s+/).length > 5) return true;
  if (/[,.;:!?]/.test(trimmed)) return true;
  if (isLocationLikeCompanyName(trimmed)) return true;
  return PROSE_RE.test(trimmed);
}

export function headerCompanyFromRawText(rawText?: string): string | null {
  if (!rawText?.trim()) return null;
  const lines = rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i]!;
    const next = lines[i + 1];
    if (!next || !ACTIVITY_LINE_RE.test(next)) continue;
    if (isProseCompanyName(line) || isJobTitleLikeLine(line)) continue;
    if (line.split(/\s+/).length > 4) continue;
    return line;
  }
  for (const line of lines.slice(0, 40)) {
    const m = line.match(/^(.{2,48}?)\s+is\s+(?:a|an|the|building)\b/i);
    if (m?.[1] && !isProseCompanyName(m[1])) return m[1].trim();
  }
  for (let i = 0; i < lines.length - 2; i++) {
    if (lines[i + 1] !== lines[i + 2]) continue;
    const candidate = lines[i + 1]!;
    const next = lines[i + 3] ?? "";
    if (/^\d{1,3}(?:,\d{3})?(?:\s*-\s*\d{1,3})?\s+employees$/i.test(next) && !isProseCompanyName(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function pickDisplayCompanyName(
  candidates: Array<string | undefined | null>,
  rawText?: string,
): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && !isProseCompanyName(trimmed)) return trimmed;
  }
  return headerCompanyFromRawText(rawText) ?? candidates.find((c) => c?.trim())?.trim() ?? "";
}
