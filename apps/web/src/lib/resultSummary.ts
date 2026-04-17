import type { JobRecord } from "../types/job";

const RISK_CONCEPTS: Array<{ concept: string; re: RegExp }> = [
  { concept: "stack_gap", re: /\b(go|language|stack|framework|tooling|tech gap|experience with)\b/i },
  { concept: "scale_infra", re: /\b(scale|internet[-\s]?scale|infra|infrastructure|performance|production systems)\b/i },
  { concept: "domain_business", re: /\b(domain|ecommerce|revenue|business impact|data science|ml|market)\b/i },
  { concept: "screen_process", re: /\b(screen|process|degree|bachelor|assessment|pipeline|sponsorship|citizenship|clearance)\b/i },
  { concept: "location_logistics", re: /\b(location|hybrid|onsite|commute|timezone|office)\b/i },
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
  let score = Math.min(30, t.length);
  if (/\b(required|hard|must|cannot|no\b|limited)\b/.test(t)) score += 8;
  if (/\b(go|scale|degree|sponsorship|citizenship|onsite|location)\b/.test(t)) score += 5;
  return score;
};

export function selectTopFits(job: JobRecord, n = 2): string[] {
  const items = [job.topMatch, ...job.rationale].map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = normalizeText(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= n) break;
  }
  return out;
}

export function selectDistinctRisks(job: JobRecord, n = 2): string[] {
  const items = [job.mainRisk, ...job.risks].map((s) => s.trim()).filter(Boolean);
  const deduped: Array<{ text: string; concept: string; strength: number }> = [];
  for (const item of items) {
    const concept = conceptForRisk(item);
    const strength = riskStrength(item);
    const matchIdx = deduped.findIndex(
      (d) => d.concept === concept && (similarRisk(d.text, item) || normalizeText(d.text) === normalizeText(item)),
    );
    if (matchIdx >= 0) {
      if (strength > deduped[matchIdx].strength) deduped[matchIdx] = { text: item, concept, strength };
      continue;
    }
    deduped.push({ text: item, concept, strength });
  }
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
  const base = job.topMatch.trim();
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
