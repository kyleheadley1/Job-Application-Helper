import type { ExtractedJobData } from "../types/job.js";
import { normalizeText } from "./text.js";

export type LanguageRequirementStrength = "hard" | "soft" | "neutral";

const FUNDAMENTALS_OVER_LANGUAGE_RE =
  /\b(?:we\s+)?(?:value|weight|prioritize|emphasize|care\s+(?:more\s+)?about)\b[^.\n]{0,100}\b(?:engineering\s+)?fundamentals?\b[^.\n]{0,120}\b(?:and\s+)?(?:learning speed|learning velocity|learn(?:ing)? quickly|ramp(?:ing)? quickly|problem[-\s]?solving)\b[^.\n]{0,80}\b(?:over|than|more than|beyond)\b[^.\n]{0,60}\b(?:expertise in\s+)?(?:any\s+)?(?:specific\s+)?(?:programming\s+)?language|\b(?:fundamentals?|learning speed|learning velocity)\b[^.\n]{0,60}\bover\b[^.\n]{0,40}\b(?:expertise in\s+)?(?:any\s+)?(?:specific\s+)?(?:programming\s+)?language|\blanguage[-\s]agnostic\b|\bnot\s+tied\s+to\s+(?:a\s+)?specific\s+language|\bany\s+modern\s+(?:programming\s+)?language\b|\b(?:strong\s+)?coding\s+skills?\s+in\s+any\s+(?:programming\s+)?language\b|\bany\s+programming\s+language\b/i;

const SOFT_NEAR_LANGUAGE_RE =
  /\b(?:is\s+)?(?:a\s+)?plus\b|\bnice\s+to\s+have\b|\bpreferred\b|\bbonus\b|\bideally\b|\boptional\b|\bhelpful\b|\bwould\s+be\s+(?:great|nice)\b|\bfamiliarity\s+with\b|\bexposure\s+to\b|\bincluding\s+but\s+not\s+limited\s+to\b/i;

const HARD_LANGUAGE_PATTERNS: Record<"python" | "django" | "flask", RegExp[]> = {
  python: [
    /\b(?:strong|solid|deep|extensive)\s+[^.\n]{0,50}\bpython\b/i,
    /\bpython\b[^.\n]{0,50}\b(?:required|must|mandatory)\b/i,
    /\b(?:must have|required)[^.\n]{0,60}\bpython\b/i,
    /\bpython\s+(?:engineer|developer|backend)\b[^.\n]{0,30}\brequired\b/i,
    /\bprimary\s+(?:backend\s+)?language[^.\n]{0,30}\bpython\b/i,
    /\bpython\b[^.\n]{0,40}\bproduction\s+experience\s+required\b/i,
    /\bpython\s+leads?\s+the\s+backend\b/i,
  ],
  django: [
    /\b(?:strong|solid|deep|extensive)\s+[^.\n]{0,40}\bdjango\b/i,
    /\bdjango\b[^.\n]{0,40}\b(?:required|must|mandatory)\b/i,
    /\b(?:must have|required)[^.\n]{0,60}\bdjango\b/i,
  ],
  flask: [
    /\b(?:strong|solid|deep|extensive)\s+[^.\n]{0,40}\bflask\b/i,
    /\bflask\b[^.\n]{0,40}\b(?:required|must|mandatory)\b/i,
    /\b(?:must have|required)[^.\n]{0,60}\bflask\b/i,
  ],
};

const pillarLanguageKey = (pillar?: string): "python" | "django" | "flask" => {
  const p = (pillar ?? "").toLowerCase();
  if (p.includes("django")) return "django";
  if (p.includes("flask")) return "flask";
  return "python";
};

const pillarLanguageNeedle = (pillar?: string): RegExp => {
  const key = pillarLanguageKey(pillar);
  if (key === "django") return /\bdjango\b/i;
  if (key === "flask") return /\bflask\b/i;
  return /\bpython\b/i;
};

