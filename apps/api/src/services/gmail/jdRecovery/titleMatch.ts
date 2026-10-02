const FILLER = new Set(["a", "an", "the", "of", "for", "to", "in", "at", "with", "on", "and", "or"]);

const SYNONYMS: Record<string, string> = {
  sr: "senior",
  jr: "junior",
  swe: "software engineer",
  sde: "software development engineer",
  se: "software engineer",
  eng: "engineer",
  dev: "developer",
  fullstack: "full stack",
  frontend: "front end",
  backend: "back end",
  ml: "machine learning",
  ai: "ai",
  "1": "i",
  "2": "ii",
  "3": "iii",
};

/** Lowercase words with punctuation removed; used for "does this phrase appear in the email" checks. */
export const normalizeForMatch = (text: string): string =>
  text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const singular = (t: string) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);

/** Title tokens that keep level markers (I/II/Senior) so "Software Engineer I" != "Software Engineer II". */
export const strictTitleTokens = (title: string): string[] => {
  const expanded = normalizeForMatch(title.replace(/-/g, " "))
    .split(" ")
    .map((t) => SYNONYMS[t] ?? t)
    .join(" ");
  return [...new Set(expanded.split(" ").filter((t) => t && !FILLER.has(t)).map(singular))];
};

export const normalizeTitle = (title: string): string => [...strictTitleTokens(title)].sort().join(" ");

/**
 * Overlap measured against the longer title, so "Software Engineer" does not match
 * "Software Engineer, Data Platform" the way containment-style similarity does.
 */
export const strictTitleSimilarity = (a: string, b: string): number => {
  const ta = new Set(strictTitleTokens(a));
  const tb = new Set(strictTitleTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.max(ta.size, tb.size);
};

const MIN_PHRASE_WORDS = 2;

/** Whole-phrase check against text already passed through normalizeForMatch. */
export const phraseInText = (phrase: string, normalizedText: string): boolean => {
  const p = normalizeForMatch(phrase.replace(/-/g, " "));
  if (p.split(" ").length < MIN_PHRASE_WORDS && p.length < 4) return false;
  return ` ${normalizedText} `.includes(` ${p} `);
};

export const titleInText = (title: string, normalizedText: string): boolean =>
  normalizeForMatch(title).split(" ").length >= MIN_PHRASE_WORDS && phraseInText(title, normalizedText);

/** City part of "San Francisco, CA" / "Remote - US" style locations, when specific enough to search for. */
export const locationInText = (location: string, normalizedText: string): boolean => {
  const city = location.split(/[,;/|(]| - /)[0]?.trim() ?? "";
  if (city.length < 4 || /^(remote|hybrid|onsite|united states|usa|us)$/i.test(city)) return false;
  return phraseInText(city, normalizedText);
};

const SHINGLE = 3;
const SIMILARITY_CHARS = 6000;

const shingles = (text: string): Set<string> => {
  const words = normalizeForMatch(text.slice(0, SIMILARITY_CHARS)).split(" ");
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= words.length; i += 1) out.add(words.slice(i, i + SHINGLE).join(" "));
  return out;
};

/** Jaccard over 3-word shingles; ~1 for the same JD reposted per location. */
export const textSimilarity = (a: string, b: string): number => {
  const sa = shingles(a);
  const sb = shingles(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const s of sa) if (sb.has(s)) shared += 1;
  return shared / (sa.size + sb.size - shared);
};
