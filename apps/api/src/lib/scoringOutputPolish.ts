import {
  explicitCoreLanguageRiskSummary,
  type CoreLanguageId,
} from "./coreLanguageRequirements.js";
import { fdeBuilderPrimaryRiskSummary } from "./fdeBuilderRole.js";
import type { ExtractedJobData } from "../types/job.js";
import type { RuleEvaluation, ScoreBreakdown } from "../types/scoring.js";
import type { UserProfile } from "../types/userProfile.js";
import { normalizeText } from "./text.js";

export type ScoringNarrative = {
  score: ScoreBreakdown;
  topMatch: string;
  mainRisk: string;
  rationale: string[];
  risks: string[];
};

const sumScoreParts = (s: ScoreBreakdown): number =>
  s.stackFit +
  s.levelFit +
  s.domainFit +
  s.resumeStoryClarity +
  s.functionalOverlap +
  s.recruiterFriendliness +
  s.careerValue;

const jobTextBlob = (job: ExtractedJobData): string =>
  normalizeText(
    [
      job.title,
      job.company,
      job.rawText ?? "",
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
      ...(job.stack ?? []),
    ].join("\n"),
  );

/** JD emphasizes applied AI / LLM product work (domain alignment with AI systems). */
export const jdHasAppliedAiSystemsOverlap = (blob: string): boolean =>
  /\b(llm|large language model|rag\b|retrieval[-\s]?augmented|agentic|ai agents?|generative ai|vector\s+(search|db|database)|embedding|ai workflow|applied ai|customer[-\s]?facing ai|production ai|evals?\b|evaluation framework)\b/i.test(
    blob,
  );

/** Profile supports DevAI / RAG / LLM shipping (per user profile + projects). */
export const profileHasAiToolingEvidence = (profile: UserProfile): boolean => {
  const blob = normalizeText(
    [
      profile.headline,
      ...profile.strengths,
      ...profile.recurringStory,
      ...profile.targetRoles,
      ...profile.flagshipProjects.flatMap((p) => [p.name, p.summary, ...p.tech, ...p.outcomes]),
    ].join(" "),
  );
  return /\b(rag|llm|ai[-\s]?enabled|generative|vector|embedding|devai|workflow|internal tooling.*llm)\b/i.test(
    blob,
  );
};

/** JD names concrete RAG/LLM/vector/agent systems AND profile backs that lane (not generic "AI" only). */
export const jdExplicitProfileAiDomainOverlap = (blob: string, profile: UserProfile): boolean => {
  if (!jdHasAppliedAiSystemsOverlap(blob)) return false;
  const jdSpecific = /\b(rag\b|retrieval|llm|vector\s+(search|db|database)|embedding|agentic|evals?\b|ai workflow)\b/i.test(
    blob,
  );
  return jdSpecific && profileHasAiToolingEvidence(profile);
};

/**
 * Applied-AI-shaped JD that is thin on concrete stack, responsibilities, and system surface area.
 * Used to damp "generic AI startup" score inflation.
 */
export const jdIsStructurallyVague = (extracted: ExtractedJobData): boolean => {
  const blob = jobTextBlob(extracted);
  if (!jdHasAppliedAiSystemsOverlap(blob)) return false;
  const stacks = [...(extracted.stack ?? []), ...(extracted.requiredSkills ?? [])].join(" ").toLowerCase();
  const stackTokenHits =
    (stacks.match(
      /\b(python|typescript|javascript|java|go|rust|react|vue|angular|node\.?js|kubernetes|docker|postgres|graphql|grpc|fastapi|django|flask)\b/gi,
    ) ?? []).length;
  const hasConcreteStack =
    (extracted.stack?.length ?? 0) + (extracted.requiredSkills?.length ?? 0) >= 2 || stackTokenHits >= 2;
  const bullets = extracted.responsibilities ?? [];
  const substantive = bullets.filter((b) => b.trim().length > 38).length;
  const hasSpecificResponsibilities = substantive >= 2 || bullets.length >= 4;
  const hasSystemTypes =
    /\b(rest\s*api|graphql|grpc|microservice|kubernetes|k8s|infra|database|postgres|mysql|inference|training|pipeline|rag\b|llm|embedding|vector|retrieval|agents?|evals?|distributed|observability|backend\s+service)\b/i.test(
      blob,
    );
  const thinDetail = blob.length < 720;
  const fewBullets = bullets.length <= 2;
  const fewStack = (extracted.stack?.length ?? 0) + (extracted.requiredSkills?.length ?? 0) <= 1;
  if (thinDetail && fewBullets && fewStack && !hasSystemTypes) return true;
  return thinDetail && (!hasConcreteStack || !hasSpecificResponsibilities || !hasSystemTypes);
};

