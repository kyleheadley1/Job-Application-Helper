import type { ExtractedJobData } from "../types/job.js";
import type { RuleEvaluation } from "../types/scoring.js";
import type { ClaimableStack } from "./claimableStack.js";
import { hasClaimableCoverage } from "./claimableStack.js";
import { GO_LANGUAGE_PATTERNS } from "./goLanguage.js";
import { normalizeText } from "./text.js";

/** Languages that may appear in JD disjunctive "at least one of" lists. */
const DISJUNCTIVE_LANGUAGE_CATALOG: Array<{
  id: string;
  label: string;
  claimableIds: string[];
  patterns: RegExp[];
}> = [
  {
    id: "nodejs",
    label: "Node.js",
    claimableIds: ["nodejs", "typescript", "javascript"],
    patterns: [/\bnode(?:\.js)?\b/i],
  },
  {
    id: "javascript",
    label: "JavaScript",
    claimableIds: ["javascript", "typescript", "nodejs"],
    patterns: [/\bjava\s*script\b/i, /\bjs\b/i],
  },
  {
    id: "typescript",
    label: "TypeScript",
    claimableIds: ["typescript", "javascript", "nodejs"],
    patterns: [/\btype\s*script\b/i, /\bts\b/i],
  },
  {
    id: "react",
    label: "React",
    claimableIds: ["react", "typescript", "javascript"],
    patterns: [/\breact(?:\.js)?\b/i],
  },
  {
    id: "vue",
    label: "Vue",
    claimableIds: ["vue", "react", "typescript", "javascript"],
    patterns: [/\bvue(?:\.js)?\b/i, /\bnuxt\b/i],
  },
  {
    id: "rails",
    label: "Ruby on Rails",
    claimableIds: ["ruby"],
    patterns: [/\bruby\s+on\s+rails\b/i, /\brails\b/i],
  },
  {
    id: "python",
    label: "Python",
    claimableIds: ["python"],
    patterns: [/\bpython\b/i],
  },
  {
    id: "java",
    label: "Java",
    claimableIds: ["java"],
    patterns: [/\bjava\b(?!script)/i, /\bjvm\b/i],
  },
  {
    id: "scala",
    label: "Scala",
    claimableIds: ["scala"],
    patterns: [/\bscala\b/i],
  },
  {
    id: "go",
    label: "Go",
    claimableIds: ["go"],
    patterns: GO_LANGUAGE_PATTERNS,
  },
  {
    id: "csharp",
    label: "C#",
    claimableIds: ["csharp"],
    patterns: [/\bc#\b/i, /\bcsharp\b/i, /\.net\b/i],
  },
  {
    id: "cpp",
    label: "C++",
    claimableIds: ["cpp"],
    patterns: [/\bc\+\+\b/i, /\bc\/c\+\+\b/i],
  },
  {
    id: "ruby",
    label: "Ruby",
    claimableIds: ["ruby"],
    patterns: [/\bruby\b/i, /\brails\b/i],
  },
  {
    id: "php",
    label: "PHP",
    claimableIds: ["php"],
    patterns: [/\bphp\b/i],
  },
];

const DISJUNCTIVE_FRAMING =
  /\b(and\s*\/\s*or|,\s*or\b|at least\s+(?:one|\d+|1)\b|one of|any of|one or more of|such as|e\.g\.|including|among|from the following|proficiency in at least|experience with any of|familiarity with one or more of)\b/i;

const EXCLUSIVE_REQUIREMENT =
  /\b(must have|required|professional experience with|strong proficiency in|primary language is|our (?:main|primary) (?:backend )?language)\b/i;

export type DisjunctiveLanguageEval = {
  /** JD lists acceptable languages disjunctively and candidate matches ≥1 in the full set. */
  satisfied: boolean;
  /** All languages detected in the disjunctive accepted set (never a subset). */
  acceptedLabels: string[];
};

const jobBlob = (job: ExtractedJobData): string =>
  normalizeText(
    [
      job.title,
      job.rawText ?? "",
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
      ...(job.stack ?? []),
      ...(job.requiredSkills ?? []),
    ].join("\n"),
  );

const requirementLinesForDisjunctive = (job: ExtractedJobData): string[] => {
  const lines: string[] = [];
  for (const req of job.requirements ?? []) {
    const t = req.trim();
    if (t) lines.push(t);
  }
  for (const skill of job.requiredSkills ?? []) {
    const t = skill.trim();
    if (t && !lines.includes(t)) lines.push(t);
  }
  for (const line of (job.rawText ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (t && DISJUNCTIVE_FRAMING.test(t) && !lines.some((l) => l === t)) {
      lines.push(t);
    }
  }
  return lines;
};

/** Extract spans that look like disjunctive language requirement lists. */
export const extractDisjunctiveLanguageSpans = (blob: string): string[] => {
  const spans: string[] = [];
  const parenLists = blob.match(
    /(?:at least\s+(?:one|\d+|1)|one of|such as|e\.g\.|including)[^.\n]{0,40}[\(:][^)\]]{5,400}[\)\]]/gi,
  );
  if (parenLists) spans.push(...parenLists);

  for (const line of blob.split(/\n/)) {
    if (DISJUNCTIVE_FRAMING.test(line)) spans.push(line);
  }

  const serverSideWindows = blob.match(
    /(?:server[-\s]?side|backend|web)\s+(?:web\s+)?(?:technology|technologies|language|languages)[^.]{0,350}/gi,
  );
  if (serverSideWindows) spans.push(...serverSideWindows);

  return [...new Set(spans.map((s) => s.trim()).filter(Boolean))];
};

