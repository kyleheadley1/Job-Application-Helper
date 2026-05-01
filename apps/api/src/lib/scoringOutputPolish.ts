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
    return `Significant travel (${label}); confirm it fits your lifestyle vs hybrid/office cadence.`;
  }
  return `Travel requirement (${label}); confirm it fits your schedule and hybrid/office expectations.`;
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
  const t = risk.toLowerCase();
  if (!/\b(enterprise|domain|industry|vertical)\b/.test(t)) return false;
  if (!/\b(lack|limited|missing|gap|no |without|insufficient|weak|light)\b/.test(t)) return false;
  return true;
};

const riskPriority = (risk: string, jdBlob: string): number => {
  const t = normalizeText(risk);
  /** Third-priority stretch risk: after Python/stack and travel/hybrid. */
  if (
    /customer[-\s]?facing production ai systems/i.test(t) &&
    /slightly above current experience/i.test(t)
  ) {
    return 84;
  }
  let p = 50;
  // Decision-blocker order: language/stack → level/ownership → travel (25%+) → travel (lower) → onsite/hybrid
  if (/\bpython\b/.test(t) && /\b(type ?script|javascript|node|primary|first)\b/.test(t)) p = 100;
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
  "Role expects ownership of customer-facing production AI systems, which may be slightly above current experience level.";

export function polishRisksAndMain(params: {
  mainRisk: string;
  risks: string[];
  extracted: ExtractedJobData;
  travelLine?: string;
  max?: number;
}): { mainRisk: string; risks: string[] } {
  const jdBlob = jobTextBlob(params.extracted);
  const max = params.max ?? 3;
  const rawList = [params.mainRisk, ...(params.risks ?? [])].filter((x): x is string => Boolean(x?.trim()));
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
    params.mainRisk.trim() || "Recruiter-screen realism; confirm fit in conversation.";
  return {
    mainRisk: top[0] ?? fallbackMain,
    risks: top.length > 1 ? top.slice(1) : [],
  };
}

const PROOF_HINT =
  /\b(shipped|built|implemented|delivered|owned|codesmith|project|production|internship|experience|profile|flagship|led|scaled)\b/i;
/** Capability / fit angle (avoid treating proof verbs as the primary "why" line). */
const CAPABILITY_HINT =
  /\b(overlap|align|match|fit|role|scope|stack|workflow|systems|shape|readiness|strength)\b/i;

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
  let t = text.trim().replace(/,\s*$/, "").replace(/\s+$/, "");
  t = t.replace(/\s*\b(and|or)\s*$/i, "").trim();
  if (t.length < minLen && /(llm|rag|applied[-\s]?ai|ai workflow)/i.test(t)) {
    if (!/\b(integration|end[-\s]to[-\s]end|workflow experience)\b/i.test(t)) {
      t = `${t.replace(/[.,;]$/, "")}, with API integration and end-to-end AI workflow experience`;
    }
  }
  return t.replace(/,\s*$/, "").trim();
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
  const capability =
    nonProof.find((r) => CAPABILITY_HINT.test(r)) ??
    nonProof[0] ??
    deduped.find((r) => CAPABILITY_HINT.test(r)) ??
    deduped[0];
  const proof =
    proofLines.find((p) => p !== capability && !similarSentence(p, capability)) ??
    deduped.find((r) => r !== capability);

  const out: string[] = [];
  if (capability) out.push(capability);
  if (proof && proof !== capability) out.push(dampDuplicateAppliedAiPhrasing(capability, proof));
  for (const r of deduped) {
    if (out.length >= max) break;
    const adj = out.length === 1 && out[0] ? dampDuplicateAppliedAiPhrasing(out[0], r) : r;
    if (out.some((x) => x === r || similarSentence(x, adj))) continue;
    out.push(adj);
  }
  const sliced = out.slice(0, max).map((s) => sanitizeNarrativeSentence(s));
  if (sliced.length === 2) {
    sliced[1] = sanitizeNarrativeSentence(dampDuplicateAppliedAiPhrasing(sliced[0], sliced[1]));
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
  });
  const rationale = polishRationaleBullets(params.narrative.rationale, 2);
  const rawTop = params.narrative.topMatch?.trim() ?? "";
  const topMatch = rawTop ? sanitizeNarrativeSentence(rawTop, 50) : rawTop;
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
  return { score, topMatch, mainRisk, risks, rationale };
}
