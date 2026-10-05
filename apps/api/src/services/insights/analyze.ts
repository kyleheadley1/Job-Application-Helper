import { RECOMMENDATION_LABELS } from "../../config/capabilitySurvivabilityPolicy.js";
import { recommendationForScore } from "../../lib/compositeScoring.js";
import { MAX_POINTS_PER_ADJUSTMENT } from "../../lib/historyAdjustments.js";
import { RECOMMENDATIONS } from "../../types/scoring.js";
import type { InsightRow } from "./dataset.js";
import { FEATURES, type Feature } from "./features.js";
import { auc, aucPermutationP, benjaminiHochberg, fisherExact, wilson, type Interval } from "./stats.js";

/** Smallest group compared at all, and the size a pattern needs before it can be called. */
export const MIN_SHOWN = 8;
export const MIN_CALLABLE = 15;
/** Positives (or, for a low-response group, expected positives) needed before a pattern can be called. */
export const MIN_POSITIVES = 4;
export const MIN_DIFF_PP = 10;
export const CONCLUSIVE_Q = 0.05;
export const SUGGESTIVE_Q = 0.2;
export const GOOD_FIT = 65;

export type Verdict = "conclusive" | "suggestive" | "no_signal";

export type PatternRow = {
  feature: string;
  featureLabel: string;
  bucket: string;
  scorable: boolean;
  k: number;
  n: number;
  rate: Interval;
  restK: number;
  restN: number;
  restRate: number;
  diffPp: number;
  p: number;
  q: number;
  verdict: Verdict;
};

export type ScoreBand = { band: string; k: number; n: number; rate: Interval };

export type ProposedAdjustment = {
  id: string;
  feature: string;
  featureLabel: string;
  bucket: string;
  points: number;
  evidence: { k: number; n: number; rate: number; restRate: number; diffPp: number; q: number };
};

export type InsightsAnalysis = {
  generatedAt: string;
  counts: { applications: number; positive: number; negative: number; tooEarly: number; decided: number; withFit: number };
  baseRate: Interval & { k: number; n: number };
  scoreBands: ScoreBand[];
  scorePredicts: { auc: number; p: number; n: number; verdict: Verdict; note: string };
  patterns: PatternRow[];
  goodFit: { k: number; n: number; rate: Interval; patterns: PatternRow[] };
  proposals: ProposedAdjustment[];
  conclusion: Verdict;
  headline: string;
};

