/** Small, dependency-free statistics for comparing response rates on a few hundred applications. */

export type Interval = { rate: number; lo: number; hi: number };

/** Wilson score interval for k successes in n trials (95% by default). */
export const wilson = (k: number, n: number, z = 1.96): Interval => {
  if (n <= 0) return { rate: 0, lo: 0, hi: 0 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { rate: p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
};

const logFactorials: number[] = [0];
const logFactorial = (n: number): number => {
  for (let i = logFactorials.length; i <= n; i++) logFactorials[i] = logFactorials[i - 1]! + Math.log(i);
  return logFactorials[n]!;
};

const logHypergeom = (a: number, row1: number, col1: number, total: number): number =>
  logFactorial(row1) +
  logFactorial(total - row1) +
  logFactorial(col1) +
  logFactorial(total - col1) -
  logFactorial(a) -
  logFactorial(row1 - a) -
  logFactorial(col1 - a) -
  logFactorial(total - row1 - col1 + a) -
  logFactorial(total);

/**
 * Two-sided Fisher's exact test for the 2x2 table [[a, b], [c, d]]: the summed probability of every
 * table with the same margins that is no more likely than the observed one.
 */
export const fisherExact = (a: number, b: number, c: number, d: number): number => {
  const row1 = a + b;
  const col1 = a + c;
  const total = a + b + c + d;
  if (total === 0) return 1;
  const observed = logHypergeom(a, row1, col1, total);
  const lo = Math.max(0, row1 + col1 - total);
  const hi = Math.min(row1, col1);
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    const lp = logHypergeom(x, row1, col1, total);
    if (lp <= observed + 1e-7) p += Math.exp(lp);
  }
  return Math.min(1, p);
};

/** Benjamini-Hochberg adjusted p-values (q-values), same order as the input. */
export const benjaminiHochberg = (pValues: number[]): number[] => {
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p);
  const q = new Array<number>(m);
  let running = 1;
  for (let rank = m; rank >= 1; rank--) {
    const { p, i } = order[rank - 1]!;
    running = Math.min(running, (p * m) / rank);
    q[i] = Math.min(1, running);
  }
  return q;
};

/** Area under the ROC curve (Mann-Whitney U / (n1 n0)), ties counted as half. */
export const auc = (scores: number[], labels: boolean[]): number => {
  const pos = scores.filter((_, i) => labels[i]);
  const neg = scores.filter((_, i) => !labels[i]);
  if (pos.length === 0 || neg.length === 0) return 0.5;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
};

/** Deterministic PRNG so a rerun on the same data gives the same p-value. */
const mulberry32 = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** One-sided permutation p-value for "the score ranks positives above negatives better than chance". */
export const aucPermutationP = (scores: number[], labels: boolean[], iterations = 2000, seed = 42): number => {
  const observed = auc(scores, labels);
  const rand = mulberry32(seed);
  const shuffled = [...labels];
  let atLeast = 0;
  for (let it = 0; it < iterations; it++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    if (auc(scores, shuffled) >= observed - 1e-12) atLeast += 1;
  }
  return (atLeast + 1) / (iterations + 1);
};
