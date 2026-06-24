import type { ExtractedJobData } from "../types/job.js";
import { evaluateDisjunctiveLanguageRequirement, filterGapsAfterDisjunctiveMatch } from "./disjunctiveLanguageRequirement.js";
import { filterLanguagesToJdPresence } from "./jdLanguagePresence.js";
import { normalizeText } from "./text.js";
import type { ClaimableStack } from "./claimableStack.js";
import { hasClaimableCoverage } from "./claimableStack.js";

export type StackMismatchTier = "none" | "tier1_core_language" | "tier2_adjacent_framework";

export type StackMismatchAnalysis = {
  tier: StackMismatchTier;
  stackMismatch: boolean;
  coreLanguageGap: string[];
  adjacentFrameworkGap: string[];
};

const SOFT_SKILL_FRAMING =
  /\b(preferred|nice to have|a plus|bonus|ideally|optional|plus\b|familiarity with|exposure to)\b/i;

const JS_FRAMEWORK_FLEXIBLE_CLAUSE =
  /\b(other|modern|relevant)\s+(?:modern\s+)?(?:php\s+and\s+)?(?:java\s*script|javascript|js|typescript|ts)[^.\n]{0,80}(?:frameworks?|stacks?)\s+(?:accepted|welcome|considered|ok)\b/i;

type TechToken = {
  id: string;
  label: string;
  family: string;
  kind: "core_language" | "framework";
  claimableId?: string;
  patterns: RegExp[];
};

