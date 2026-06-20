/**
 * Centralized company candidate validation and ranked extraction.
 * Every company source must pass isValidCompanyCandidate before merge/display.
 */

export type CompanySource =
  | "user_hint"
  | "posted_header"
  | "duplicate_before_employee_count"
  | "labeled_field"
  | "about_header"
  | "self_description"
  | "llm"
  | "fallback_scoring";

export const COMPANY_SOURCE_RANK: Record<CompanySource, number> = {
  user_hint: 100,
  posted_header: 95,
  duplicate_before_employee_count: 90,
  labeled_field: 85,
  about_header: 80,
  self_description: 75,
  llm: 60,
  fallback_scoring: 40,
};

export type CompanyCandidate = {
  value: string;
  source: CompanySource;
  rank: number;
};

export const LOCATION_COMPANY_REJECT_EXACT = new Set(
  [
    "us",
    "u.s",
    "u.s.",
    "usa",
    "u.s.a",
    "u.s.a.",
    "united states",
    "united states of america",
    "remote",
    "onsite",
    "on-site",
    "hybrid",
    "in person",
    "new york",
    "ny",
    "nyc",
    "san francisco",
    "sf",
    "california",
    "ca",
    "bay area",
    "location",
    "locations",
    "more locations",
  ].map((s) => s.toLowerCase()),
);

export const COMPANY_PROSE_REJECTORS: RegExp[] = [
  /\b(including|using|with|within|through|across|between|among|for|from|to)\b/i,
  /\b(stakeholders|clients|customers|users|teams|members|leaders|engineers|scientists|mathematicians|statisticians|epidemiologist|developers|operators|executives)\b/i,
  /\b(communicating|solving|conducting|participating|managing|developing|designing|implementing|maintaining|working|collaborating|debugging|shipping|building|owning|deploying)\b/i,
  /\b(requirements?|responsibilities|qualification|qualifications|preferred|required|skills?|experience|ability|knowledge|benefits|salary|compensation|category|connection|history|summary)\b/i,
];

const JOB_TITLE_LIKE_RE =
  /\b((?:full[\s-]?stack|frontend|backend|platform|product|deployment|forward deployed|machine learning|site reliability|ai enablement)\s+)?(?:engineer|developer|software|devops|sre|scientist|architect|analyst|designer|programmer|manager|director|lead|specialist|coordinator)\b|\b(?:product\s*&\s*deployment|forward deployed)\b/i;