const languagesInSpan = (span: string): typeof DISJUNCTIVE_LANGUAGE_CATALOG => {
  const found: typeof DISJUNCTIVE_LANGUAGE_CATALOG = [];
  for (const lang of DISJUNCTIVE_LANGUAGE_CATALOG) {
    if (lang.patterns.some((re) => re.test(span)) && !found.some((f) => f.id === lang.id)) {
      found.push(lang);
    }
  }
  return found;
};

const candidateCoversLanguage = (lang: (typeof DISJUNCTIVE_LANGUAGE_CATALOG)[number], claimable: ClaimableStack): boolean =>
  lang.claimableIds.some((id) => hasClaimableCoverage(claimable, id));

/**
 * True when the JD accepts any of a listed language set and the candidate claimable stack
 * includes at least one member of that full set.
 */
export const evaluateDisjunctiveLanguageRequirement = (
  job: ExtractedJobData,
  claimable: ClaimableStack,
): DisjunctiveLanguageEval => {
  const spans = requirementLinesForDisjunctive(job);

  let bestAccepted: string[] = [];

  for (const span of spans) {
    const langs = languagesInSpan(span);
    const isDisjunctive =
      DISJUNCTIVE_FRAMING.test(span) ||
      (/\bor\b/i.test(span) && langs.length >= 2);

    if (!isDisjunctive || langs.length < 2) continue;

    const labels = langs.map((l) => l.label);
    const candidateMatches = langs.some((l) => candidateCoversLanguage(l, claimable));

    if (candidateMatches && labels.length > bestAccepted.length) {
      bestAccepted = labels;
    }
  }

  if (bestAccepted.length >= 2) {
    const matched = DISJUNCTIVE_LANGUAGE_CATALOG.filter(
      (l) => bestAccepted.includes(l.label) && candidateCoversLanguage(l, claimable),
    );
    return {
      satisfied: matched.length > 0,
      acceptedLabels: bestAccepted,
    };
  }

  return { satisfied: false, acceptedLabels: [] };
};

/** Exclusive single-language requirement with no acceptable alternatives in the same clause. */
export const isExclusiveCoreLanguageRequirement = (blob: string, languageLabel: string): boolean => {
  const lines = blob.split("\n").filter((l) => new RegExp(`\\b${languageLabel}\\b`, "i").test(l));
  for (const line of lines) {
    const langsInLine = languagesInSpan(line);
    const hasDisjunctive = DISJUNCTIVE_FRAMING.test(line) || langsInLine.length >= 2;
    if (EXCLUSIVE_REQUIREMENT.test(line) && !hasDisjunctive) return true;
  }
  return EXCLUSIVE_REQUIREMENT.test(blob) && !DISJUNCTIVE_FRAMING.test(blob) && languagesInSpan(blob).length <= 1;
};


