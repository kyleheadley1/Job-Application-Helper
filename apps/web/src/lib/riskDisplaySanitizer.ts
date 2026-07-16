/**
 * Client fallback for legacy cached jobs: strip evaluator shorthand / cross-company phrasing.
 * Tech/token grounding runs server-side in `apps/api` — avoid JD-only stripping here (would drop valid candidate-stack mentions).
 */

const COMPANY_LABEL_FALLBACK = "This employer";

export function stripEvaluatorJargon(text: string, company?: string): string {
  const label = company?.trim() || COMPANY_LABEL_FALLBACK;
  let t = text;

  t = t.replace(
    /Plaid-like\s+mature\s+fintech\/API\s+infrastructure\s+employers\s+may\s+screen\s+hard\s+for\s+([^.]+)\.?\s*/gi,
    `${label} may still screen for production-quality engineering experience, backend fundamentals, and reliability expectations. `,
  );
  t = t.replace(
    /mature\s+fintech\/API\s+infrastructure\s+employers\s+may\s+screen\s+hard\s+for\s+([^.]+)\.?\s*/gi,
    `${label} may still screen for $1. `,
  );
  t = t.replace(/\bPlaid-like\b[^.]{0,180}\./gi, `${label} may still screen for backend depth and production fundamentals.`);
  t = t.replace(/\bSpotify-style\b/gi, "this team's");
  t = t.replace(/\bDefense\s+Unicorns\s+pattern\b/gi, "defense-industry software hiring patterns");
  t = t.replace(/\bmature\s+fintech\/API\s+infrastructure\b/gi, "payment- and API-heavy product engineering");

  return t.replace(/\s{2,}/g, " ").trim();
}

export function cleanupVisibleLineFragments(text: string): string {
  let t = text
    .replace(/\(\s*\)/g, "")
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/,\s*$/g, "")
    .replace(/\s+([,.])/g, "$1")
    .replace(/\bwith\s+and\b/gi, "with")
    .replace(/\band\s+and\b/gi, "and")
    .replace(/\s{2,}/g, " ")
    .trim();
  t = t.replace(/^[,;]\s*/, "").replace(/,\s*$/, "").trim();
  return t;
}

export function sanitizeRoleCardLine(text: string, companyName: string): string {
  let cleaned = cleanupVisibleLineFragments(stripEvaluatorJargon(text, companyName));
  // Strip ungrounded retail-payments boilerplate left on cached jobs.
  cleaned = cleaned.replace(/\s*or\s+co[-\s]?branded\s+cards?\s*/gi, " ");
  cleaned = cleaned.replace(/\bco[-\s]?branded\s+cards?\b/gi, "payments domain");
  cleaned = cleaned.replace(
    /\bteam may still screen for backend\/cloud\/database production depth despite the associate level\b[^.]*\.?/gi,
    "JD seniority may exceed the early-career profile for recruiter screen.",
  );
  cleaned = cleaned.replace(
    /;\s*hiring rubrics often emphasize production reliability, backend fundamentals, and operational maturity\.?/gi,
    " — screeners may probe production reliability and backend fundamentals for this listing.",
  );
  // Do not rewrite seniority overreach into a shared "associate level" template —
  // that produced identical Key Risks across unrelated results.
  return cleanupVisibleLineFragments(cleaned);
}