export const POSTED_TIMESTAMP_RE =
  /^(?:[·•\-|]\s*)?(?:reposted|posted)?\s*(?:\d+\s+(?:minute|minutes|hour|hours|day|days|week|weeks|month|months)\s+ago|on\s+\d{1,2}\/\d{1,2}\/\d{2,4}|on\s+[A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i;

export const EMPLOYEE_COUNT_RE =
  /^\d{1,3}(?:,\d{3})?(?:\s*-\s*\d{1,3}(?:,\d{3})?|\+)?\s+employees$/i;

export const BODY_SECTION_HEADER_RE =
  /^(responsibilities|qualification|qualifications|required|preferred|what you.?ll do|what you.?ll be doing|who you are|about the role|about you|this role is for you if|this role is likely not for you if|our tech stack|our benefits|workplace policy|equal opportunity|candidate privacy notice|accommodations|what the job involves)$/i;

/** @deprecated use POSTED_TIMESTAMP_RE */
export const ACTIVITY_TIMESTAMP_RE = POSTED_TIMESTAMP_RE;
/** @deprecated use POSTED_TIMESTAMP_RE */
export const ACTIVITY_LINE_RE = POSTED_TIMESTAMP_RE;

export function normalizeJobLines(rawJobText: string): string[] {
  return rawJobText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function normalizeCompanyCandidateKey(line: string): string {
  return line
    .trim()
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[:;,]+$/g, "");
}

export function isLocationOrCountryCompanyCandidate(line: string): boolean {
  const trimmed = line.trim();
  const key = normalizeCompanyCandidateKey(trimmed);

  if (!key) return true;
  if (LOCATION_COMPANY_REJECT_EXACT.has(key)) return true;
  if (/^[a-z]{1,3}$/.test(trimmed)) return true;
  if (/\b(?:USA|U\.S\.|United States)\b/i.test(trimmed)) return true;
  if (/\bmore locations?\b/i.test(trimmed)) return true;
  if (/\bremote in\b/i.test(trimmed)) return true;
  if (/\+\s*\d+\s+more/i.test(trimmed)) return true;
  if (/^remote\b/i.test(trimmed) && trimmed.split(/\s+/).length > 1) return true;
  if (/^[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}(?:,\s*(?:USA|U\.S\.|United States))?/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function isJobTitleLikeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return JOB_TITLE_LIKE_RE.test(trimmed);
}

export function isCompanyProseCandidate(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (isJobTitleLikeLine(trimmed)) return true;
  if (trimmed.length > 60) return true;
  if (trimmed.split(/\s+/).length > 5) return true;
  if (/[,.;:!?]/.test(trimmed)) return true;
  return COMPANY_PROSE_REJECTORS.some((re) => re.test(trimmed));
}

const COMPANY_NAME_PARTICLES = new Set(["of", "the", "and", "&"]);

function hasAcceptableCompanyWordCasing(trimmed: string): boolean {
  const words = trimmed.split(/\s+/);
  return words.every((word, index) => {
    if (index > 0 && COMPANY_NAME_PARTICLES.has(word.toLowerCase())) return true;
    return /^[A-Z0-9&]/.test(word);
  });
}

export function isBrandLikeCompany(line: string): boolean {
  const trimmed = line.trim();
  const words = trimmed.split(/\s+/);

  if (!trimmed) return false;
  if (words.length < 1 || words.length > 4) return false;
  if (trimmed.length > 45) return false;
  if (isLocationOrCountryCompanyCandidate(trimmed)) return false;
  if (isCompanyProseCandidate(trimmed)) return false;

  if (
    /^(posted|reposted|position|time|remote|seniority|money|category|required|preferred|summary|history|full job posting|why this job is a match|contract|full-time|full time|part-time|part time|internship|temporary|freelance)$/i.test(
      trimmed,
    )
  ) {
    return false;
  }

  if (
    /^[A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,3}$/.test(trimmed) ||
    (hasAcceptableCompanyWordCasing(trimmed) &&
      /^[A-Z][A-Za-z0-9&'.-]*/.test(trimmed) &&
      words.length <= 4)
  ) {
    return true;
  }

  return (
    /\b(Inc|LLC|Labs|AI|Technologies|Systems|Group|Health|Research|Corporation|Corp|University|Institute|Ventures|Capital)\b/.test(
      trimmed,
    ) ||
    (/^[A-Z0-9&.+]{2,}$/.test(trimmed) && words.length === 1)
  );
}

export function isValidCompanyCandidate(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isLocationOrCountryCompanyCandidate(trimmed)) return false;
  if (isCompanyProseCandidate(trimmed)) return false;
  if (!isBrandLikeCompany(trimmed)) return false;
  return true;
}

export function isRejectedCompanyCandidate(line: string): boolean {
  return !isValidCompanyCandidate(line);
}

/** @deprecated use isValidCompanyCandidate */
export function isHardRejectedCompanyCandidate(line: string): boolean {
  return isRejectedCompanyCandidate(line);
}

/** @deprecated use isBrandLikeCompany */
export function looksLikeBrandCompanyName(line: string): boolean {
  return isBrandLikeCompany(line);
}

export function isPostedTimestampLine(line: string): boolean {
  return POSTED_TIMESTAMP_RE.test(line.trim());
}

/** @deprecated use isPostedTimestampLine */
export const isActivityTimestampLine = isPostedTimestampLine;

export function isBodySectionHeaderLine(line: string): boolean {
  return BODY_SECTION_HEADER_RE.test(line.trim());
}

export function isAfterBodySection(lines: string[], index: number): boolean {
  for (let i = 0; i <= index; i++) {
    if (isBodySectionHeaderLine(lines[i] ?? "")) return true;
  }
  return false;
}

export function findBodySectionStartIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (isBodySectionHeaderLine(lines[i]!)) return i;
  }
  return lines.length;
}

export const isInBodySection = isAfterBodySection;

export function parseExplicitCompanyLabel(line: string): string | null {
  const trimmed = line.trim();
  const labeled = trimmed.match(/^(?:company|employer)\s*:\s*(.+)$/i);
  if (labeled?.[1]) {
    const value = labeled[1].trim();
    return isValidCompanyCandidate(value) ? value : null;
  }
  const about = trimmed.match(/^about\s+(.+)$/i);
  if (about?.[1]) {
    const value = about[1].trim();
    return isValidCompanyCandidate(value) ? value : null;
  }
  return null;
}

export function extractCompanyFromPostedHeader(lines: string[]): string | null {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < Math.min(clean.length - 1, 8); i++) {
    const current = clean[i]!;
    const next = clean[i + 1]!;
    if (isJobTitleLikeLine(current)) continue;
    if (isValidCompanyCandidate(current) && isPostedTimestampLine(next)) {
      return current;
    }
  }
  return null;
}

/** @deprecated use extractCompanyFromPostedHeader */
export const extractHeaderCompanyBeforeActivity = extractCompanyFromPostedHeader;

export function extractDuplicateCompanyBeforeEmployeeCount(lines: string[]): string | null {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  for (let i = 2; i < clean.length; i++) {
    const current = clean[i]!;
    const prev = clean[i - 1]!;
    const prevPrev = clean[i - 2]!;
    if (!EMPLOYEE_COUNT_RE.test(current)) continue;
    if (prev !== prevPrev) continue;
    if (!isValidCompanyCandidate(prev)) continue;
    return prev;
  }
  return null;
}

export function extractCompanyFromAboutHeader(lines: string[]): string | null {
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(
      /^About\s+([A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,3})$/i,
    );
    if (!match?.[1]) continue;
    const company = match[1].trim();
    if (isValidCompanyCandidate(company)) return company;
  }
  return null;
}

