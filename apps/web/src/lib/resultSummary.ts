import type { JobRecord } from "../types/job";
import { companyDisplayLabel } from "./jobDisplay";
import { sanitizeRoleCardLine } from "./riskDisplaySanitizer";

const RISK_CONCEPTS: Array<{ concept: string; re: RegExp }> = [
  { concept: "stack_gap", re: /\b(go|language|stack|framework|tooling|tech gap|experience with|python)\b/i },
  { concept: "scale_infra", re: /\b(scale|internet[-\s]?scale|infra|infrastructure|performance|production systems)\b/i },
  { concept: "domain_business", re: /\b(domain|ecommerce|revenue|business impact|data science|ml|market)\b/i },
  { concept: "screen_process", re: /\b(screen|process|degree|bachelor|assessment|pipeline|sponsorship|citizenship|clearance)\b/i },
  { concept: "travel_lifestyle", re: /\b(travel|25\s*%|30\s*%|40\s*%|50\s*%)\b/i },
  { concept: "location_logistics", re: /\b(location|hybrid|onsite|commute|timezone|office|days?\s+per\s+week)\b/i },
];

const MATCH_PRIORITIES: Array<{ label: string; re: RegExp }> = [
  { label: "early-career builder growth", re: /\b(early[-\s]?career|entry[-\s]?level|junior|builder)\b/i },
  { label: "AI tooling acceleration", re: /\b(ai tooling|automation|llm|ai[-\s]?driven|ai[-\s]?enabled)\b/i },
  { label: "full-stack product ownership", re: /\b(full[-\s]?stack|product lifecycle|ownership|product features)\b/i },
  { label: "cross-functional collaboration", re: /\b(product managers?|designers?|cross[-\s]?functional|stakeholder)\b/i },
  { label: "higher-scale systems exposure", re: /\b(scale|billions|internet[-\s]?scale|production systems)\b/i },
];

const normalizeText = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const NEGATIVE_RE = /\b(but|however|though|while|lack|lacking|limited|gap|missing|risk|cannot|can't|do not|don't|without|no\b)\b/i;
const POSITIVE_RE = /\b(strong|fit|overlap|align|match|good|relevant|clear|experience|ownership|collaboration|growth)\b/i;
const CONTRAST_SPLIT_RE = /\b(?:but|however|though|while)\b/i;

const classifyReason = (text: string): "positive" | "negative" | "mixed" | "neutral" => {
  const t = text.trim();
  if (!t) return "neutral";
  const hasNeg = NEGATIVE_RE.test(t);
  const hasPos = POSITIVE_RE.test(t);
  if (hasNeg && hasPos) return "mixed";
  if (hasNeg) return "negative";
  if (hasPos) return "positive";
  return "neutral";
};