/** Max travel % mentioned in JD; used for lifestyle risk. */
export const extractMaxTravelPercent = (blob: string): number | undefined => {
  let max = 0;
  const patterns: RegExp[] = [
    /travel\s*[:.]?\s*(\d+)\s*[%％]\s*[-–]\s*(\d+)\s*[%％]/gi,
    /travel\s+(\d+)\s*[-–]\s*(\d+)\s*[%％]/gi,
    /(\d+)\s*[%％]\s*[-–]\s*(\d+)\s*[%％]\s*(?:for\s+)?travel/gi,
    /(\d+)\s*[%％]\s*[-–]\s*(\d+)\s*[%％]\s*annually/gi,
    /travel\s*[:.]?\s*(\d+)\s*[%％]\s*(?:-\s*(\d+)\s*[%％])?/gi,
    /(\d+)\s*[%％]\s*travel/gi,
    /up to\s*(\d+)\s*[%％]\s*travel/gi,
    /travel\s*(?:requirement|expected)[^.]{0,40}?(\d+)\s*[%％]/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(blob)) !== null) {
      const a = Number.parseInt(m[1] ?? "0", 10);
      const b = m[2] ? Number.parseInt(m[2], 10) : a;
      if (Number.isFinite(a)) max = Math.max(max, a, b);
    }
  }
  return max > 0 ? max : undefined;
};

/** Human label when JD states a travel range (e.g. "travel 10–20%"). */
export const extractTravelRangeLabel = (blob: string): string | undefined => {
  const r1 = blob.match(/travel\s*[:.]?\s*(\d+)\s*[%％]\s*[-–]\s*(\d+)\s*[%％]/i);
  if (r1) return `${r1[1]}–${r1[2]}%`;
  const r1b = blob.match(/travel\s+(\d+)\s*[-–]\s*(\d+)\s*[%％]/i);
  if (r1b) return `${r1b[1]}–${r1b[2]}%`;
  const r2 = blob.match(/(\d+)\s*[%％]\s*[-–]\s*(\d+)\s*[%％]\s*(?:for\s+)?travel/i);
  if (r2) return `${r2[1]}–${r2[2]}%`;
  return undefined;
};

/**
 * Always surface travel % from the JD as a practical risk when detectable.
 * 25%+ uses stronger wording (high-signal lifestyle blocker).
 */
export const travelRiskLine = (blob: string): string | undefined => {
  const pct = extractMaxTravelPercent(blob);
  if (pct === undefined) return undefined;
  const rangeLabel = extractTravelRangeLabel(blob);
  const label = rangeLabel ?? `~${pct}%`;
  if (pct >= 25) {
    return `Significant travel (${label}) may be a constraint versus low-travel or office-heavy preferences.`;
  }
  return `Travel requirement (${label}) may be a constraint if you need minimal travel or fixed hybrid cadence.`;
};

const tokenSet = (s: string): Set<string> =>
  new Set(
    normalizeText(s)
      .split(" ")
      .filter((t) => t.length > 2),
  );

const similarSentence = (a: string, b: string): boolean => {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.max(A.size, B.size) >= 0.72;
};

const jdRequiresDeepDomainSpecialization = (jd: string): boolean =>
  /\b(deep\s+domain|subject\s+matter\s+expert|industry\s+expert|10\+\s*years\s+in|ph\.?d\.?\s+in|licensed\s+\w+\s+professional)\b/i.test(
    jd,
  );

