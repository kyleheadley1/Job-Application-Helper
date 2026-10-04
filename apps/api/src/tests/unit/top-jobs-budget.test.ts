import { describe, expect, it } from "vitest";
import { planTopJobsBudget } from "../../services/topJobs/topJobsBudget.js";
import { planFeatureBudget } from "../../services/llm/featureBudget.js";
import { prioritizePending } from "../../services/topJobs/topJobsSync.js";
import type { AlertListingDoc } from "../../services/topJobs/alertListings.repository.js";

const at = (iso: string) => new Date(`${iso}T12:00:00`);

describe("planTopJobsBudget", () => {
  it("spreads the monthly budget evenly over the days left", () => {
    const plan = planTopJobsBudget({ monthlyUsd: 2, costByDay: {}, now: at("2026-11-01"), maxTriages: 5 });
    expect(plan.todayAllowanceUsd).toBeCloseTo(2 / 30);
    expect(plan.allowedTriages).toBe(3);
    expect(plan.exhausted).toBe(false);
  });

  it("subtracts what today already spent, including manual refreshes", () => {
    const plan = planTopJobsBudget({
      monthlyUsd: 2,
      costByDay: { "2026-11-01": 0.06 },
      now: at("2026-11-01"),
      maxTriages: 5,
    });
    expect(plan.allowedTriages).toBe(0);
  });

  it("lets unspent earlier days roll forward but never past the per-run cap", () => {
    const plan = planTopJobsBudget({
      monthlyUsd: 2,
      costByDay: { "2026-11-02": 0.1 },
      now: at("2026-11-30"),
      maxTriages: 5,
    });
    expect(plan.allowedTriages).toBe(5);
  });

  it("stops once the month is spent", () => {
    const plan = planTopJobsBudget({
      monthlyUsd: 2,
      costByDay: { "2026-10-01": 1.5, "2026-10-04": 0.6 },
      now: at("2026-10-04"),
      maxTriages: 5,
    });
    expect(plan.allowedTriages).toBe(0);
    expect(plan.exhausted).toBe(true);
    expect(plan.spentThisMonthUsd).toBeCloseTo(2.1);
  });
});

describe("planFeatureBudget", () => {
  it("allows one agent run a day at $1.50 a month and none once today's share is spent", () => {
    const base = { monthlyUsd: 1.5, now: at("2026-11-01"), maxUnits: 1, perUnitUsd: 0.02 };
    expect(planFeatureBudget({ ...base, costByDay: {} }).allowedUnits).toBe(1);
    expect(planFeatureBudget({ ...base, costByDay: { "2026-11-01": 0.04 } }).allowedUnits).toBe(0);
  });
});

describe("prioritizePending", () => {
  it("scores roles already labelled remote/NYC first, keeping newest-first order otherwise", () => {
    const l = (id: string, location: string | null) => ({ _id: id, location }) as AlertListingDoc;
    const ordered = prioritizePending([l("a", null), l("b", "Remote"), l("c", "United States"), l("d", "New York, NY")]);
    expect(ordered.map((x) => x._id)).toEqual(["b", "d", "a", "c"]);
  });
});
