import { normalizeText } from "./text.js";

/** NYC metro or common NJ commute — used for commutable + rule overrides. */
export const textImpliesNycMetroOrCommutableNj = (text: string): boolean => {
  const n = normalizeText(text).replace(
    /\([^)]*not\s+commutable\s+from\s+(nyc|new\s+york(\s+city)?)[^)]*\)/gi,
    " ",
  );
  return (
    /\b(nyc|new york city|new york,\s*ny|new york\s+ny|manhattan|brooklyn|queens|bronx|staten island)\b/i.test(
      n,
    ) ||
    /\b(jersey city|hoboken|newark|montclair|princeton|edison|fort lee|bergen county|hudson county)\b/i.test(
      n,
    ) ||
    /\b(new jersey|nj)\b/i.test(n)
  );
};

/** Venture-backed / startup context — weakens "traditional employer" heuristics. */
export const textImpliesVentureBackedStartup = (text: string): boolean => {
  const n = normalizeText(text);
  return (
    /\b(series\s+[a-e]|seed(\s+stage)?|venture[-\s]?backed|vc[-\s]?backed|y\s+combinator|yc\s+[ws]\d{2}|startup|founding\s+team)\b/i.test(
      n,
    ) || /\b(raised\s+\$|post[-\s]?seed|pre[-\s]?ipo)\b/i.test(n)
  );
};

/** Applied AI / product AI engineering — not finance domain by default. */
export const textImpliesAppliedAiEngineering = (text: string): boolean => {
  const n = normalizeText(text);
  return (
    /\b(ai engineer|applied ai|generative ai|llm\b|large language model|rag\b|retrieval[-\s]?augmented|vector\s+(db|database|search)|embedding|agentic|ai workflow|evals?\b|evaluation framework|prompt engineering|langchain|llamaindex)\b/i.test(
      n,
    ) || /\b(machine learning engineer|ml engineer)\b/i.test(n)
  );
};

const STRICT_FINANCE_PHRASES = [
  "investment bank",
  "investment banking",
  "retail bank",
  "commercial bank",
  "private bank",
  "bulge bracket",
  "hedge fund",
  "proprietary trading",
  "prop trading",
  "sell-side",
  "buy-side",
  "asset management",
  "wealth management",
  "capital markets",
  "mortgage lending",
  "loan origination",
  "underwriting",
  "insurance carrier",
  "life insurer",
  "reinsurance",
  "basel iii",
  "fdic",
  "finra",
  "kyc/aml",
  "open banking",
];

const includesAny = (haystack: string, needles: string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

const BANK_LIKE_COMPANY = /\b(bank|bancorp|bancshares)\b/i;

/** Explicit finance / banking / trading employer or JD — not generic "enterprise" or "customers". */
export const detectStrictFinanceEmployerContext = (combinedText: string, companyNorm: string): boolean => {
  const c = normalizeText(combinedText);
  const co = normalizeText(companyNorm);
  if (includesAny(c, STRICT_FINANCE_PHRASES)) return true;
  if (/\b(quantitative trader|quant researcher|trading firm|market maker)\b/i.test(c)) return true;
  if (BANK_LIKE_COMPANY.test(co) && !/\bfood\s+bank\b/i.test(co)) return true;
  if (
    /\b(jpmorgan|goldman|morgan stanley|citigroup|citi\b|wells fargo|bank of america|deutsche bank|barclays|ubs\b|credit suisse)\b/i.test(
      c,
    )
  )
    return true;
  if (/\b(fintech)\b/i.test(c) && /\b(lending|core banking|treasury)\b/i.test(c)) return true;
  return false;
};

const TRADITIONAL_STRICT_PHRASES = [
  "federal government",
  "government contractor",
  "department of defense",
  "defense contractor",
  "public sector",
  "healthcare system",
  "hospital system",
  "health system",
  "campus hire",
  "campus recruiting",
];

const FORTUNE_500_EMPLOYER = /\b(fortune\s+500\s+company|fortune\s+500\s+employer|we\s+are\s+a\s+fortune)\b/i;

/**
 * Traditional / credential-heavy employer — not generic "institution", "customers", or "enterprise".
 * Venture-backed applied-AI startups may still get "campus hire / Fortune 500 employer" noise; suppress only weak signals.
 */
export const detectTraditionalEmployerContextStrict = (combinedText: string, companyNorm: string): boolean => {
  const c = normalizeText(combinedText);
  const co = normalizeText(companyNorm);

  const strongTraditional =
    /\b(federal government|government contractor|department of defense|defense contractor|public sector)\b/i.test(
      c,
    ) ||
    /\b(healthcare system|hospital system|health system)\b/i.test(c) ||
    /\b(ts\/sci|top\s+secret\s+clearance)\b/i.test(c) ||
    /\b(state street|federal reserve|irs\b|dod\b|dhs\b)\b/i.test(c) ||
    (BANK_LIKE_COMPANY.test(co) && !/\bfood\s+bank\b/i.test(co));

  const weakTraditional =
    includesAny(c, TRADITIONAL_STRICT_PHRASES) || FORTUNE_500_EMPLOYER.test(c);

  if (strongTraditional) return true;

  if (!weakTraditional) return false;

  const startup = textImpliesVentureBackedStartup(c);
  const appliedAi = textImpliesAppliedAiEngineering(c);
  const campusPipeline = /\b(campus hire|campus recruiting|rotational program|rotation program)\b/i.test(c);
  if (startup && appliedAi && !campusPipeline) return false;

  return true;
};