const splitMixedReason = (text: string): { positive?: string; negative?: string } => {
  const parts = text.split(CONTRAST_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return {};
  const left = parts[0];
  const right = parts.slice(1).join(" ").trim();
  if (classifyReason(left) === "positive" && classifyReason(right) !== "positive") {
    return { positive: left.replace(/[,:;\-]\s*$/, ""), negative: right };
  }
  return {};
};

const conceptForRisk = (risk: string): string => {
  for (const entry of RISK_CONCEPTS) {
    if (entry.re.test(risk)) return entry.concept;
  }
  return "other";
};

const tokenSet = (s: string): Set<string> =>
  new Set(
    normalizeText(s)
      .split(" ")
      .filter((t) => t.length > 2),
  );

const similarRisk = (a: string, b: string): boolean => {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const overlap = inter / Math.max(A.size, B.size);
  return overlap >= 0.72;
};

const riskStrength = (risk: string): number => {
  const t = normalizeText(risk);
  const concept = conceptForRisk(risk);
  let score =
    concept === "stack_gap"
      ? 30
      : concept === "scale_infra"
        ? 28
        : concept === "travel_lifestyle"
          ? 26
        : concept === "domain_business"
          ? 20
          : concept === "location_logistics"
            ? 16
            : concept === "screen_process"
              ? 12
              : 10;
  if (/\b(required|hard|must|cannot|limited|strongly preferred)\b/.test(t)) score += 8;
  if (/\bnamed tool\/platform\b/.test(t) || /\bno experience found in your background\b/.test(t)) score += 18;
  if (/\b(go|language|stack)\b/.test(t)) score += 8;
  if (/\b(scale|internet scale|infrastructure|production systems)\b/.test(t)) score += 7;
  return score;
};

const PROOF_BULLET_HINT =
  /\b(shipped|built|implemented|delivered|owned|project|production|internship|codesmith|flagship|experience|tooling|led|scaled)\b/i;
/** Line 1 = strategic fit; avoid treating duplicate LLM/RAG tokens as two independent positives. */
const CAPABILITY_BULLET_HINT =
  /\b(overlap|align|match|fit|role|scope|workflow|systems|stack|readiness|shape|strength)\b/i;

const appliedAiOverlapRe =
  /\b(llm|rag|vector\s+(search|embedding)|rest\s*api|applied[-\s]?ai)\b/gi;

function dampWhyConsiderSecond(first: string, second: string): string {
  const f = (first.match(appliedAiOverlapRe) ?? []).length;
  const s = (second.match(appliedAiOverlapRe) ?? []).length;
  if (f < 2 || s < 2) return second;
  let t = second.replace(/^\s*(strong\s+|clear\s+)?(applied[-\s]?ai\s+)?(product\s+)?/i, "");
  t = t.replace(/\s+/g, " ").trim();
  return t.length >= 28 ? t : second;
}

export function selectTopFits(job: JobRecord, n = 2): string[] {
  const items = [job.topMatch, ...job.rationale].map((s) => s.trim()).filter(Boolean);
  const positives: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const split = splitMixedReason(item);
    const candidate = split.positive ?? item;
    if (classifyReason(candidate) === "negative") continue;
    const cleaned = candidate.replace(/\s*(but|however|though|while)\b.*$/i, "").trim();
    const key = normalizeText(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    positives.push(cleaned);
  }
  const proofCandidates = positives.filter((p) => PROOF_BULLET_HINT.test(p));
  const nonProof = positives.filter((p) => !PROOF_BULLET_HINT.test(p));
  const capability =
    nonProof.find((p) => CAPABILITY_BULLET_HINT.test(p)) ??
    nonProof[0] ??
    positives.find((p) => CAPABILITY_BULLET_HINT.test(p));
  const proof =
    proofCandidates.find((p) => p !== capability) ?? positives.find((p) => p !== capability);
  const out: string[] = [];
  if (capability) out.push(capability);
  if (proof && proof !== capability) out.push(dampWhyConsiderSecond(capability ?? "", proof));
  for (const p of positives) {
    if (out.includes(p)) continue;
    out.push(out.length === 1 ? dampWhyConsiderSecond(out[0], p) : p);
    if (out.length >= n) break;
  }
  const slice = out.slice(0, n);
  if (slice.length === 2) slice[1] = dampWhyConsiderSecond(slice[0], slice[1]);
  return slice.map((s) => sanitizeRoleCardLine(s, companyDisplayLabel(job.extracted)));
}

/** Merge LLM-scored risks with soft rule notes (hard gates use `rules.hardRuleNotes` separately). */
export function buildKeyRisks(job: JobRecord, max = 3): string[] {
  const namedToolNotes = (job.rules?.notes ?? []).filter((n) =>
    /JD requires named tool\/platform\b/i.test(n),
  );
  const namedToolNeedles = namedToolNotes
    .map((n) => {
      const m = n.match(/named tool\/platform\s+(.+?)\s+—/i);
      return normalizeText(m?.[1] ?? "");
    })
    .filter(Boolean);

  const llmRiskOverlapsNamedTool = (risk: string): boolean => {
    if (!namedToolNeedles.length) return false;
    const t = normalizeText(risk);
    if (namedToolNeedles.some((tool) => tool.length >= 3 && t.includes(tool))) return true;
    // Generic LLM paraphrase of the same gap ("No explicit TULIP Interfaces experience…").
    if (
      /\b(no explicit|no (?:listed|demonstrated)|lacks?|missing|without)\b/i.test(risk) &&
      /\bexperience\b/i.test(risk) &&
      namedToolNeedles.some((tool) => tool.split(/\s+/).some((w) => w.length >= 4 && t.includes(w)))
    ) {
      return true;
    }
    return false;
  };

  // Prefer the canonical named-tool Key Risk; drop overlapping LLM paraphrases so we don't
  // show two TULIP lines and bury them behind a softer degree mainRisk.
  const fromLlm = selectDistinctRisks(job, 2).filter((risk) => !llmRiskOverlapsNamedTool(risk));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of namedToolNotes) {
    const k = normalizeText(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  for (const n of fromLlm) {
    const k = normalizeText(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
    if (out.length >= max) break;
  }
  for (const n of job.rules?.notes ?? []) {
    if (namedToolNotes.includes(n)) continue;
    const k = normalizeText(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
    if (out.length >= max) break;
  }
  return out.slice(0, max).map((s) => sanitizeRoleCardLine(s, companyDisplayLabel(job.extracted)));
}

export function selectDistinctRisks(job: JobRecord, n = 2): string[] {
  const baseItems = [job.mainRisk, ...job.risks].map((s) => s.trim()).filter(Boolean);
  const items: string[] = [];
  for (const item of baseItems) {
    const split = splitMixedReason(item);
    if (split.negative) items.push(split.negative);
    if (classifyReason(item) !== "positive") items.push(item);
  }
  const jdText = normalizeText(
    [job.extracted.title, ...(job.extracted.requirements ?? []), ...(job.extracted.responsibilities ?? []), job.extracted.rawText ?? ""].join(" "),
  );
  const strictDegreeSignal = /\b(bachelor|degree)\b.*\b(required|must)\b|\brequired\b.*\b(bachelor|degree)\b/.test(jdText);
  const jdDeepDomain = /\b(deep\s+domain|subject\s+matter|industry\s+expert|10\+\s*years\s+in)\b/.test(jdText);
  const deduped: Array<{ text: string; concept: string; strength: number }> = [];
  for (const item of items) {
    const concept = conceptForRisk(item);
    let strength = riskStrength(item);
    const t = normalizeText(item);
    if (!strictDegreeSignal && /\b(degree|bachelor)\b/.test(t)) strength -= 9;
    if (strictDegreeSignal && /\b(degree|bachelor)\b/.test(t)) strength += 9;
    if (!jdDeepDomain && concept === "domain_business" && /\b(enterprise|domain expertise|industry)\b/.test(t)) strength -= 12;
    const matchIdx = deduped.findIndex(
      (d) => d.concept === concept && (similarRisk(d.text, item) || normalizeText(d.text) === normalizeText(item)),
    );
    if (matchIdx >= 0) {
      if (strength > deduped[matchIdx].strength) deduped[matchIdx] = { text: item, concept, strength };
      continue;
    }
    deduped.push({ text: item, concept, strength });
  }
  deduped.sort((a, b) => b.strength - a.strength);
  const out: string[] = [];
  const usedConcepts = new Set<string>();
  for (const r of deduped) {
    if (usedConcepts.has(r.concept) && deduped.some((x) => !usedConcepts.has(x.concept))) continue;
    out.push(r.text);
    usedConcepts.add(r.concept);
    if (out.length >= n) return out;
  }
  for (const r of deduped) {
    if (out.includes(r.text)) continue;
    out.push(r.text);
    if (out.length >= n) break;
  }
  return out.slice(0, n);
}

export function decisionSummaryLine(job: JobRecord): string {
  const base = job.topMatch.trim().replace(/\s*(but|however|though|while)\b.*$/i, "").replace(/\bcandidate\b/gi, "").trim();
  const combined = [job.extracted.title, ...(job.extracted.responsibilities ?? []), ...(job.extracted.requirements ?? [])]
    .join(" ")
    .trim();
  const priorities = MATCH_PRIORITIES.filter((p) => p.re.test(combined)).map((p) => p.label);
  const p1 = priorities[0];
  const p2 = priorities[1];
  const genericBase = /\bbackend[-\s]?leaning\b|\bfull[-\s]?stack\b.*\b(ai|llm)\b/i.test(base);
  if (!genericBase || (!p1 && !p2)) return base;

  const lead = /\b(early[-\s]?career|entry[-\s]?level|junior)\b/i.test(combined)
    ? "Strong early-career builder fit"
    : /\b(product|full[-\s]?stack)\b/i.test(combined)
      ? "Strong product-engineering fit"
      : "Strong role-shape fit";
  const details = [p1, p2].filter(Boolean).join(" and ");
  return details ? `${lead} with clear overlap in ${details}.` : base;
}

export function displayRoleTitle(rawTitle: string): string {
  const title = rawTitle.trim();
  if (!title) return title;
  const looksLikeRoleHeader =
    /\b(junior|entry[-\s]?level|early[-\s]?career|associate|software|full[-\s]?stack|backend|frontend|product)\b/i.test(
      title,
    ) && /\bengineers\b$/i.test(title);
  if (!looksLikeRoleHeader) return title;
  return title.replace(/\bEngineers\b$/, "Engineer");
}