const jobBlob = (job: ExtractedJobData): string =>
  normalizeText(
    [
      job.title,
      ...(job.stack ?? []),
      ...(job.requiredSkills ?? []),
      ...(job.preferredSkills ?? []),
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
      job.rawText ?? "",
    ].join("\n"),
  );

const hardRequiredBlob = (job: ExtractedJobData): string =>
  normalizeText([...(job.requiredSkills ?? []), ...(job.requirements ?? [])].join("\n"));

const windowAround = (blob: string, needle: RegExp, radius = 110): string => {
  const m = blob.match(needle);
  if (!m || m.index === undefined) return "";
  const i = m.index;
  return blob.slice(Math.max(0, i - radius), Math.min(blob.length, i + (m[0]?.length ?? 0) + radius));
};

const languageOnlyInPreferred = (job: ExtractedJobData, needle: RegExp): boolean => {
  const pref = normalizeText([...(job.preferredSkills ?? [])].join(" "));
  const req = hardRequiredBlob(job);
  const title = normalizeText(job.title ?? "");
  return needle.test(pref) && !needle.test(req) && !needle.test(title);
};

const jobProseBlob = (job: ExtractedJobData): string =>
  normalizeText(
    [job.title ?? "", ...(job.requirements ?? []), ...(job.responsibilities ?? [])].join("\n"),
  );

/**
 * Classify how strongly a backend language pillar is required vs merely preferred.
 * Hard = explicit production/required language; soft = plus/preferred/fundamentals-over-language.
 * Soft / fundamentals phrasing is judged from Requirements/Responsibilities prose — not skill-tag order.
 */
export const analyzeLanguageRequirementStrength = (
  job: ExtractedJobData,
  pillar?: string,
): LanguageRequirementStrength => {
  const blob = jobBlob(job);
  const prose = jobProseBlob(job);
  const needle = pillarLanguageNeedle(pillar);
  if (!needle.test(blob) && !needle.test(prose)) {
    // Soft language-agnostic Requirements copy can still classify the JD even when the
    // language only appears in the skill-tag cloud.
    if (FUNDAMENTALS_OVER_LANGUAGE_RE.test(prose)) return "soft";
    return "neutral";
  }

  const langKey = pillarLanguageKey(pillar);
  if (HARD_LANGUAGE_PATTERNS[langKey].some((re) => re.test(prose) || re.test(blob))) return "hard";

  if (languageOnlyInPreferred(job, needle)) return "soft";

  if (FUNDAMENTALS_OVER_LANGUAGE_RE.test(prose) || FUNDAMENTALS_OVER_LANGUAGE_RE.test(blob)) {
    return "soft";
  }

  const ctx = windowAround(prose, needle) || windowAround(blob, needle);
  if (ctx && SOFT_NEAR_LANGUAGE_RE.test(ctx) && !/\b(?:must|required|minimum)\b/i.test(ctx)) {
    return "soft";
  }

  const stackBlob = normalizeText((job.stack ?? []).join(" "));
  const reqBlob = hardRequiredBlob(job);
  if (needle.test(stackBlob) && !needle.test(reqBlob) && !needle.test(job.title ?? "")) {
    if (FUNDAMENTALS_OVER_LANGUAGE_RE.test(prose) || SOFT_NEAR_LANGUAGE_RE.test(blob)) {
      return "soft";
    }
  }

  // Language only in skill-tag cloud with language-agnostic Requirements → soft.
  if (
    FUNDAMENTALS_OVER_LANGUAGE_RE.test(prose) ||
    (/\bany\s+programming\s+language\b/i.test(prose) &&
      !needle.test(prose) &&
      needle.test(normalizeText([...(job.stack ?? []), ...(job.requiredSkills ?? [])].join("\n"))))
  ) {
    return "soft";
  }

  return "neutral";
};

export const jobWeightsFundamentalsOverLanguage = (job: ExtractedJobData): boolean =>
  FUNDAMENTALS_OVER_LANGUAGE_RE.test(jobBlob(job));