/** Drop vague "enterprise/domain expertise" caveats unless JD demands deep specialization. */
export const isLowSignalEnterpriseDomainRisk = (risk: string, jdBlob: string): boolean => {
  if (jdRequiresDeepDomainSpecialization(jdBlob)) return false;
  if (/forward[-\s]?deployed\s+or\s+growth[-\s]?engineering/i.test(risk)) return false;
  const t = risk.toLowerCase();
  if (!/\b(enterprise|domain|industry|vertical)\b/.test(t)) return false;
  if (!/\b(lack|limited|missing|gap|no |without|insufficient|weak|light)\b/.test(t)) return false;
  return true;
};

const riskPriority = (risk: string, jdBlob: string): number => {
  const t = normalizeText(risk);
  if (/explicit\s+\w+\s+backend requirement vs type/i.test(t)) return 98;
  /** Third-priority stretch risk: after Python/stack and travel/hybrid. */
  if (
    /customer[-\s]?facing production ai|production ai ownership/.test(t) &&
    /potential mismatch|depth of ownership|above.*experience/.test(t)
  ) {
    return 84;
  }
  let p = 50;
  // Decision-blocker order: language/stack → level/ownership → travel (25%+) → travel (lower) → onsite/hybrid
  if (/\bpython\b/.test(t) && /\b(type ?script|javascript|node|primary|first)\b/.test(t)) p = 100;
  else if (/forward[-\s]?deployed\s+or\s+growth[-\s]?engineering/i.test(t)) p = 97;
  else if (/\b(stack|language|framework|go\b|ruby|java(?!script))\b/.test(t)) p = 96;
  if (/\b(senior|staff|principal|ownership|years of|leadership scope|enterprise production ai)\b/.test(t))
    p = Math.max(p, 94);
  if (/\btravel\b/.test(t)) {
    const maxT = extractMaxTravelPercent(jdBlob);
    p = Math.max(p, maxT !== undefined && maxT >= 25 ? 90 : 86);
  }
  if (/\b(onsite|in[-\s]?office|days?\s+per\s+week|relocation|commute|hybrid)\b/.test(t)) p = Math.max(p, 83);
  if (/\b(degree|bachelor|clearance|citizenship|sponsorship)\b/.test(t)) p = Math.max(p, 78);
  if (isLowSignalEnterpriseDomainRisk(risk, jdBlob)) p = Math.min(p, 15);
  if (/\b(required|must|hard)\b/.test(t)) p += 5;
  return p;
};

/** Practical = lifestyle/logistics; technical = stack, level, ownership, gates. */
export const riskBucket = (risk: string): "technical" | "practical" =>
  /\b(travel|onsite|hybrid|in[-\s]?office|commute|relocation|timezone|days?\s+per\s+week|office\s+days|lifestyle)\b/i.test(
    risk,
  )
    ? "practical"
    : "technical";

/** Prefer top priority first, then one from the other bucket when possible (hiring-manager scan). */
export function pickBalancedRiskOrder(sorted: string[], max: number): string[] {
  if (sorted.length === 0) return [];
  if (max <= 1) return [sorted[0]];
  const main = sorted[0];
  const wantOther = riskBucket(main) === "technical" ? "practical" : "technical";
  const second =
    sorted.slice(1).find((r) => riskBucket(r) === wantOther && !similarSentence(r, main)) ??
    sorted.slice(1).find((r) => !similarSentence(r, main));
  const out: string[] = [main];
  if (second) out.push(second);
  for (const r of sorted) {
    if (out.length >= max) break;
    if (out.some((x) => similarSentence(x, r))) continue;
    out.push(r);
  }
  return out.slice(0, max);
}

const uniqueRisks = (items: string[]): string[] => {
  const out: string[] = [];
  for (const raw of items) {
    const s = raw.trim();
    if (!s) continue;
    if (out.some((x) => similarSentence(x, s))) continue;
    out.push(s);
  }
  return out;
};

const PRODUCTION_AI_OWNERSHIP_RISK =
  "Customer-facing production AI ownership is a potential mismatch with the depth of ownership shown in this profile.";

