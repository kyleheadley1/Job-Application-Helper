import { describe, expect, it } from "vitest";

/** Mirror of web priority sort — keep in sync with apps/web/src/lib/topJobsSort.ts */
function fitScore(total: number): number {
  return Math.min(100, Math.max(0, total)) / 100;
}

function recencyMultiplier(postedAt: string, nowMs = Date.now()): number {
  const postedMs = new Date(postedAt).getTime();
  if (Number.isNaN(postedMs)) return 0.1;

  const ageMs = Math.max(0, nowMs - postedMs);
  const ageHours = ageMs / (60 * 60 * 1000);
  const ageDays = ageHours / 24;

  if (ageHours <= 12) return 1.0;
  if (ageHours <= 24) return 0.85;
  if (ageHours <= 48) return 0.6;
  if (ageDays <= 5) return 0.3;
  return 0.1;
}

function priorityRankScore(scoreTotal: number, postedAt: string, nowMs = Date.now()): number {
  return fitScore(scoreTotal) * recencyMultiplier(postedAt, nowMs);
}

describe("topJobs multiplicative priority sort", () => {
  const now = new Date("2026-06-08T12:00:00.000Z").getTime();

  it("uses stepwise recency multipliers", () => {
    expect(recencyMultiplier("2026-06-08T06:00:00.000Z", now)).toBe(1.0);
    expect(recencyMultiplier("2026-06-07T14:00:00.000Z", now)).toBe(0.85);
    expect(recencyMultiplier("2026-06-06T14:00:00.000Z", now)).toBe(0.6);
    expect(recencyMultiplier("2026-06-04T12:00:00.000Z", now)).toBe(0.3);
    expect(recencyMultiplier("2026-05-20T12:00:00.000Z", now)).toBe(0.1);
  });

  it("scenario A: 95% fit at 6 days is deprioritized (~0.095)", () => {
    const posted = "2026-06-02T12:00:00.000Z";
    expect(priorityRankScore(95, posted, now)).toBeCloseTo(0.095, 3);
  });

  it("prefers fresh strong fit over stale elite fit", () => {
    const freshGood = priorityRankScore(82, "2026-06-08T06:00:00.000Z", now);
    const staleGreat = priorityRankScore(95, "2026-06-02T12:00:00.000Z", now);
    expect(freshGood).toBeCloseTo(0.82, 3);
    expect(staleGreat).toBeCloseTo(0.095, 3);
    expect(freshGood).toBeGreaterThan(staleGreat);
  });

  it("does not apply sub-78 fit gate in rank — ingest already filters at 78+", () => {
    // A hypothetical 60% fit would rank 0 × recency; only relevant outside Top Jobs ingest.
    expect(priorityRankScore(60, "2026-06-08T06:00:00.000Z", now)).toBeCloseTo(0.6, 3);
  });
});
