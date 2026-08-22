import type { ExtractedJobData } from "../types/job.js";
import type { HardRuleFlag, RuleEvaluation } from "../types/scoring.js";
import {
  extractJdLanguageLabels,
  filterLanguagesToJdPresence,
  languagePresentInJd,
  normalizeGapLabel,
} from "./jdLanguagePresence.js";
import { riskContradictsSatisfiedDisjunctiveRequirement } from "./disjunctiveLanguageRequirement.js";

export { normalizeGapLabel };

export const explicitCoreLanguageToLabel = (
  lang: string | null | undefined,
): string | undefined => {
  if (!lang) return undefined;
  const t = lang.toLowerCase();
  if (t === "go") return "Go";
  if (t === "java") return "Java";
  if (t === "python") return "Python";
  return undefined;
};

/** JD-grounded language gaps from rules only — the sole source for clamp-layer citations. */
export const jdGroundedCoreLanguageGaps = (
  rules: RuleEvaluation,
  job: ExtractedJobData,
): string[] => {
  const candidates: string[] = [...(rules.coreLanguageGap ?? [])];
  if (rules.explicitCoreLanguageMismatch && rules.explicitCoreLanguage) {
    const label = explicitCoreLanguageToLabel(rules.explicitCoreLanguage);
    if (label) candidates.push(label);
  }
  return filterLanguagesToJdPresence(candidates, job);
};

export const coreLanguageMismatchMessage = (langs: string[]): string =>
  `Core language mismatch — role backend (${langs.join(", ")}) is outside TS/Node claimable lane.`;

const allCitedLanguagesPresent = (
  citedLanguages: string[],
  job: ExtractedJobData,
): boolean => {
  if (citedLanguages.length === 0) return false;
  const jdSet = extractJdLanguageLabels(job);
  return citedLanguages.every((l) => jdSet.has(normalizeGapLabel(l)));
};

/** Drop or trim hard-rule flags whose citedLanguages are absent from the JD. */
export const filterHardRuleFlagAtBoundary = (
  flag: HardRuleFlag,
  job: ExtractedJobData,
): HardRuleFlag | null => {
  if (flag.id === "coreLanguageMismatch") {
    const cited = flag.citedLanguages ?? [];
    if (!allCitedLanguagesPresent(cited, job)) return null;
    return flag;
  }
  if (flag.citedLanguages?.length) {
    if (!allCitedLanguagesPresent(flag.citedLanguages, job)) return null;
  }
  return flag;
};

const extractCitedLanguagesFromNote = (note: string): string[] => {
  const mismatchMatch = note.match(
    /Core language mismatch — role backend \(([^)]+)\)/i,
  );
  if (mismatchMatch?.[1]) {
    return mismatchMatch[1]
      .split(/,\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const colonMatch = note.match(/Required core language gap:\s*([^—]+)/i);
  if (colonMatch?.[1]) {
    return colonMatch[1]
      .split(/,\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const parenMatch = note.match(/Required core stack gap\s*\(([^)]+)\)/i);
  if (parenMatch?.[1]) {
    return parenMatch[1]
      .split(/,\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const explicitMatch = note.match(
    /Explicit (Go|Java|Python) backend requirement/i,
  );
  if (explicitMatch?.[1]) return [explicitMatch[1]];
  return [];
};

/** Drop notes that cite missing languages absent from the structured JD. */
export const filterLanguageNoteAtBoundary = (
  note: string,
  job: ExtractedJobData,
  rules?: Pick<
    RuleEvaluation,
    "disjunctiveLanguageRequirementSatisfied" | "disjunctiveAcceptedLanguages"
  >,
): string | null => {
  if (rules && riskContradictsSatisfiedDisjunctiveRequirement(note, rules)) return null;
  const cited = extractCitedLanguagesFromNote(note);
  if (cited.length === 0) return note;
  if (cited.some((l) => !languagePresentInJd(l, job))) return null;
  return note;
};

/**
 * Final output boundary: validate every language-citing penalty/risk against the
 * current JD structured language set. Runs after rules, clamp, and all emitters.
 */
export const applyJdLanguageOutputBoundary = (
  job: ExtractedJobData,
  rules: RuleEvaluation,
): RuleEvaluation => {
  const coreLanguageGap = filterLanguagesToJdPresence(rules.coreLanguageGap ?? [], job);

  const hardRuleFlags = (rules.hardRuleFlags ?? [])
    .map((flag) => filterHardRuleFlagAtBoundary(flag, job))
    .filter((flag): flag is HardRuleFlag => flag != null);

  const notes = (rules.notes ?? [])
    .map((note) => filterLanguageNoteAtBoundary(note, job, rules))
    .filter((note): note is string => note != null);

  const hardRuleNotes = (rules.hardRuleNotes ?? [])
    .map((note) => filterLanguageNoteAtBoundary(note, job, rules))
    .filter((note): note is string => note != null);

  const stackMismatch =
    Boolean(rules.stackMismatch) &&
    (coreLanguageGap.length > 0 || Boolean(rules.explicitCoreLanguageMismatch));

  return {
    ...rules,
    coreLanguageGap,
    stackMismatch,
    hardRuleFlags,
    notes,
    hardRuleNotes,
  };
};

/** Test helper: true if any output surface cites a language absent from the JD. */
export const outputCitesAbsentLanguage = (
  job: ExtractedJobData,
  rules: RuleEvaluation,
): boolean => {
  const jdSet = extractJdLanguageLabels(job);
  const absent = (label: string) => !jdSet.has(normalizeGapLabel(label));

  for (const flag of rules.hardRuleFlags ?? []) {
    for (const lang of flag.citedLanguages ?? []) {
      if (absent(lang)) return true;
    }
    if (
      flag.id === "coreLanguageMismatch" &&
      /\(([^)]+)\)/.test(flag.message)
    ) {
      const inner = flag.message.match(/\(([^)]+)\)/)?.[1] ?? "";
      for (const lang of inner.split(/,\s*/)) {
        if (lang.trim() && absent(lang.trim())) return true;
      }
    }
  }

  for (const note of [...(rules.notes ?? []), ...(rules.hardRuleNotes ?? [])]) {
    for (const lang of extractCitedLanguagesFromNote(note)) {
      if (absent(lang)) return true;
    }
  }

  return false;
};