/** True when a requirement line uses and/or (or similar) and candidate matches ≥1 listed stack item. */
export const lineDisjunctiveRequirementSatisfied = (
  line: string,
  claimable: ClaimableStack,
): boolean => {
  if (!DISJUNCTIVE_FRAMING.test(line)) return false;
  const langs = languagesInSpan(line);
  if (langs.length < 2) return false;
  return langs.some((l) => candidateCoversLanguage(l, claimable));
};

/** Remove stack gaps that only arise from a satisfied disjunctive accepted set. */
export const filterGapsAfterDisjunctiveMatch = (
  coreLanguageGap: string[],
  disjunctive: DisjunctiveLanguageEval,
): string[] => {
  if (!disjunctive.satisfied || disjunctive.acceptedLabels.length === 0) return coreLanguageGap;
  const accepted = new Set(disjunctive.acceptedLabels.map((l) => l.toLowerCase()));
  return coreLanguageGap.filter((g) => !accepted.has(g.toLowerCase()));
};

/** Out-of-lane language labels that appear only in a satisfied disjunctive set should not flag. */
export const filterOutOfLaneAfterDisjunctiveMatch = (
  labels: string[],
  disjunctive: DisjunctiveLanguageEval,
): string[] => {
  if (!disjunctive.satisfied) return labels;
  const accepted = new Set(disjunctive.acceptedLabels.map((l) => l.toLowerCase()));
  return labels.filter((l) => !accepted.has(l.toLowerCase()));
};

const DISJUNCTIVE_GAP_FRAMING =
  /\b(no|without|lacks?|missing|not demonstrated|not listed|not in|unmet|gap|required core language|primary accepted|lists .{0,48} as (?:a )?(?:primary|required|common|accepted)|outside (?:the|your|claimable)|mismatch|weak(?:ness)?|limited|absent)\b/i;

const DISJUNCTIVE_POSITIVE_FRAMING =
  /\b(strong|solid|good|clear|align|match|overlap|proficiency in|demonstrated strength)\b/i;

const labelPatternsForRisk = (label: string): RegExp[] => {
  const entry = DISJUNCTIVE_LANGUAGE_CATALOG.find((l) => l.label === label);
  if (entry) return entry.patterns;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [new RegExp(`\\b${escaped}\\b`, "i")];
};

/**
 * True when prose treats a language from a satisfied disjunctive set as an unmet gap.
 * Used to keep Key Risks aligned with stack-fit resolution (and/or = any-one satisfied).
 */
export const riskContradictsSatisfiedDisjunctiveRequirement = (
  line: string,
  rules: Pick<
    RuleEvaluation,
    "disjunctiveLanguageRequirementSatisfied" | "disjunctiveAcceptedLanguages"
  >,
): boolean => {
  if (!rules.disjunctiveLanguageRequirementSatisfied) return false;
  const accepted = rules.disjunctiveAcceptedLanguages ?? [];
  if (accepted.length < 2) return false;

  const t = line.trim();
  if (!t) return false;

  const mentionsAccepted = accepted.some((label) =>
    labelPatternsForRisk(label).some((re) => re.test(t)),
  );
  if (!mentionsAccepted) return false;

  if (DISJUNCTIVE_POSITIVE_FRAMING.test(t) && !DISJUNCTIVE_GAP_FRAMING.test(t)) {
    return false;
  }

  return DISJUNCTIVE_GAP_FRAMING.test(t);
};

/** Drop risk/note lines that contradict a satisfied disjunctive language requirement. */
export const filterDisjunctiveContradictingRiskLines = (
  lines: string[],
  rules: Pick<
    RuleEvaluation,
    "disjunctiveLanguageRequirementSatisfied" | "disjunctiveAcceptedLanguages"
  >,
): string[] =>
  lines.filter((line) => !riskContradictsSatisfiedDisjunctiveRequirement(line, rules));
