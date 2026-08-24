/**
 * Role title + team/org display helpers.
 * Team is not a separate ExtractedJobData field — it lives in `title`
 * (e.g. "Software Engineer, Reflections") or early JD chrome lines.
 */

const TEAM_SPLIT_RE = /^(.+?)\s*[,—–\-]\s+(.+)$/;

const CORPORATE_SUFFIX_RE =
  /\b(inc\.?|llc|ltd\.?|corp\.?|corporation|company|co\.|technologies|labs?|group|systems|holdings|partners|plc)\b/i;

const KNOWN_EMPLOYER_TOKEN_RE =
  /^(google|meta|amazon|apple|netflix|microsoft|uber|stripe|airbnb|spotify|openai|anthropic|ibm|oracle|salesforce|bloomberg|nyt|the\s+new\s+york\s+times)$/i;

/** True when the right-hand side of "Title, X" looks like a team/org unit, not an employer. */
export function looksLikeTeamQualifier(name: string): boolean {
  const s = name.trim();
  if (!s || s.length > 48) return false;
  if (CORPORATE_SUFFIX_RE.test(s)) return false;
  if (KNOWN_EMPLOYER_TOKEN_RE.test(s)) return false;
  if (/^(united states|united kingdom|remote|hybrid|onsite)$/i.test(s)) return false;
  if (/^[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(s)) return false; // City, ST
  const words = s.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 4;
}

/** Extract team/org qualifier from a role title, if present. */
export function roleTeamQualifier(rawTitle: string): string | null {
  const title = rawTitle.trim();
  if (!title) return null;
  const m = title.match(TEAM_SPLIT_RE);
  if (!m) return null;
  const left = m[1]!.trim();
  const right = m[2]!.trim();
  if (!left || !right) return null;
  if (!looksLikeTeamQualifier(right)) return null;
  // Left should still look like a role noun phrase.
  if (!/\b(engineer|developer|designer|scientist|architect|analyst|manager|lead)\b/i.test(left)) {
    return null;
  }
  return right;
}

/** Normalize "Software Engineer, Reflections" → "Software Engineer — Reflections". */
export function formatRoleTitle(rawTitle: string): string {
  const title = rawTitle.trim();
  if (!title) return title;
  const team = roleTeamQualifier(title);
  if (!team) {
    // Light plural cleanup for role headers.
    const looksLikeRoleHeader =
      /\b(junior|entry[-\s]?level|early[-\s]?career|associate|software|full[-\s]?stack|backend|frontend|product)\b/i.test(
        title,
      ) && /\bengineers\b$/i.test(title);
    return looksLikeRoleHeader ? title.replace(/\bEngineers\b$/, "Engineer") : title;
  }
  const base = title.replace(TEAM_SPLIT_RE, "$1").trim();
  return `${base} — ${team}`;
}

/**
 * Prefer stored title; if team was stripped (e.g. "Software Engineer" only),
 * recover "Software Engineer, Reflections" from early JD lines when present.
 */
export function resolveDisplayTitle(extracted: {
  title?: string | null;
  rawText?: string | null;
}): string {
  const stored = (extracted.title ?? "").trim();
  if (roleTeamQualifier(stored)) return formatRoleTitle(stored);

  const raw = extracted.rawText ?? "";
  if (!raw.trim() || !stored) return formatRoleTitle(stored);

  const baseNorm = stored.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20);

  for (const line of lines) {
    const team = roleTeamQualifier(line);
    if (!team) continue;
    const lineBase = line.replace(TEAM_SPLIT_RE, "$1").trim();
    const lineBaseNorm = lineBase.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    // Recover when stored title matches the base role of a richer chrome line.
    if (
      lineBaseNorm === baseNorm ||
      baseNorm.startsWith(lineBaseNorm) ||
      lineBaseNorm.startsWith(baseNorm)
    ) {
      return formatRoleTitle(line);
    }
  }
  return formatRoleTitle(stored);
}

/** Short team/org label for prose, else the formatted title. */
export function roleReferenceLabel(extracted: {
  title?: string | null;
  rawText?: string | null;
}): string {
  const display = resolveDisplayTitle(extracted);
  const em = display.match(/—\s+(.+)$/);
  if (em?.[1]?.trim()) return em[1].trim();
  const fromStored = roleTeamQualifier(extracted.title ?? "");
  if (fromStored) return fromStored;
  return display || "this listing";
}

/**
 * Replace vague "this role" / "the role" with a team- or title-specific reference
 * so concurrent reqs at the same employer stay distinguishable in Why consider / Key risks.
 */
export function resolveVagueRoleReferences(
  text: string,
  extracted: { title?: string | null; rawText?: string | null },
): string {
  if (!text.trim()) return text;
  const display = resolveDisplayTitle(extracted);
  if (!display) return text;
  const teamMatch = display.match(/—\s+(.+)$/);
  const team = teamMatch?.[1]?.trim();
  const specific = team ? `${team} role` : `${display} role`;

  let t = text;
  t = t.replace(/\b(this) role\b/gi, (_, det: string) => `${det} ${specific}`);
  t = t.replace(/\b(the) role\b/gi, (_, det: string) => `${det} ${specific}`);
  // Avoid doubled "role role"
  t = t.replace(/\brole\s+role\b/gi, "role");
  return t.replace(/\s{2,}/g, " ").trim();
}
