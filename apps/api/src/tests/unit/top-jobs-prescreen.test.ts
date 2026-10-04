import { describe, expect, it, vi } from "vitest";
import { prescreenListings, type Prescreen } from "../../services/topJobs/prescreen.js";
import { applyPrescreen, emptySyncStats } from "../../services/topJobs/topJobsSync.js";
import type { AlertListingDoc } from "../../services/topJobs/alertListings.repository.js";

const listing = (id: string, over: Partial<AlertListingDoc> = {}): AlertListingDoc =>
  ({ _id: id, company: id, title: `Engineer ${id}`, location: null, ...over }) as AlertListingDoc;

const ok = (picks: Array<{ i: number; v: "score" | "maybe" | "skip" }>) =>
  vi.fn(async () => ({ success: true, data: { picks }, diagnostics: { fallbackUsed: false } }));

describe("prescreenListings", () => {
  it("labels only unscreened roles in one call, defaulting omitted ones to maybe", async () => {
    const saved: Array<[string, Prescreen]> = [];
    const run = ok([
      { i: 1, v: "score" },
      { i: 2, v: "skip" },
    ]);
    const done = listing("old", { prescreen: { verdict: "score", at: "2026-10-01T00:00:00Z" } });
    await prescreenListings([listing("a"), listing("b"), done, listing("c")], {
      run,
      save: async (k, p) => void saved.push([k, p]),
      profile: "test",
    });
    expect(run).toHaveBeenCalledTimes(1);
    const prompt = (run.mock.calls[0] as unknown as [string, string])[1];
    expect(prompt).toContain("1. Engineer a");
    expect(prompt).not.toContain("Engineer old");
    expect(saved.map(([k, p]) => [k, p.verdict])).toEqual([
      ["a", "score"],
      ["b", "skip"],
      ["c", "maybe"],
    ]);
  });

  it("labels nothing when the call fails, so roles are retried next run", async () => {
    const save = vi.fn();
    const run = vi.fn(async () => ({ success: false, data: { picks: [] }, diagnostics: { fallbackUsed: true } }));
    await prescreenListings([listing("a")], { run, save, profile: "test" });
    expect(save).not.toHaveBeenCalled();
  });
});

describe("applyPrescreen", () => {
  it("retires skips without scoring them and puts 'score' roles first", async () => {
    const stats = emptySyncStats();
    const outcomes = new Map<string, string | undefined>();
    const kept = await applyPrescreen(
      [listing("new-maybe"), listing("skip-me"), listing("best", { location: "Remote" }), listing("good")],
      stats,
      {
        run: ok([
          { i: 1, v: "maybe" },
          { i: 2, v: "skip" },
          { i: 3, v: "score" },
          { i: 4, v: "score" },
        ]),
        save: async () => undefined,
        setOutcome: async (k, o) => void outcomes.set(k, o.reason),
      },
    );
    expect(kept.map((l) => l._id)).toEqual(["best", "good", "new-maybe"]);
    expect(outcomes.get("skip-me")).toBe("prescreen");
    expect(stats.prescreened).toBe(4);
    expect(stats.prescreenSkipped).toBe(1);
  });
});