export function extractCompanyFromSelfDescriptionLines(lines: string[]): string | null {
  for (const line of lines.slice(0, 60)) {
    const trimmed = line.trim();
    const match = trimmed.match(
      /^([A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,3})\s+is\s+(?:a|an|the|building|hiring|looking|seeking)\b/i,
    );
    if (!match?.[1]) continue;
    const company = match[1].trim();
    if (isValidCompanyCandidate(company)) return company;
  }
  return null;
}

export function extractCompanyFromSelfDescription(rawJobText: string): string | null {
  return extractCompanyFromSelfDescriptionLines(normalizeJobLines(rawJobText));
}

export function pickBestCompanyCandidate(candidates: CompanyCandidate[]): CompanyCandidate | null {
  return (
    candidates
      .filter((candidate) => isValidCompanyCandidate(candidate.value))
      .sort((a, b) => b.rank - a.rank || a.value.localeCompare(b.value))[0] ?? null
  );
}

export function collectLabeledFieldCandidates(lines: string[]): CompanyCandidate[] {
  const out: CompanyCandidate[] = [];
  for (const line of lines) {
    const labeled = parseExplicitCompanyLabel(line);
    if (labeled) {
      out.push({ value: labeled, source: "labeled_field", rank: COMPANY_SOURCE_RANK.labeled_field });
    }
  }
  return out;
}

export function collectFallbackScoringCandidates(lines: string[]): CompanyCandidate[] {
  const out: CompanyCandidate[] = [];
  const titleIdx = lines.findIndex((l) =>
    /\b(engineer|developer|software|devops|sre|scientist|architect|analyst|designer|programmer)\b/i.test(l),
  );
  const headerEnd = Math.min(titleIdx >= 0 ? titleIdx : 15, findBodySectionStartIndex(lines), 20);

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i]!;
    if (isAfterBodySection(lines, i) && !parseExplicitCompanyLabel(line)) continue;
    if (isJobTitleLikeLine(line)) continue;
    if (!isValidCompanyCandidate(line)) continue;
    if (i >= headerEnd && i > 12) continue;
    out.push({
      value: line,
      source: "fallback_scoring",
      rank: COMPANY_SOURCE_RANK.fallback_scoring + Math.max(0, 8 - i),
    });
  }
  return out;
}

export function resolveCompanyFromText(
  rawJobText: string,
  options?: {
    companyHint?: string | null;
    llmCompany?: string | null;
    preScoringCompany?: string | null;
  },
): string | null {
  const lines = normalizeJobLines(rawJobText);
  const candidates: CompanyCandidate[] = [];

  const hint = options?.companyHint?.trim();
  if (hint && isValidCompanyCandidate(hint)) {
    candidates.push({ value: hint, source: "user_hint", rank: COMPANY_SOURCE_RANK.user_hint });
  }

  const posted = extractCompanyFromPostedHeader(lines);
  if (posted) {
    candidates.push({ value: posted, source: "posted_header", rank: COMPANY_SOURCE_RANK.posted_header });
  }

  const duplicate = extractDuplicateCompanyBeforeEmployeeCount(lines);
  if (duplicate) {
    candidates.push({
      value: duplicate,
      source: "duplicate_before_employee_count",
      rank: COMPANY_SOURCE_RANK.duplicate_before_employee_count,
    });
  }

  candidates.push(...collectLabeledFieldCandidates(lines));

  const about = extractCompanyFromAboutHeader(lines);
  if (about) {
    candidates.push({ value: about, source: "about_header", rank: COMPANY_SOURCE_RANK.about_header });
  }

  const selfDesc = extractCompanyFromSelfDescriptionLines(lines);
  if (selfDesc) {
    candidates.push({
      value: selfDesc,
      source: "self_description",
      rank: COMPANY_SOURCE_RANK.self_description,
    });
  }

  const preScoring = options?.preScoringCompany?.trim();
  if (preScoring && isValidCompanyCandidate(preScoring)) {
    candidates.push({ value: preScoring, source: "fallback_scoring", rank: 55 });
  }

  const llm = options?.llmCompany?.trim();
  if (llm && isValidCompanyCandidate(llm)) {
    candidates.push({ value: llm, source: "llm", rank: COMPANY_SOURCE_RANK.llm });
  }

  candidates.push(...collectFallbackScoringCandidates(lines));

  return pickBestCompanyCandidate(candidates)?.value ?? null;
}

export function isPlaceholderCompanyName(company: string): boolean {
  const trimmed = company.trim();
  if (!trimmed) return true;
  return /^unknown company$/i.test(trimmed);
}

export function sanitizeCompanyName(
  company: string | null | undefined,
  rawJobText?: string,
  companyHint?: string,
): string | null {
  const trimmed = company?.trim();
  if (trimmed && !isPlaceholderCompanyName(trimmed) && isValidCompanyCandidate(trimmed)) return trimmed;
  if (rawJobText?.trim()) {
    return resolveCompanyFromText(rawJobText, { companyHint, llmCompany: trimmed ?? null });
  }
  const hint = companyHint?.trim();
  if (hint && isValidCompanyCandidate(hint)) return hint;
  return null;
}