const TECH_TOKENS: TechToken[] = [
  { id: "php", label: "PHP", family: "php", kind: "core_language", patterns: [/\bphp\b/i, /\blaravel\b/i] },
  { id: "java", label: "Java", family: "java", kind: "core_language", patterns: [/\bjava\b/i] },
  { id: "go", label: "Go", family: "go", kind: "core_language", patterns: [/\bgolang\b/i, /\bgo\b/i] },
  { id: "ruby", label: "Ruby", family: "ruby", kind: "core_language", patterns: [/\bruby\b/i, /\brails\b/i] },
  { id: "csharp", label: "C#/.NET", family: "csharp", kind: "core_language", patterns: [/\bc#\b/i, /\bcsharp\b/i, /\.net\b/i] },
  { id: "cpp", label: "C/C++", family: "cpp", kind: "core_language", patterns: [/\bc\+\+\b/i, /\bc\/c\+\+\b/i] },
  { id: "salesforce", label: "Salesforce/Apex", family: "salesforce", kind: "core_language", patterns: [/\bsalesforce\b/i, /\bapex\b/i] },
  { id: "brightspot", label: "BrightSpot", family: "brightspot", kind: "core_language", patterns: [/\bbrightspot\b/i] },
  { id: "swift", label: "Swift", family: "mobile", kind: "core_language", patterns: [/\bswift\b/i] },
  { id: "kotlin", label: "Kotlin", family: "mobile", kind: "core_language", patterns: [/\bkotlin\b/i] },
  { id: "vue", label: "Vue", family: "javascript", kind: "framework", patterns: [/\bvue(?:\.js)?\b/i] },
  { id: "angular", label: "Angular", family: "javascript", kind: "framework", patterns: [/\bangular\b/i] },
  { id: "typescript", label: "TypeScript", family: "javascript", kind: "framework", claimableId: "typescript", patterns: [/\btype\s*script\b/i] },
  { id: "javascript", label: "JavaScript", family: "javascript", kind: "framework", claimableId: "javascript", patterns: [/\bjava\s*script\b/i] },
  { id: "react", label: "React", family: "javascript", kind: "framework", claimableId: "react", patterns: [/\breact\b/i] },
  { id: "nodejs", label: "Node.js", family: "javascript", kind: "framework", claimableId: "nodejs", patterns: [/\bnode(?:\.js)?\b/i] },
  { id: "python", label: "Python", family: "python", kind: "core_language", claimableId: "python", patterns: [/\bpython\b/i] },
];

const isSoftContext = (context: string): boolean => SOFT_SKILL_FRAMING.test(context);

const matchTokens = (text: string): TechToken[] => {
  const found: TechToken[] = [];
  for (const token of TECH_TOKENS) {
    if (token.patterns.some((re) => re.test(text))) found.push(token);
  }
  return found;
};

const extractRequiredSkillLines = (job: ExtractedJobData): string[] => {
  const lines: string[] = [];
  for (const skill of job.requiredSkills ?? []) {
    if (skill.trim()) lines.push(skill.trim());
  }
  for (const req of job.requirements ?? []) {
    if (req.trim() && !isSoftContext(req)) lines.push(req.trim());
  }
  const requiredBlob = normalizeText([...(job.requiredSkills ?? []), ...(job.requirements ?? [])].join(" "));
  for (const stack of job.stack ?? []) {
    const token = normalizeText(stack);
    if (stack.trim() && requiredBlob.includes(token)) lines.push(stack.trim());
  }
  return [...new Set(lines)];
};

const lineIsRequired = (line: string, job: ExtractedJobData): boolean => {
  const norm = normalizeText(line);
  if (isSoftContext(norm)) return false;
  if ((job.preferredSkills ?? []).some((p) => normalizeText(p) === norm)) return false;
  const raw = job.rawText ?? "";
  const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const softNear = new RegExp(
    `(preferred|nice to have|a plus|bonus|ideally|optional)[^.\\n]{0,120}${escaped}|${escaped}[^.\\n]{0,120}(preferred|nice to have|a plus|bonus|ideally|optional)`,
    "i",
  );
  if (softNear.test(raw) && !/\b(required|must have|minimum)\b/i.test(norm)) return false;
  return true;
};

const isCoreLanguageRequirement = (token: TechToken, line: string, index: number): boolean => {
  const ctx = normalizeText(line);
  if (token.kind !== "core_language") return false;
  if (/\b(must have|required|minimum|proficiency in|experience with|strong)[^.\n]{0,80}\b/i.test(ctx)) return true;
  if (/\bcustom\s+php\b|\bphp\s+full[-\s]?stack\b|\bprimary\s+(backend\s+)?language\b/i.test(ctx)) return true;
  if (index < 2 && token.patterns.some((re) => re.test(ctx))) return true;
  if (/\b(full[-\s]?stack|backend|development)\b/i.test(ctx) && token.patterns.some((re) => re.test(ctx))) return true;
  return false;
};

const isCoreFrameworkRequirement = (token: TechToken, line: string, index: number): boolean => {
  if (token.kind !== "framework") return false;
  const ctx = normalizeText(line);
  if (isSoftContext(ctx)) return false;
  if (/\b(must have|required|proficiency|experience with|strong)\b/i.test(ctx)) return true;
  if (index < 2 && token.patterns.some((re) => re.test(ctx))) return true;
  return token.patterns.some((re) => re.test(ctx)) && !JS_FRAMEWORK_FLEXIBLE_CLAUSE.test(ctx);
};

const candidateCoversFamily = (family: string, claimable: ClaimableStack): boolean => {
  const familyClaimableIds: Record<string, string[]> = {
    javascript: ["typescript", "javascript", "nodejs", "react"],
    python: ["python"],
  };
  const ids = familyClaimableIds[family] ?? [];
  return ids.some((id) => hasClaimableCoverage(claimable, id));
};

const pythonFlexibleWithJsTs = (blob: string): boolean =>
  /\bpython\b/i.test(blob) &&
  /\b(type\s*script|typescript|javascript|node\.?js|js)\b/i.test(blob) &&
  (/\bpython\s+(and\s*\/\s*or|and\/or|or)\s+(java\s*script|typescript|js|node)\b/i.test(blob) ||
    /\b(java\s*script|typescript|js|node)\s+(and\s*\/\s*or|and\/or|or)\s+python\b/i.test(blob) ||
    /\b(either|any)\s+(of\s+)?(python|typescript|javascript)\b/i.test(blob));

/**
 * Two-tier stack mismatch: Tier 1 = missing required core language; Tier 2 = same-family framework gap.
 * Only required skills count — preferred / nice-to-have are ignored for gap detection.
 */
export const analyzeStackMismatch = (
  job: ExtractedJobData,
  claimable: ClaimableStack,
): StackMismatchAnalysis => {
  const requiredLines = extractRequiredSkillLines(job).filter((line) => lineIsRequired(line, job));
  const qualificationBullets = (job.requirements ?? []).filter((r) => !isSoftContext(r)).slice(0, 2);
  const blob = normalizeText(
    [job.title, job.rawText, ...requiredLines, ...(job.requirements ?? [])].join("\n"),
  );
  const jsFrameworkFlexible = JS_FRAMEWORK_FLEXIBLE_CLAUSE.test(blob);
  const pythonFlexible = pythonFlexibleWithJsTs(blob);

  const coreLanguageGaps: string[] = [];
  const adjacentFrameworkGaps: string[] = [];

  const allScanLines = [...qualificationBullets, ...requiredLines];
  for (let i = 0; i < allScanLines.length; i++) {
    const line = allScanLines[i]!;
    const tokens = matchTokens(line);
    for (const token of tokens) {
      if (token.claimableId && hasClaimableCoverage(claimable, token.claimableId)) continue;
      if (token.id === "python" && pythonFlexible) continue;

      if (token.kind === "core_language") {
        if (!isCoreLanguageRequirement(token, line, i)) continue;
        if (jsFrameworkFlexible && token.family === "javascript") continue;
        coreLanguageGaps.push(token.label);
        continue;
      }

      if (token.kind === "framework") {
        if (!isCoreFrameworkRequirement(token, line, i)) continue;
        if (token.claimableId && hasClaimableCoverage(claimable, token.claimableId)) continue;
        if (token.family === "javascript" && candidateCoversFamily("javascript", claimable)) {
          adjacentFrameworkGaps.push(token.label);
        }
      }
    }
  }

  for (const line of qualificationBullets) {
    if (/\bcustom\s+php\b|\bphp\s+full[-\s]?stack\b|\bphp\s+development\b/i.test(line)) {
      if (!coreLanguageGaps.includes("PHP")) coreLanguageGaps.push("PHP");
    }
  }

  const uniqueCore = filterGapsAfterDisjunctiveMatch(
    [...new Set(coreLanguageGaps)],
    evaluateDisjunctiveLanguageRequirement(job, claimable),
  );
  const jdValidatedCore = filterLanguagesToJdPresence(uniqueCore, job);
  const uniqueAdjacent = [...new Set(adjacentFrameworkGaps)].filter(
    (label) => !jdValidatedCore.includes(label),
  );

  if (jdValidatedCore.length > 0) {
    return {
      tier: "tier1_core_language",
      stackMismatch: true,
      coreLanguageGap: jdValidatedCore,
      adjacentFrameworkGap: uniqueAdjacent,
    };
  }

  if (uniqueAdjacent.length > 0) {
    return {
      tier: "tier2_adjacent_framework",
      stackMismatch: false,
      coreLanguageGap: [],
      adjacentFrameworkGap: uniqueAdjacent,
    };
  }

  return {
    tier: "none",
    stackMismatch: false,
    coreLanguageGap: [],
    adjacentFrameworkGap: [],
  };
};