export function polishRisksAndMain(params: {
  mainRisk: string;
  risks: string[];
  extracted: ExtractedJobData;
  travelLine?: string;
  max?: number;
  rules?: RuleEvaluation;
}): { mainRisk: string; risks: string[] } {
  const jdBlob = jobTextBlob(params.extracted);
  const max = params.max ?? 3;
  const rawList = [params.mainRisk, ...(params.risks ?? [])].filter((x): x is string => Boolean(x?.trim()));
  if (params.rules?.explicitCoreLanguageMismatch && params.rules.explicitCoreLanguage) {
    const line = explicitCoreLanguageRiskSummary(params.rules.explicitCoreLanguage as CoreLanguageId);
    if (!rawList.some((r) => /explicit.*mature employer/i.test(r))) {
      rawList.unshift(line);
    }
  }
  if (params.rules?.fdeBuilderSoftwarePrimary) {
    if (!rawList.some((r) => similarSentence(r, fdeBuilderPrimaryRiskSummary))) {
      rawList.unshift(fdeBuilderPrimaryRiskSummary);
    }
  }
  const suggestOwnershipRisk =
    max >= 3 &&
    /\b(customer[-\s]?facing|production ai)\b/i.test(jdBlob) &&
    /\b(llm|rag|applied ai|ai systems?)\b/i.test(jdBlob) &&
    !rawList.some((r) => similarSentence(r, PRODUCTION_AI_OWNERSHIP_RISK) || /ownership.*production ai/i.test(r));
  if (suggestOwnershipRisk) rawList.push(PRODUCTION_AI_OWNERSHIP_RISK);

  const merged = uniqueRisks(
    [...rawList, params.travelLine].filter((x): x is string => Boolean(x?.trim())),
  );
  const filtered = merged.filter((r) => !isLowSignalEnterpriseDomainRisk(r, jdBlob));
  const sorted = [...filtered].sort((a, b) => riskPriority(b, jdBlob) - riskPriority(a, jdBlob));
  const top = pickBalancedRiskOrder(sorted, max);
  const fallbackMain =
    params.mainRisk.trim() || "Standard recruiter-screen gaps may still apply for unverified claims.";
  return {
    mainRisk: top[0] ?? fallbackMain,
    risks: top.length > 1 ? top.slice(1) : [],
  };
}

const PROOF_HINT =
  /\b(shipped|built|implemented|delivered|owned|codesmith|project|production|internship|experience|profile|flagship|led|scaled)\b/i;
/** Second bullet must tie to engineering artifacts, not generic praise (embeddings, pipelines, DevAI-style delivery). */
export const CONCRETE_ENGINEERING_PROOF =
  /\b(embedding|embeddings|vector\s*(search|database|db)?|ingestion|pipeline|pipelines|rag\b|retrieval|semantic|chunk|evals?|evaluations?|agents?|devai|openapi|kubernetes|lambda|typescript|node\.?js|rest\s*api)\b/i;
const VAGUE_FIT_RE =
  /\b(solid\s+match|strategic\s+capability|strategic\s+readiness|generic\s+fit|generic\s+overlap)\b/gi;

const hasVagueFitPhrase = (s: string): boolean =>
  /\b(solid\s+match|strategic\s+capability|strategic\s+readiness|generic\s+fit|generic\s+overlap)\b/i.test(s);

/** Remove reusable vague praise from Why consider lines. */
export function stripVagueWhyConsiderPhrases(text: string): string {
  let t = text.replace(VAGUE_FIT_RE, "").replace(/\s{2,}/g, " ").replace(/\s*,\s*,/g, ",").trim();
  t = t.replace(/^[,;]\s*/, "").replace(/\s*[,;]\s*$/g, "").trim();
  return t;
}

/** Capability / fit angle for bullet 1 — not concrete proof. */
const CAPABILITY_HINT =
  /\b(overlap|align|match|fit|role|scope|stack|workflow|systems|shape)\b/i;

const appliedAiTriple =
  /\b(llm|rag|vector\s+(search|embedding)|rest\s*api|api\s+integration|applied[-\s]?ai)\b/gi;

/** Reduce repeated LLM/RAG/API clusters across the two "why consider" lines. */
export function dampDuplicateAppliedAiPhrasing(first: string, second: string): string {
  let b = second.trim();
  const hitsFirst = (first.match(appliedAiTriple) ?? []).length;
  const hitsSecond = (b.match(appliedAiTriple) ?? []).length;
  if (hitsFirst < 2 || hitsSecond < 2) return b;
  b = b.replace(/^\s*(strong\s+|clear\s+)?(applied[-\s]?ai\s+)?(product\s+)?/i, "");
  b = b.replace(/\b(via|from|including)\s+[^,.]+(?:llm|rag|api)[^.]*\.?/i, (m) =>
    /\b(shipped|built|owned|delivered)\b/i.test(m) ? m : "",
  );
  b = b.replace(/\s*\.?\s*$/, "");
  if (b.length < 28) return second.trim();
  return b.replace(/^,\s*/, "").trim();
}

