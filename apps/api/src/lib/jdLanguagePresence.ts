import type { ExtractedJobData } from "../types/job.js";
import { GO_LANGUAGE_PATTERNS } from "./goLanguage.js";
import { normalizeText } from "./text.js";

/** Canonical language labels aligned with stack-mismatch / hard-rule citations. */
const JD_LANGUAGE_PATTERNS: Array<{ label: string; patterns: RegExp[] }> = [
  { label: "Go", patterns: GO_LANGUAGE_PATTERNS },
  { label: "Java", patterns: [/\bjava\b(?!script)/i] },
  { label: "Python", patterns: [/\bpython\b/i] },
  { label: "PHP", patterns: [/\bphp\b/i, /\blaravel\b/i] },
  { label: "Ruby", patterns: [/\bruby\b/i, /\brails\b/i] },
  { label: "C#/.NET", patterns: [/\bc#\b/i, /\bcsharp\b/i, /\.net\b/i] },
  { label: "C/C++", patterns: [/\bc\+\+\b/i, /\bc\/c\+\+\b/i] },
  { label: "Scala", patterns: [/\bscala\b/i] },
  { label: "OCaml", patterns: [/\bocaml\b/i] },
  { label: "Rust", patterns: [/\brust\b/i] },
  { label: "Kotlin", patterns: [/\bkotlin\b/i] },
  { label: "Swift", patterns: [/\bswift\b/i] },
  { label: "TypeScript", patterns: [/\btype\s*script\b/i, /\btypescript\b/i] },
  { label: "JavaScript", patterns: [/\bjava\s*script\b/i, /\bjavascript\b/i] },
  { label: "Node.js", patterns: [/\bnode(?:\.js)?\b/i] },
  { label: "React", patterns: [/\breact\b/i] },
  { label: "Vue", patterns: [/\bvue(?:\.js)?\b/i] },
  { label: "Angular", patterns: [/\bangular\b/i] },
];

const structuredJdLines = (job: ExtractedJobData): string[] =>
  [
    ...(job.stack ?? []),
    ...(job.requiredSkills ?? []),
    ...(job.preferredSkills ?? []),
    ...(job.requirements ?? []),
    ...(job.responsibilities ?? []),
  ].filter(Boolean);

/**
 * Languages present in the JD. When rawText exists it is authoritative —
 * extracted stack/skills arrays can hallucinate (Fleetio/Bubble Go bug).
 */
export const extractJdLanguageLabels = (job: ExtractedJobData): Set<string> => {
  const labels = new Set<string>();
  const raw = job.rawText?.trim() ?? "";
  const blob = normalizeText(raw || structuredJdLines(job).join("\n"));
  for (const entry of JD_LANGUAGE_PATTERNS) {
    if (entry.patterns.some((re) => re.test(blob))) {
      labels.add(entry.label);
    }
  }
  return labels;
};

/** True when a tech/skill term is literally grounded in JD rawText (when available). */
export const termGroundedInJdRawText = (term: string, job: ExtractedJobData): boolean => {
  const raw = job.rawText?.trim() ?? "";
  if (!raw) return true;
  const norm = term.trim();
  if (!norm) return false;
  // Prefer catalog patterns for known languages.
  for (const entry of JD_LANGUAGE_PATTERNS) {
    if (
      entry.label.toLowerCase() === norm.toLowerCase() ||
      entry.patterns.some((re) => re.test(norm))
    ) {
      return entry.patterns.some((re) => re.test(raw));
    }
  }
  const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escaped}\\b`, "i").test(raw)) return true;
  // Multi-word / punctuation variants (Node.js, CI/CD).
  const compact = norm.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  const rawCompact = raw.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  return compact.length >= 3 && rawCompact.includes(compact);
};

export const normalizeGapLabel = (label: string): string => {
  const t = label.trim();
  if (/^go(lang)?$/i.test(t)) return "Go";
  if (/^c\+\+$|^c\/c\+\+$/i.test(t)) return "C/C++";
  if (/^c#|^csharp|^\.net$/i.test(t)) return "C#/.NET";
  if (/^django\/python$/i.test(t)) return "Python";
  if (/^php\s*\/?\s*laravel$/i.test(t) || /^laravel$/i.test(t)) return "PHP";
  return t;
};

/** Keep only gap/penalty languages that appear in the JD language set (raw-grounded). */
export const filterLanguagesToJdPresence = (
  labels: string[],
  job: ExtractedJobData,
): string[] => {
  const jdSet = extractJdLanguageLabels(job);
  if (jdSet.size === 0) return [];
  return [...new Set(labels.map(normalizeGapLabel))].filter((label) => jdSet.has(label));
};

export const languagePresentInJd = (label: string, job: ExtractedJobData): boolean => {
  const normalized = normalizeGapLabel(label);
  return extractJdLanguageLabels(job).has(normalized);
};

const ASSERTED_MISSING_LANG =
  /\b(missing|lacks?|without|absent from|not in claimable|required core (?:language|stack) gap|core language mismatch)\b[^.\n]{0,80}\b(go(lang)?|java|python|ruby|php|scala|ocaml|rust|kotlin|swift|c\+\+|c#|golang)\b|\b(go(lang)?|java|python|ruby|php|scala|ocaml|rust|kotlin|swift|c\+\+|c#|golang)\b[^.\n]{0,80}\b(missing|lacks?|not in claimable|outside ts\/node)\b/gi;

/**
 * Drop or rewrite risk/penalty lines that assert a missing language absent from the JD.
 * Mixed lists ("Rust, Go") keep only JD-grounded languages.
 */
export const suppressAbsentLanguageClaims = (
  text: string,
  job: ExtractedJobData,
): string => {
  if (!text.trim()) return text;
  const jdSet = extractJdLanguageLabels(job);

  // Rewrite "Required core language/stack gap: A, B — ..." lists.
  const listRewrite = text.replace(
    /(Required core (?:language|stack) gap[:\s(]+)([^—)\n]+)([—)]?)/gi,
    (full, prefix: string, list: string, suffix: string) => {
      const cited = list
        .split(/,\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
      const grounded = cited.filter((l) => jdSet.has(normalizeGapLabel(l)));
      if (cited.length === 0) return full;
      if (grounded.length === 0) return "";
      if (grounded.length === cited.length) return full;
      return `${prefix}${grounded.join(", ")}${suffix.startsWith("—") ? " " : ""}${suffix}`;
    },
  );
  if (!listRewrite.trim()) return "";

  let suppressed = false;
  for (const match of listRewrite.matchAll(ASSERTED_MISSING_LANG)) {
    const rawLang = match[2] ?? match[3] ?? match[4];
    if (!rawLang) continue;
    const label = normalizeGapLabel(rawLang);
    if (!jdSet.has(label)) suppressed = true;
  }
  if (suppressed) {
    // If rewrite already removed absent langs from core-gap lists, don't drop the whole line
    // unless an absent lang still remains.
    const stillAbsent = [...listRewrite.matchAll(ASSERTED_MISSING_LANG)].some((match) => {
      const rawLang = match[2] ?? match[3] ?? match[4];
      if (!rawLang) return false;
      return !jdSet.has(normalizeGapLabel(rawLang));
    });
    if (stillAbsent) return "";
  }

  const parenLangs = listRewrite.match(/\(([^)]+)\)/);
  if (parenLangs) {
    const inner = parenLangs[1] ?? "";
    if (/core (?:language|stack)/i.test(listRewrite) || /language mismatch/i.test(listRewrite)) {
      const cited = inner.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
      const validated = filterLanguagesToJdPresence(cited, job);
      if (cited.length > 0 && validated.length === 0) return "";
      if (validated.length > 0 && validated.length < cited.length) {
        return listRewrite.replace(inner, validated.join(", "));
      }
    }
  }
  return listRewrite;
};
