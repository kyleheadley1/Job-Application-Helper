import { applyJdLanguageOutputBoundary } from "./jdLanguageOutputBoundary.js";
import {
  languagePresentInJd,
  suppressAbsentLanguageClaims,
} from "./jdLanguagePresence.js";
import type { ExtractedJobData } from "../types/job.js";
import type { RuleEvaluation } from "../types/scoring.js";
import type { UserProfile } from "../types/userProfile.js";
import { normalizeText } from "./text.js";

/** Canonical tech keys used for allowlisting and stripping. */
export type TechCanon =
  | "go"
  | "python"
  | "javascript"
  | "typescript"
  | "java"
  | "ruby"
  | "rust"
  | "kotlin"
  | "swift"
  | "csharp"
  | "cpp"
  | "postgresql"
  | "mysql"
  | "mongodb"
  | "redis"
  | "graphql"
  | "grpc"
  | "docker"
  | "kubernetes"
  | "aws"
  | "gcp"
  | "azure"
  | "react"
  | "vue"
  | "angular"
  | "nodejs"
  | "django"
  | "flask"
  | "fastapi"
  | "rails"
  | "spring"
  | "dotnet";

const STRIP_ORDER: Array<{ canon: TechCanon; patterns: RegExp[] }> = [
  { canon: "postgresql", patterns: [/\bPostgreSQL\b/gi, /\bPostgres\b/gi] },
  { canon: "javascript", patterns: [/\bJavaScript\b/gi] },
  { canon: "typescript", patterns: [/\bTypeScript\b/gi] },
  { canon: "nodejs", patterns: [/\bNode\.js\b/gi, /\bNodeJS\b/gi] },
  { canon: "kubernetes", patterns: [/\bKubernetes\b/gi, /\bK8s\b/gi] },
  { canon: "graphql", patterns: [/\bGraphQL\b/gi] },
  { canon: "mongodb", patterns: [/\bMongoDB\b/gi] },
  { canon: "fastapi", patterns: [/\bFastAPI\b/gi] },
  { canon: "django", patterns: [/\bDjango\b/gi] },
  { canon: "flask", patterns: [/\bFlask\b/gi] },
  { canon: "kotlin", patterns: [/\bKotlin\b/gi] },
  { canon: "swift", patterns: [/\bSwift\b/gi] },
  { canon: "csharp", patterns: [/\bC#\b/g] },
  { canon: "cpp", patterns: [/\bC\+\+\b/g] },
  { canon: "dotnet", patterns: [/\.NET\b/gi] },
  { canon: "spring", patterns: [/\bSpring\b/gi] },
  { canon: "rails", patterns: [/\bRails\b/gi] },
  { canon: "ruby", patterns: [/\bRuby\b/gi] },
  { canon: "rust", patterns: [/\bRust\b/gi] },
  { canon: "java", patterns: [/\bJava\b/gi] },
  { canon: "python", patterns: [/\bPython\b/gi] },
  { canon: "go", patterns: [/\(\s*and\s+Go\s*\)/gi, /\s+and\s+Go\b/gi, /\bGolang\b/gi, /\bGo\b/gi] },
  { canon: "react", patterns: [/\bReact\b/gi] },
  { canon: "vue", patterns: [/\bVue\.js\b/gi, /\bVue\b/gi] },
  { canon: "angular", patterns: [/\bAngular\b/gi] },
  { canon: "docker", patterns: [/\bDocker\b/gi] },
  { canon: "mysql", patterns: [/\bMySQL\b/gi] },
  { canon: "redis", patterns: [/\bRedis\b/gi] },
  { canon: "grpc", patterns: [/\bgRPC\b/gi] },
  { canon: "aws", patterns: [/\bAWS\b/g] },
  { canon: "gcp", patterns: [/\bGCP\b/g] },
  { canon: "azure", patterns: [/\bAzure\b/gi] },
];

function jobBlobForAllowlist(extracted: ExtractedJobData): string {
  return normalizeText(
    [
      extracted.company,
      extracted.title,
      extracted.rawText ?? "",
      ...(extracted.stack ?? []),
      ...(extracted.requiredSkills ?? []),
      ...(extracted.preferredSkills ?? []),
      ...(extracted.domainTags ?? []),
      ...(extracted.requirements ?? []),
      ...(extracted.responsibilities ?? []),
    ].join("\n"),
  );
}

function profileBlob(profile: UserProfile): string {
  return normalizeText(
    [
      profile.headline,
      ...profile.strengths,
      ...profile.weakerAreas,
      ...profile.recurringStory,
      ...profile.targetRoles,
      ...profile.flagshipProjects.flatMap((p) => [p.name, p.summary, ...p.tech, ...p.outcomes]),
    ].join("\n"),
  );
}

/** Scan text for tech tokens and add canonical forms to the set. */
export function collectTechFromText(blob: string, into: Set<string>): void {
  for (const { canon, patterns } of STRIP_ORDER) {
    for (const re of patterns) {
      const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
      const r = new RegExp(re.source, flags);
      if (r.test(blob)) {
        into.add(canon);
        break;
      }
    }
  }
  const compact = normalizeText(blob).replace(/[^a-z0-9+/.\s]/g, " ");
  if (/\bnode\.js\b|\bnodejs\b/.test(compact)) into.add("nodejs");
  if (/\btypescript\b/.test(compact)) into.add("typescript");
  if (/\bjavascript\b/.test(compact)) into.add("javascript");
  if (/\bpostgres\b|\bpostgresql\b/.test(compact)) into.add("postgresql");
  if (/\bmongodb\b|\bmongo\b/.test(compact)) into.add("mongodb");
  if (/\bpython\b/.test(compact)) into.add("python");
  if (/\bgolang\b/.test(compact) || /\bgo\b/.test(compact)) into.add("go");
  if (/\breact\b/.test(compact)) into.add("react");
  if (/\bvue\b/.test(compact)) into.add("vue");
  if (/\bangular\b/.test(compact)) into.add("angular");
  if (/\bruby\b/.test(compact)) into.add("ruby");
  if (/\brust\b/.test(compact)) into.add("rust");
  if (/\bjava\b/.test(compact) && !/\bjavascript\b/.test(compact)) into.add("java");
  if (/\bdjango\b/.test(compact)) into.add("django");
  if (/\bflask\b/.test(compact)) into.add("flask");
  if (/\bfastapi\b/.test(compact)) into.add("fastapi");
  if (/\bdocker\b/.test(compact)) into.add("docker");
  if (/\bkubernetes\b|\bk8s\b/.test(compact)) into.add("kubernetes");
  if (/\bgraphql\b/.test(compact)) into.add("graphql");
  if (/\bgrpc\b/.test(compact)) into.add("grpc");
  if (/\bmysql\b/.test(compact)) into.add("mysql");
  if (/\bredis\b/.test(compact)) into.add("redis");
  if (/\baws\b/.test(compact)) into.add("aws");
  if (/\bgcp\b/.test(compact)) into.add("gcp");
  if (/\bazure\b/.test(compact)) into.add("azure");
}

export function buildAllowedTechCanonicalSet(params: {
  extracted: ExtractedJobData;
  userProfile?: UserProfile;
  rules?: Pick<RuleEvaluation, "explicitCoreLanguage">;
}): Set<string> {
  const allowed = new Set<string>();
  collectTechFromText(jobBlobForAllowlist(params.extracted), allowed);
  if (params.userProfile) collectTechFromText(profileBlob(params.userProfile), allowed);
  const lang = params.rules?.explicitCoreLanguage?.toLowerCase();
  if (lang === "go" && languagePresentInJd("Go", params.extracted)) allowed.add("go");
  if (lang === "python" && languagePresentInJd("Python", params.extracted)) allowed.add("python");
  if (lang === "java" && languagePresentInJd("Java", params.extracted)) allowed.add("java");
  return allowed;
}

const COMPANY_LABEL_FALLBACK = "This employer";

/** Remove evaluator shorthand and cross-company references from user-visible lines. */
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

/** Collapse duplicate commas, empty parentheses, and clipped trailing commas. */
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

export function stripDisallowedTech(text: string, allowed: Set<string>): string {
  let t = text;
  for (const { canon, patterns } of STRIP_ORDER) {
    if (allowed.has(canon)) continue;
    for (const re of patterns) {
      const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
      const r = new RegExp(re.source, flags);
      t = t.replace(r, "");
    }
  }
  return cleanupVisibleLineFragments(t);
}

export type VisibleSanitizeContext = {
  extracted: ExtractedJobData;
  userProfile?: UserProfile;
  rules?: RuleEvaluation;
};

export function sanitizeVisibleRiskLine(text: string, ctx: VisibleSanitizeContext): string {
  if (!text.trim()) return text;
  const suppressed = suppressAbsentLanguageClaims(text, ctx.extracted);
  if (!suppressed.trim()) return "";
  const allowed = buildAllowedTechCanonicalSet({
    extracted: ctx.extracted,
    userProfile: ctx.userProfile,
    rules: ctx.rules,
  });
  let t = stripEvaluatorJargon(suppressed, ctx.extracted.company);
  t = stripDisallowedTech(t, allowed);
  const evidenceBlob = normalizeText(
    [
      ctx.extracted.rawText ?? "",
      ...(ctx.extracted.stack ?? []),
      ...(ctx.extracted.requiredSkills ?? []),
      ...(ctx.extracted.preferredSkills ?? []),
      ...(ctx.extracted.requirements ?? []),
      ...(ctx.extracted.responsibilities ?? []),
      ...(ctx.userProfile?.strengths ?? []),
      ...(ctx.userProfile?.flagshipProjects.flatMap((p) => p.tech) ?? []),
    ].join(" "),
  );
  const hasRelationalEvidence =
    /\b(postgres|postgresql|mysql|sql|database[-\s]?backed|mongodb|mongo)\b/i.test(evidenceBlob);
  if (hasRelationalEvidence) {
    t = t.replace(
      /\bno\s+evidence\s+of\s+relational[-\s]?database\s+experience\b/gi,
      "Relational database fundamentals may still be screened for production depth",
    );
  }
  t = t.replace(
    /\b(no|limited)\s+(go|golang|graphql|docker|kubernetes|cloud deployments?)\b[^.]*\b(low|major)\s+(fit|score|match)\b/gi,
    "Preferred Go/GraphQL/platform stack is not the candidate's strongest lane",
  );
  t = t.replace(
    /\b(role|position)\s+may\s+overreach\s+current\s+level\s+story\b/gi,
    "Team may still screen for backend/cloud/database production depth despite the associate level",
  );
  if (ctx.rules?.researchHeavyAiRole) {
    t = t.replace(
      /\bresearch[-\s]?heavy[^.]*\./gi,
      "Role is research-heavy and explicitly asks for self-constructing systems, meta-learning, program synthesis, and agent architecture research that are not clearly demonstrated in the current profile.",
    );
    t = t.replace(
      /\btrack\s+record\s+of\s+research\s+results[^.]*\./gi,
      "Proven track record of research results is a major recruiter-screen gap.",
    );
  }
  if (ctx.rules?.fintechGoPrimaryStretch) {
    t = t.replace(
      /\b(finance\/banking role context typically screens more strictly|no prior fintech\/payments[^.]*stricter screening)\.?\s*(and\s+)?/gi,
      "No prior fintech/payments or co-branded card experience may create a steeper ramp and stricter screening. ",
    );
    t = t.replace(
      /\bgo-primary backend expectations[^.]*major stack caveat\./gi,
      "Go-primary fintech/payments backend role is outside the strongest TypeScript/Node + AI/product lane.",
    );
  }
  if (ctx.rules?.foundingEngineerStretch) {
    t = t.replace(
      /\bfounding-style expectations do not match strongest current story\./gi,
      "Founding engineer role may require more independent production ownership and architectural judgment than the profile clearly demonstrates.",
    );
    t = t.replace(
      /\b(role|screeners?) may still (probe|check) scale and fundamentals[^.]*\./gi,
      "Early-stage team may offer limited mentorship or structure.",
    );
    t = t.replace(
      /\btraditional employer signal suggests stricter screening behavior\./gi,
      "Early-stage founder-level autonomy can still create stricter first-pass screening.",
    );
  }
  if (ctx.rules?.goDistributedDataInfraCandidateGap) {
    t = t.replace(
      /\bstrong\s+(api|apis|typescript|ts\b|javascript|react|node\.?js|full[-\s]?stack)\b[^.]{0,80}\b(background|fit|overlap|alignment|lane|story)\b/gi,
      "limited API/database overlap versus Go-first data infrastructure expectations",
    );
  }
  return cleanupVisibleLineFragments(t);
}

export function sanitizeVisibleNarrativeLine(text: string, ctx: VisibleSanitizeContext): string {
  return sanitizeVisibleRiskLine(text, ctx);
}

export function sanitizeBulletList(lines: string[], ctx: VisibleSanitizeContext): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const s = sanitizeVisibleRiskLine(raw, ctx);
    if (!s.trim()) continue;
    const k = normalizeText(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export function sanitizeRuleNotesForDisplay(
  notes: string[],
  extracted: ExtractedJobData,
  userProfile: UserProfile | undefined,
  rules: RuleEvaluation,
): string[] {
  const ctx: VisibleSanitizeContext = { extracted, userProfile, rules };
  return sanitizeBulletList(notes, ctx);
}

/** Persist rules with user-facing notes stripped of cross-role leakage (flags unchanged). */
export function withSanitizedRuleNotes(
  rules: RuleEvaluation,
  extracted: ExtractedJobData,
  userProfile?: UserProfile,
): RuleEvaluation {
  const bounded = applyJdLanguageOutputBoundary(extracted, rules);
  return {
    ...bounded,
    notes: sanitizeRuleNotesForDisplay(bounded.notes, extracted, userProfile, bounded),
  };
}