/** Trim trailing commas, fix clipped applied-AI summary lines, avoid sentence fragments. */
export function sanitizeNarrativeSentence(text: string, minLen = 55): string {
  let t = stripVagueWhyConsiderPhrases(text.trim()).replace(/,\s*$/, "").replace(/\s+$/, "");
  t = t.replace(/\s*\b(and|or)\s*$/i, "").trim();
  if (t.length < minLen && /(llm|rag|applied[-\s]?ai|ai workflow)/i.test(t)) {
    if (!/\b(integration|end[-\s]to[-\s]end|workflow experience)\b/i.test(t)) {
      t = `${t.replace(/[.,;]$/, "")}, with API integration and end-to-end AI workflow experience`;
    }
  }
  return t.replace(/,\s*$/, "").trim();
}

function pickConcreteProofLine(
  candidates: string[],
  avoid: string | undefined,
): string | undefined {
  const avoidNorm = avoid ? normalizeText(avoid) : "";
  const scored = candidates.filter((r) => r && !similarSentence(r, avoid ?? ""));
  const concrete = scored.find((r) => CONCRETE_ENGINEERING_PROOF.test(r) && PROOF_HINT.test(r));
  if (concrete) return concrete;
  return scored.find((r) => CONCRETE_ENGINEERING_PROOF.test(r)) ?? scored.find((r) => PROOF_HINT.test(r));
}

export function polishRationaleBullets(rationale: string[], max = 2): string[] {
  const items = rationale.map((s) => sanitizeNarrativeSentence(s.trim())).filter(Boolean);
  const deduped: string[] = [];
  for (const item of items) {
    if (deduped.some((d) => similarSentence(d, item))) continue;
    deduped.push(item);
  }
  const proofLines = deduped.filter((r) => PROOF_HINT.test(r));
  const nonProof = deduped.filter((r) => !PROOF_HINT.test(r));
  let capability =
    nonProof.find((r) => CAPABILITY_HINT.test(r) && !hasVagueFitPhrase(r)) ??
    nonProof.find((r) => !hasVagueFitPhrase(r)) ??
    nonProof[0] ??
    deduped.find((r) => CAPABILITY_HINT.test(r)) ??
    deduped[0];
  if (capability) capability = stripVagueWhyConsiderPhrases(capability);

  let proof = pickConcreteProofLine(deduped, capability);
  if (proof === capability) proof = pickConcreteProofLine([...proofLines, ...deduped], capability);
  if (!proof || proof === capability) proof = deduped.find((r) => r !== capability);

  const out: string[] = [];
  if (capability) out.push(capability);
  if (proof && proof !== capability) out.push(dampDuplicateAppliedAiPhrasing(capability ?? "", proof));
  for (const r of deduped) {
    if (out.length >= max) break;
    const adj = out.length === 1 && out[0] ? dampDuplicateAppliedAiPhrasing(out[0], r) : r;
    if (out.some((x) => x === r || similarSentence(x, adj))) continue;
    out.push(adj);
  }
  const sliced = out.slice(0, max).map((s) => sanitizeNarrativeSentence(s));
  if (sliced.length === 2) {
    sliced[1] = sanitizeNarrativeSentence(dampDuplicateAppliedAiPhrasing(sliced[0], sliced[1]));
    if (!CONCRETE_ENGINEERING_PROOF.test(sliced[1]) && !/\b(shipped|built|implemented|delivered|owned|production)\b/i.test(sliced[1])) {
      const alt = pickConcreteProofLine(deduped, sliced[0]);
      if (alt && !similarSentence(sliced[0], alt)) {
        sliced[1] = sanitizeNarrativeSentence(dampDuplicateAppliedAiPhrasing(sliced[0], alt));
      }
    }
  }
  return sliced;
}

