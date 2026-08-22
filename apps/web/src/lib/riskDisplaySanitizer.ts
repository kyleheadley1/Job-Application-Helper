/**
 * Client fallback for legacy cached jobs: strip evaluator shorthand / cross-company phrasing.
 * Tech/token grounding also runs server-side, but we keep a client-side guard for stale cached jobs.
 */
import type { ExtractedJobData } from "../types/job";

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

const TECH_PATTERNS: Array<{ canon: string; re: RegExp }> = [
  { canon: "go", re: /\bGolang\b|\bGo\b/gi },
  { canon: "rails", re: /\bRuby on Rails\b|\bRails\b/gi },
  { canon: "react", re: /\bReact(?:\.js)?\b/gi },
  { canon: "typescript", re: /\bTypeScript\b/gi },
  { canon: "javascript", re: /\bJavaScript\b/gi },
  { canon: "python", re: /\bPython\b/gi },
  { canon: "nodejs", re: /\bNode(?:\.js)?\b/gi },
  { canon: "postgresql", re: /\bPostgres(?:ql)?\b/gi },
  { canon: "graphql", re: /\bGraphQL\b/gi },
  { canon: "docker", re: /\bDocker\b/gi },
  { canon: "kubernetes", re: /\bKubernetes\b|\bK8s\b/gi },
  { canon: "aws", re: /\bAWS\b/gi },
  { canon: "gcp", re: /\bGCP\b/gi },
  { canon: "azure", re: /\bAzure\b/gi },
];

const normalizeTechBlob = (extracted?: ExtractedJobData): string =>
  (extracted?.rawText ?? "").toLowerCase();

const buildAllowedTech = (extracted?: ExtractedJobData): Set<string> => {
  const allowed = new Set<string>();
  const blob = normalizeTechBlob(extracted);
  for (const { canon, re } of TECH_PATTERNS) {
    if (re.test(blob)) allowed.add(canon);
  }
  for (const tag of extracted?.skillTags ?? []) {
    allowed.add(tag.term.toLowerCase());
  }
  return allowed;
};

const stripUngroundedTech = (line: string, extracted?: ExtractedJobData): string => {
  if (!extracted?.rawText?.trim()) return line;
  const allowed = buildAllowedTech(extracted);
  let out = line;
  for (const { canon, re } of TECH_PATTERNS) {
    if (allowed.has(canon)) continue;
    out = out.replace(re, "");
  }
  return cleanupVisibleLineFragments(out);
};

const DISJUNCTIVE_GAP_FRAMING =
  /\b(no|without|lacks?|missing|not demonstrated|not listed|not in|unmet|gap|required core language|primary accepted|lists .{0,48} as (?:a )?(?:primary|required|common|accepted)|outside (?:the|your|claimable)|mismatch|weak(?:ness)?|limited|absent)\b/i;

const DISJUNCTIVE_POSITIVE_FRAMING =
  /\b(strong|solid|good|clear|align|match|overlap|proficiency in|demonstrated strength)\b/i;

const DISJUNCTIVE_LABEL_PATTERNS: Record<string, RegExp[]> = {
  "Ruby on Rails": [/\bruby\s+on\s+rails\b/i, /\brails\b/i, /\bror\b/i, /\bruby\b/i],
  React: [/\breact(?:\.js)?\b/i],
  TypeScript: [/\btype\s*script\b/i, /\btypescript\b/i],
  JavaScript: [/\bjava\s*script\b/i, /\bjavascript\b/i],
  "Node.js": [/\bnode(?:\.js)?\b/i],
  Go: [/\bgolang\b/i, /\bgo\b/i],
  Python: [/\bpython\b/i],
  Java: [/\bjava\b(?!script)/i],
  Vue: [/\bvue(?:\.js)?\b/i, /\bnuxt\b/i],
};

const jdBlobForConceptGrounding = (extracted?: ExtractedJobData): string =>
  [
    extracted?.title,
    ...(extracted?.requirements ?? []),
    ...(extracted?.responsibilities ?? []),
    extracted?.rawText ?? "",
  ]
    .join(" ")
    .toLowerCase();

const RISK_CONCEPT_REQUIRES_JD: Array<{ riskPattern: RegExp; jdPattern: RegExp }> = [
  { riskPattern: /\bforward[-\s]?deployed\b/i, jdPattern: /\bforward[-\s]?deployed\b/i },
  {
    riskPattern: /\bgrowth[-\s]?engineering\s+title\b/i,
    jdPattern: /\b(growth[-\s]?engineer|forward[-\s]?deployed)\b/i,
  },
  { riskPattern: /\bsolutions[-\s]?consulting\b/i, jdPattern: /\b(solutions[-\s]?consulting|solutions\s+engineer)\b/i },
  { riskPattern: /\bSIE\b/, jdPattern: /\bSIE\b/ },
  { riskPattern: /\bGTM\b/i, jdPattern: /\bGTM\b/i },
];

const riskReferencesAbsentJdConcepts = (line: string, extracted?: ExtractedJobData): boolean => {
  if (!extracted) return false;
  const jd = jdBlobForConceptGrounding(extracted);
  return RISK_CONCEPT_REQUIRES_JD.some(
    ({ riskPattern, jdPattern }) => riskPattern.test(line) && !jdPattern.test(jd),
  );
};

const riskContradictsSatisfiedDisjunctive = (
  line: string,
  rules?: {
    disjunctiveLanguageRequirementSatisfied?: boolean;
    disjunctiveAcceptedLanguages?: string[];
  },
): boolean => {
  if (!rules?.disjunctiveLanguageRequirementSatisfied) return false;
  const accepted = rules.disjunctiveAcceptedLanguages ?? [];
  if (accepted.length < 2) return false;
  const t = line.trim();
  if (!t) return false;
  const mentionsAccepted = accepted.some((label) =>
    (DISJUNCTIVE_LABEL_PATTERNS[label] ?? [new RegExp(`\\b${label}\\b`, "i")]).some((re) =>
      re.test(t),
    ),
  );
  if (!mentionsAccepted) return false;
  if (DISJUNCTIVE_POSITIVE_FRAMING.test(t) && !DISJUNCTIVE_GAP_FRAMING.test(t)) return false;
  return DISJUNCTIVE_GAP_FRAMING.test(t);
};

export function sanitizeRoleCardLine(
  text: string,
  companyName: string,
  extracted?: ExtractedJobData,
  rules?: {
    disjunctiveLanguageRequirementSatisfied?: boolean;
    disjunctiveAcceptedLanguages?: string[];
  },
): string {
  if (rules && riskContradictsSatisfiedDisjunctive(text, rules)) return "";
  if (riskReferencesAbsentJdConcepts(text, extracted)) return "";
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
  return cleanupVisibleLineFragments(stripUngroundedTech(cleaned, extracted));
}
