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

/** Languages present in structured JD fields only (stack/skills/requirements/responsibilities). */
export const extractJdLanguageLabels = (job: ExtractedJobData): Set<string> => {
  const labels = new Set<string>();
  const blob = normalizeText(structuredJdLines(job).join("\n"));
  for (const entry of JD_LANGUAGE_PATTERNS) {
    if (entry.patterns.some((re) => re.test(blob))) {
      labels.add(entry.label);
    }
  }
  return labels;
};

export const normalizeGapLabel = (label: string): string => {
  const t = label.trim();
  if (/^go(lang)?$/i.test(t)) return "Go";
  if (/^c\+\+$|^c\/c\+\+$/i.test(t)) return "C/C++";
  if (/^c#|^csharp|^\.net$/i.test(t)) return "C#/.NET";
  if (/^django\/python$/i.test(t)) return "Python";
  return t;
};

/** Keep only gap/penalty languages that appear in the structured JD language set. */
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

/** Drop risk/penalty lines that assert a missing language absent from the JD. */
export const suppressAbsentLanguageClaims = (
  text: string,
  job: ExtractedJobData,
): string => {
  if (!text.trim()) return text;
  const jdSet = extractJdLanguageLabels(job);
  let suppressed = false;
  for (const match of text.matchAll(ASSERTED_MISSING_LANG)) {
    const rawLang = match[2] ?? match[3] ?? match[4];
    if (!rawLang) continue;
    const label = normalizeGapLabel(rawLang);
    if (!jdSet.has(label)) suppressed = true;
  }
  if (suppressed) return "";
  const parenLangs = text.match(/\(([^)]+)\)/);
  if (parenLangs) {
    const inner = parenLangs[1] ?? "";
    if (/core (?:language|stack)/i.test(text) || /language mismatch/i.test(text)) {
      const cited = inner.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
      const validated = filterLanguagesToJdPresence(cited, job);
      if (cited.length > 0 && validated.length === 0) return "";
    }
  }
  return text;
};