/** Raise domain fit when JD + profile show direct applied-AI overlap (unless hard domain mismatch). */
export function applyAppliedAiDomainFloor(params: {
  score: ScoreBreakdown;
  extracted: ExtractedJobData;
  userProfile: UserProfile;
  rules: RuleEvaluation;
}): ScoreBreakdown {
  const { score, extracted, userProfile, rules } = params;
  if (rules.domainMismatch) return score;
  const blob = jobTextBlob(extracted);
  if (!jdHasAppliedAiSystemsOverlap(blob) || !profileHasAiToolingEvidence(userProfile)) return score;
  if (rules.vagueEarlyStageAiCalibration) {
    const explicit = jdExplicitProfileAiDomainOverlap(blob, userProfile);
    let domainFit = Math.min(score.domainFit, explicit ? 8 : 7);
    domainFit = Math.max(0, domainFit);
    if (domainFit === score.domainFit) return score;
    const next = { ...score, domainFit };
    return { ...next, total: sumScoreParts(next) };
  }
  let domainFit = score.domainFit;
  if (domainFit < 7) domainFit = 7;
  else if (domainFit === 7 && /\b(agent|agents|evaluation|evals)\b/i.test(blob)) domainFit = 8;
  domainFit = Math.min(10, domainFit);
  if (domainFit === score.domainFit) return score;
  const next = { ...score, domainFit };
  return { ...next, total: sumScoreParts(next) };
}

/**
 * Calibrate stack (≈16–17) and functional (≈8–9) for applied-AI roles when JD + profile align.
 * Python-primary is one stack caveat only — do not compound into functional collapse when RAG/API/TS overlap exists.
 */
export function applyAppliedAiStackFunctionalCalibration(params: {
  score: ScoreBreakdown;
  extracted: ExtractedJobData;
  userProfile: UserProfile;
  rules: RuleEvaluation;
}): ScoreBreakdown {
  const { score, extracted, userProfile, rules } = params;
  if (rules.domainMismatch || rules.stackMismatch) return score;
  /** Do not inflate stack for applied-AI overlap when mature employer + explicit core-language gate applies. */
  if (rules.explicitCoreLanguageMismatch) return score;
  /** Builder-first FDE / growth roles: post-process caps scores; skip stack inflation here. */
  if (rules.fdeBuilderSoftwarePrimary) return score;
  /** Generic thin AI startup JDs: do not inflate stack/functional from broad AI overlap alone. */
  if (rules.vagueEarlyStageAiCalibration) return score;
  const blob = jobTextBlob(extracted);
  if (!jdHasAppliedAiSystemsOverlap(blob) || !profileHasAiToolingEvidence(userProfile)) return score;

  const compensatingOverlap =
    /\b(rag|llm|vector|embedding|rest\s*api|api\b|typescript|javascript|node\.?js|react|integration|applied ai|generative ai|ai workflow)\b/i.test(
      blob,
    );
  if (!compensatingOverlap) return score;

  const pythonOverwhelming =
    /\bpython\b/i.test(blob) &&
    !/\btypescript|javascript|node\.?js\b/i.test(blob) &&
    /\b(primary\s+language|python[-\s]first|expert\s+in\s+python|strong\s+python)\b/i.test(blob);

  let stackFit = score.stackFit;
  let functionalOverlap = score.functionalOverlap;

  if (stackFit < 16) {
    stackFit = pythonOverwhelming ? 16 : 17;
  } else if (stackFit === 16 && !pythonOverwhelming) {
    stackFit = 17;
  }

  const jdRichFunctional =
    (/\b(workflow|retrieval|rag\b|agents?|evals?|integration|customer[-\s]facing|production|iterate|system)\b/i.test(
      blob,
    ) &&
      /\b(llm|ai system|applied ai|generative)\b/i.test(blob)) ||
    /\b(end[-\s]?to[-\s]?end).{0,40}\b(ai|llm|workflow)\b/i.test(blob);

  if (jdRichFunctional && functionalOverlap < 8) {
    functionalOverlap = 8;
  }
  if (jdRichFunctional && functionalOverlap === 8 && !pythonOverwhelming) {
    functionalOverlap = 9;
  }

  stackFit = Math.min(25, stackFit);
  functionalOverlap = Math.min(10, functionalOverlap);

  if (stackFit === score.stackFit && functionalOverlap === score.functionalOverlap) return score;
  const next = { ...score, stackFit, functionalOverlap };
  return { ...next, total: sumScoreParts(next) };
}

