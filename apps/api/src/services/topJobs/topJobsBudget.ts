import { env } from "../../config/env.js";
import { loadFeatureBudget, planFeatureBudget, type FeatureBudget } from "../llm/featureBudget.js";

export { monthStartDay } from "../llm/featureBudget.js";

/** Conservative cost of scoring one alert role (extraction + fit score), from observed usage. */
export const EST_TRIAGE_COST_USD = 0.02;

export type TopJobsBudget = Omit<FeatureBudget, "allowedUnits"> & {
  /** Scorings that fit in today's allowance, capped by TOP_JOBS_MAX_TRIAGES_PER_SYNC. */
  allowedTriages: number;
};

const toTopJobsBudget = ({ allowedUnits, ...rest }: FeatureBudget): TopJobsBudget => ({
  ...rest,
  allowedTriages: allowedUnits,
});

export const planTopJobsBudget = (input: {
  monthlyUsd: number;
  costByDay: Record<string, number>;
  now: Date;
  maxTriages: number;
  perTriageUsd?: number;
}): TopJobsBudget =>
  toTopJobsBudget(
    planFeatureBudget({
      monthlyUsd: input.monthlyUsd,
      costByDay: input.costByDay,
      now: input.now,
      maxUnits: input.maxTriages,
      perUnitUsd: input.perTriageUsd ?? EST_TRIAGE_COST_USD,
    }),
  );

export const loadTopJobsBudget = async (now = new Date()): Promise<TopJobsBudget> =>
  toTopJobsBudget(
    await loadFeatureBudget({
      feature: "top_jobs",
      monthlyUsd: env.topJobsMonthlyBudgetUsd,
      maxUnits: env.topJobsMaxTriagesPerSync,
      perUnitUsd: EST_TRIAGE_COST_USD,
      now,
    }),
  );
