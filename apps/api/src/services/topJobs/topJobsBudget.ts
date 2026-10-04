import { env } from "../../config/env.js";
import { llmUsageRepository, localDay } from "../llm/llmUsage.js";

/** Conservative cost of scoring one alert role (extraction + fit score), from observed usage. */
export const EST_TRIAGE_COST_USD = 0.02;

export type TopJobsBudget = {
  monthlyUsd: number;
  spentThisMonthUsd: number;
  /** What today may still spend so the month lands at or under budget. */
  todayAllowanceUsd: number;
  /** Scorings that fit in today's allowance, capped by TOP_JOBS_MAX_TRIAGES_PER_SYNC. */
  allowedTriages: number;
  exhausted: boolean;
};

/**
 * Spread the monthly budget evenly over the days left: today gets its share of what's left
 * after earlier days, minus whatever today already spent (manual refreshes included).
 */
export const planTopJobsBudget = (input: {
  monthlyUsd: number;
  costByDay: Record<string, number>;
  now: Date;
  maxTriages: number;
  perTriageUsd?: number;
}): TopJobsBudget => {
  const today = localDay(input.now);
  let spentBeforeToday = 0;
  let spentToday = 0;
  for (const [day, cost] of Object.entries(input.costByDay)) {
    if (day === today) spentToday += cost;
    else if (day < today) spentBeforeToday += cost;
  }
  const daysInMonth = new Date(input.now.getFullYear(), input.now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - input.now.getDate() + 1;
  const remaining = Math.max(0, input.monthlyUsd - spentBeforeToday);
  const todayAllowanceUsd = Math.max(0, remaining / daysLeft - spentToday);
  const allowedTriages = Math.max(
    0,
    Math.min(input.maxTriages, Math.floor(todayAllowanceUsd / (input.perTriageUsd ?? EST_TRIAGE_COST_USD))),
  );
  const spentThisMonthUsd = spentBeforeToday + spentToday;
  return {
    monthlyUsd: input.monthlyUsd,
    spentThisMonthUsd,
    todayAllowanceUsd,
    allowedTriages,
    exhausted: spentThisMonthUsd >= input.monthlyUsd,
  };
};

export const monthStartDay = (now: Date): string => localDay(new Date(now.getFullYear(), now.getMonth(), 1));

export const loadTopJobsBudget = async (now = new Date()): Promise<TopJobsBudget> =>
  planTopJobsBudget({
    monthlyUsd: env.topJobsMonthlyBudgetUsd,
    costByDay: await llmUsageRepository.costByDaySince("top_jobs", monthStartDay(now)),
    now,
    maxTriages: env.topJobsMaxTriagesPerSync,
  });