/**
 * Mature employer + explicit core-language mismatch: pull stack/recruiter-screen realism down
 * so strong domain/story cannot fully offset a hard language gate (target low–mid 70s total).
 */
export function applyMatureExplicitLanguageCalibration(params: {
  score: ScoreBreakdown;
  rules: RuleEvaluation;
}): ScoreBreakdown {
  if (!params.rules.explicitCoreLanguageMismatch) return params.score;
  let next = { ...params.score };
  next.stackFit = Math.min(next.stackFit, 14);
  next.levelFit = Math.min(next.levelFit, 9);
  next.recruiterFriendliness = Math.min(next.recruiterFriendliness, 8);
  next.functionalOverlap = Math.min(next.functionalOverlap, 9);
  next.careerValue = Math.min(next.careerValue, 10);
  let total = sumScoreParts(next);
  while (total > 74 && next.stackFit > 12) {
    next = { ...next, stackFit: next.stackFit - 1 };
    total = sumScoreParts(next);
  }
  while (total > 74 && next.recruiterFriendliness > 6) {
    next = { ...next, recruiterFriendliness: next.recruiterFriendliness - 1 };
    total = sumScoreParts(next);
  }
  while (total > 74 && next.levelFit > 7) {
    next = { ...next, levelFit: next.levelFit - 1 };
    total = sumScoreParts(next);
  }
  while (total > 74 && next.functionalOverlap > 7) {
    next = { ...next, functionalOverlap: next.functionalOverlap - 1 };
    total = sumScoreParts(next);
  }
  return { ...next, total };
}

/**
 * Forward-deployed / growth title without external customer-implementation core:
 * keep strong fit in the mid-80s (not 90+) — builder lane vs solutions consulting.
 */
