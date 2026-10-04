import { llmUsageRepository, localDay, type LlmFeature } from "./llmUsage.js";

export type FeatureBudget = {
  monthlyUsd: number;
  spentThisMonthUsd: number;
  /** What today may still spend so the month lands at or under budget. */
  todayAllowanceUsd: number;
  /** Units of work (scorings, agent runs) that fit in today's allowance, capped by maxUnits. */
  allowedUnits: number;
  exhausted: boolean;
};

/**
 * Spread a monthly budget evenly over the days left: today gets its share of what's left
 * after earlier days, minus whatever today already spent (manual runs included).
 */
export const planFeatureBudget = (input: {
  monthlyUsd: number;
  costByDay: Record<string, number>;
  now: Date;
  maxUnits: number;
  perUnitUsd: number;
}): FeatureBudget => {
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
  const allowedUnits = Math.max(0, Math.min(input.maxUnits, Math.floor(todayAllowanceUsd / input.perUnitUsd)));
  const spentThisMonthUsd = spentBeforeToday + spentToday;
  return {
    monthlyUsd: input.monthlyUsd,
    spentThisMonthUsd,
    todayAllowanceUsd,
    allowedUnits,
    exhausted: spentThisMonthUsd >= input.monthlyUsd,
  };
};

export const monthStartDay = (now: Date): string => localDay(new Date(now.getFullYear(), now.getMonth(), 1));

export const loadFeatureBudget = async (opts: {
  feature: LlmFeature;
  monthlyUsd: number;
  maxUnits: number;
  perUnitUsd: number;
  now?: Date;
}): Promise<FeatureBudget> => {
  const now = opts.now ?? new Date();
  return planFeatureBudget({
    monthlyUsd: opts.monthlyUsd,
    costByDay: await llmUsageRepository.costByDaySince(opts.feature, monthStartDay(now)),
    now,
    maxUnits: opts.maxUnits,
    perUnitUsd: opts.perUnitUsd,
  });
};
