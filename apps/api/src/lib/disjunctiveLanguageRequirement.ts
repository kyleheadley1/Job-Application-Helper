import type { ExtractedJobData } from "../types/job.js";
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
  /\b(at least\s+(?:one|\d+|1)\b|one of|any of|such as|e\.g\.|including|among|from the following|proficiency in at least)\b/i;

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

/** Extract spans that look like disjunctive language requirement lists. */
export const extractDisjunctiveLanguageSpans = (blob: string): string[] => {
  const spans: string[] = [];
  const parenLists = blob.match(
    /(?:at least\s+(?:one|\d+|1)|one of|such as|e\.g\.|including)[^.\n]{0,40}[\(:][^)\]]{5,400}[\)\]]/gi,
  );
  if (parenLists) spans.push(...parenLists);

  for (const line of blob.split("\n")) {
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
  const blob = jobBlob(job);
  const spans = extractDisjunctiveLanguageSpans(blob);

  let bestAccepted: string[] = [];

  for (const span of spans) {
    const langs = languagesInSpan(span);
    const isDisjunctive =
      DISJUNCTIVE_FRAMING.test(span) ||
      langs.length >= 2 ||
      /\b(server[-\s]?side|web technology|web technologies)\b/i.test(span);

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