export function applyFdeBuilderScoreCalibration(params: {
  score: ScoreBreakdown;
  rules: RuleEvaluation;
}): ScoreBreakdown {
  if (!params.rules.fdeBuilderSoftwarePrimary) return params.score;
  let next = { ...params.score };
  next.stackFit = Math.min(20, next.stackFit);
  next.levelFit = Math.min(12, next.levelFit);
  next.domainFit = Math.min(8, next.domainFit);
  next.resumeStoryClarity = Math.min(15, next.resumeStoryClarity);
  next.functionalOverlap = Math.min(9, next.functionalOverlap);
  next.recruiterFriendliness = Math.min(12, next.recruiterFriendliness);
  next.careerValue = Math.min(10, next.careerValue);

  type Dim = keyof Omit<ScoreBreakdown, "total">;
  const order: Dim[] = [
    "stackFit",
    "recruiterFriendliness",
    "levelFit",
    "functionalOverlap",
    "domainFit",
    "careerValue",
    "resumeStoryClarity",
  ];
  const mins: Partial<Record<Dim, number>> = {
    stackFit: 17,
    recruiterFriendliness: 8,
    levelFit: 10,
    functionalOverlap: 7,
    domainFit: 6,
    careerValue: 7,
    resumeStoryClarity: 14,
  };

  let total = sumScoreParts(next);
  let guard = 0;
  while (total > 86 && guard < 80) {
    guard += 1;
    let progressed = false;
    for (const key of order) {
      const minV = mins[key] ?? 0;
      if (next[key] > minV) {
        next = { ...next, [key]: (next[key] as number) - 1 } as ScoreBreakdown;
        total = sumScoreParts(next);
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
  }
  return { ...next, total };
}

const KNOWN_STRONG_EMPLOYER_RE =
  /\b(google|alphabet|meta|facebook|amazon|aws|microsoft|apple|netflix|uber|spotify|salesforce|oracle|ibm|stripe|airbnb|databricks|palantir|openai|anthropic|goldman|jpmorgan|jp\s*morgan|bloomberg)\b/i;

/**
 * Vague entry-level applied-AI startup posting: small total trim, recruiter cap, domain already handled in domain pass.
 */
export function applyVagueEarlyStageAiCalibration(params: {
  score: ScoreBreakdown;
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
}): ScoreBreakdown {
  if (!params.rules.vagueEarlyStageAiCalibration) return params.score;
  const blob = jobTextBlob(params.extracted);
  const strongCompany = KNOWN_STRONG_EMPLOYER_RE.test(normalizeText(params.extracted.company ?? ""));
  const stackStrong = !params.rules.stackMismatch && params.score.stackFit >= 19;
  const referralSignal = /\b(referral|employee referral|internal referral)\b/i.test(blob);
  const escapeRecruiterCap = strongCompany || stackStrong || referralSignal;

  let next = { ...params.score };
  if (!escapeRecruiterCap) {
    next.recruiterFriendliness = Math.min(next.recruiterFriendliness, 10);
  }
  type Dim = keyof Omit<ScoreBreakdown, "total">;
  const order: Dim[] = [
    "stackFit",
    "functionalOverlap",
    "careerValue",
    "levelFit",
    "resumeStoryClarity",
    "recruiterFriendliness",
    "domainFit",
  ];
  const mins: Partial<Record<Dim, number>> = {
    stackFit: 12,
    functionalOverlap: 5,
    careerValue: 5,
    levelFit: 6,
    resumeStoryClarity: 10,
    recruiterFriendliness: 7,
    domainFit: 5,
  };

  let total = sumScoreParts(next);
  let targetDrop = 4;
  let guard = 0;
  while (total > 0 && targetDrop > 0 && guard < 40) {
    guard += 1;
    let progressed = false;
    for (const key of order) {
      const minV = mins[key] ?? 0;
      if (next[key] > minV) {
        next = { ...next, [key]: (next[key] as number) - 1 } as ScoreBreakdown;
        total = sumScoreParts(next);
        targetDrop -= 1;
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
  }
  return { ...next, total };
}

export function appendMatureLanguageShotGuidance(topMatch: string, rules: RuleEvaluation): string {
  if (!rules.explicitCoreLanguageMismatch || !rules.matureStructuredEmployer) return topMatch;
  const lab =
    rules.explicitCoreLanguage === "java"
      ? "Java"
      : rules.explicitCoreLanguage === "go"
        ? "Go"
        : rules.explicitCoreLanguage === "python"
          ? "Python"
          : "the stated core language";
  const tail = `Apply, but treat as a lower-probability shot because the explicit ${lab} backend requirement is a major recruiter-screen risk.`;
  const base = topMatch.trim();
  if (!base) return tail;
  if (/\blower[-\s]?probability\b/i.test(base)) return base;
  return `${base.replace(/\.\s*$/, "")}. ${tail}`;
}

export function polishScoringNarrative(params: {
  narrative: Pick<ScoringNarrative, "topMatch" | "mainRisk" | "risks" | "rationale">;
  score: ScoreBreakdown;
  extracted: ExtractedJobData;
  userProfile: UserProfile;
  rules: RuleEvaluation;
}): ScoringNarrative {
  const travelLine = travelRiskLine(jobTextBlob(params.extracted));
  const { mainRisk, risks } = polishRisksAndMain({
    mainRisk: params.narrative.mainRisk,
    risks: params.narrative.risks,
    extracted: params.extracted,
    travelLine,
    max: 2,
    rules: params.rules,
  });
  const rationale = polishRationaleBullets(params.narrative.rationale, 2);
  let score = applyAppliedAiDomainFloor({
    score: params.score,
    extracted: params.extracted,
    userProfile: params.userProfile,
    rules: params.rules,
  });
  score = applyAppliedAiStackFunctionalCalibration({
    score,
    extracted: params.extracted,
    userProfile: params.userProfile,
    rules: params.rules,
  });
  score = applyMatureExplicitLanguageCalibration({ score, rules: params.rules });
  score = applyFdeBuilderScoreCalibration({ score, rules: params.rules });
  score = applyVagueEarlyStageAiCalibration({
    score,
    extracted: params.extracted,
    rules: params.rules,
  });
  const rawTop = params.narrative.topMatch?.trim() ?? "";
  const topMatch = appendMatureLanguageShotGuidance(
    rawTop ? sanitizeNarrativeSentence(rawTop, 50) : rawTop,
    params.rules,
  );
  return { score, topMatch, mainRisk, risks, rationale };
}