const pct = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`;

export const VERDICT_WORDS: Record<Verdict, string> = {
  conclusive: "conclusive",
  suggestive: "worth watching",
  no_signal: "no signal",
};

const verdictFor = (row: Omit<PatternRow, "verdict" | "q">, q: number, baseRate: number): Verdict => {
  const big = row.n >= MIN_CALLABLE && row.restN >= MIN_CALLABLE;
  const higher = row.rate.rate > row.restRate;
  const enoughPositives = higher ? row.k >= MIN_POSITIVES : row.n * baseRate >= MIN_POSITIVES;
  if (!big || !enoughPositives || Math.abs(row.diffPp) < MIN_DIFF_PP) return "no_signal";
  if (q < CONCLUSIVE_Q) return "conclusive";
  if (q < SUGGESTIVE_Q) return "suggestive";
  return "no_signal";
};

/** Every feature bucket vs the rest of the rows that have that feature, with multiple-comparison control. */
export const comparePatterns = (rows: InsightRow[], features: Feature[] = FEATURES): PatternRow[] => {
  const decided = rows.filter((r) => r.outcome !== "too_early");
  const k0 = decided.filter((r) => r.outcome === "positive").length;
  const baseRate = decided.length ? k0 / decided.length : 0;
  const raw: Array<Omit<PatternRow, "verdict" | "q">> = [];
  for (const f of features) {
    const tagged = decided.map((r) => ({ r, values: f.values(r) })).filter((x) => x.values.length > 0);
    const buckets = new Set(tagged.flatMap((x) => x.values));
    for (const bucket of buckets) {
      const inB = tagged.filter((x) => x.values.includes(bucket));
      const rest = tagged.filter((x) => !x.values.includes(bucket));
      if (inB.length < MIN_SHOWN || rest.length < MIN_SHOWN) continue;
      const k = inB.filter((x) => x.r.outcome === "positive").length;
      const restK = rest.filter((x) => x.r.outcome === "positive").length;
      const rate = wilson(k, inB.length);
      const restRate = restK / rest.length;
      raw.push({
        feature: f.key,
        featureLabel: f.label,
        bucket,
        scorable: f.scorable,
        k,
        n: inB.length,
        rate,
        restK,
        restN: rest.length,
        restRate,
        diffPp: Math.round((rate.rate - restRate) * 1000) / 10,
        p: fisherExact(k, inB.length - k, restK, rest.length - restK),
      });
    }
  }
  const q = benjaminiHochberg(raw.map((r) => r.p));
  return raw
    .map((r, i) => ({ ...r, q: q[i]!, verdict: verdictFor(r, q[i]!, baseRate) }))
    .sort((a, b) => a.q - b.q || Math.abs(b.diffPp) - Math.abs(a.diffPp));
};

const pointsFor = (diffPp: number) =>
  Math.sign(diffPp) * Math.min(MAX_POINTS_PER_ADJUSTMENT, Math.max(1, Math.round(Math.abs(diffPp) / 5)));

const headlineFor = (a: Omit<InsightsAnalysis, "headline" | "conclusion">): string => {
  if (a.baseRate.n === 0) return "No decided applications yet.";
  const base = `${a.baseRate.k} of ${a.baseRate.n} decided applications led to a call or interview (${pct(a.baseRate.rate)}).`;
  const top = a.scoreBands[0];
  const score =
    a.scorePredicts.verdict === "conclusive"
      ? ` Your fit score does predict callbacks${top && top.n > 0 ? ` (${top.band}: ${pct(top.rate.rate)})` : ""}.`
      : a.scorePredicts.verdict === "suggestive"
        ? " Higher fit scores may get more callbacks, but it isn't conclusive."
        : "";
  const all = [...a.patterns, ...a.goodFit.patterns];
  const clear = all.find((p) => p.verdict === "conclusive");
  if (clear) {
    return `${base}${score} Clear pattern: ${clear.featureLabel} = ${clear.bucket} (${pct(clear.rate.rate)} vs ${pct(clear.restRate)}).`;
  }
  if (all.some((p) => p.verdict === "suggestive")) return `${base}${score} Some patterns are worth watching, but none is conclusive yet.`;
  return score
    ? `${base}${score} Beyond the score, no trait stands out from chance.`
    : `${base} No pattern stands out from chance: callbacks look mostly random with respect to everything measured.`;
};

const strongest = (verdicts: Verdict[]): Verdict =>
  verdicts.includes("conclusive") ? "conclusive" : verdicts.includes("suggestive") ? "suggestive" : "no_signal";

export const analyzeInsights = (rows: InsightRow[], now = new Date()): InsightsAnalysis => {
  const decided = rows.filter((r) => r.outcome !== "too_early");
  const positive = decided.filter((r) => r.outcome === "positive").length;
  const withFit = decided.filter((r) => r.fit != null);

  const scoreBands: ScoreBand[] = RECOMMENDATIONS.map((rec) => {
    const inBand = withFit.filter((r) => recommendationForScore(r.fit!) === rec);
    const k = inBand.filter((r) => r.outcome === "positive").length;
    return { band: RECOMMENDATION_LABELS[rec], k, n: inBand.length, rate: wilson(k, inBand.length) };
  });

  const scores = withFit.map((r) => r.fit!);
  const labels = withFit.map((r) => r.outcome === "positive");
  const fitPositives = labels.filter(Boolean).length;
  const aucValue = auc(scores, labels);
  const aucP = fitPositives >= MIN_POSITIVES && fitPositives < labels.length ? aucPermutationP(scores, labels) : 1;
  const scoreVerdict: Verdict =
    fitPositives < MIN_POSITIVES ? "no_signal" : aucP < CONCLUSIVE_Q ? "conclusive" : aucP < SUGGESTIVE_Q ? "suggestive" : "no_signal";
  const scoreNote =
    scoreVerdict === "conclusive"
      ? `Higher scores do get more callbacks (AUC ${aucValue.toFixed(2)}).`
      : scoreVerdict === "suggestive"
        ? `Higher scores may get slightly more callbacks (AUC ${aucValue.toFixed(2)}), but it isn't conclusive.`
        : `The score doesn't separate callbacks from silence better than chance (AUC ${aucValue.toFixed(2)}; 0.5 = coin flip).`;

  const patterns = comparePatterns(rows);
  const good = rows.filter((r) => r.fit != null && r.fit >= GOOD_FIT);
  const goodDecided = good.filter((r) => r.outcome !== "too_early");
  const goodK = goodDecided.filter((r) => r.outcome === "positive").length;
  const goodPatterns = comparePatterns(good, FEATURES.filter((f) => f.key !== "tier"));

  const proposals: ProposedAdjustment[] = patterns
    .filter((p) => p.verdict === "conclusive" && p.scorable)
    .map((p) => ({
      id: `${p.feature}=${p.bucket}`,
      feature: p.feature,
      featureLabel: p.featureLabel,
      bucket: p.bucket,
      points: pointsFor(p.diffPp),
      evidence: { k: p.k, n: p.n, rate: p.rate.rate, restRate: p.restRate, diffPp: p.diffPp, q: p.q },
    }));

  const partial = {
    generatedAt: now.toISOString(),
    counts: {
      applications: rows.length,
      positive,
      negative: decided.length - positive,
      tooEarly: rows.length - decided.length,
      decided: decided.length,
      withFit: withFit.length,
    },
    baseRate: { ...wilson(positive, decided.length), k: positive, n: decided.length },
    scoreBands,
    scorePredicts: { auc: aucValue, p: aucP, n: withFit.length, verdict: scoreVerdict, note: scoreNote },
    patterns,
    goodFit: { k: goodK, n: goodDecided.length, rate: wilson(goodK, goodDecided.length), patterns: goodPatterns },
    proposals,
  };
  const conclusion = strongest([scoreVerdict, ...patterns.map((p) => p.verdict), ...goodPatterns.map((p) => p.verdict)]);
  return { ...partial, conclusion, headline: headlineFor(partial) };
};
