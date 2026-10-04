import { AsyncLocalStorage } from "node:async_hooks";
import { getDb } from "../../config/mongo.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";

export type LlmFeature = "gmail_classify" | "jd_recovery" | "top_jobs" | "other";

type LlmContext = { feature: LlmFeature; key?: string };

const context = new AsyncLocalStorage<LlmContext>();

/** Tag every OpenAI call made inside `fn` with a feature (and application key) for cost reporting. */
export const withLlmContext = <T>(ctx: LlmContext, fn: () => Promise<T>): Promise<T> => context.run(ctx, fn);

export type OpenAiUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
};

export type LlmUsageRecord = {
  at: string;
  /** Local calendar day (YYYY-MM-DD) for daily totals. */
  day: string;
  model: string;
  feature: LlmFeature;
  key?: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
};

export const costOf = (usage: OpenAiUsage): number => {
  const input = usage.input_tokens ?? 0;
  const cached = Math.min(usage.input_tokens_details?.cached_tokens ?? 0, input);
  const output = usage.output_tokens ?? 0;
  return (
    ((input - cached) * env.openAiInputPricePerM +
      cached * env.openAiCachedInputPricePerM +
      output * env.openAiOutputPricePerM) /
    1_000_000
  );
};

export const localDay = (date = new Date()): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

type Doc = LlmUsageRecord & { _id?: unknown };

export const llmUsageRepository = {
  async collection() {
    const db = await getDb();
    return db.collection<Doc>("llm_usage");
  },

  async insert(record: LlmUsageRecord): Promise<void> {
    const col = await this.collection();
    await col.insertOne(record);
  },

  async listSinceDay(day: string): Promise<LlmUsageRecord[]> {
    const col = await this.collection();
    const docs = await col.find({ day: { $gte: day } }, { projection: { _id: 0 } }).toArray();
    return docs as LlmUsageRecord[];
  },

  async costByDaySince(feature: LlmFeature, day: string): Promise<Record<string, number>> {
    const col = await this.collection();
    const rows = await col
      .aggregate<{ _id: string; cost: number }>([
        { $match: { feature, day: { $gte: day } } },
        { $group: { _id: "$day", cost: { $sum: "$costUsd" } } },
      ])
      .toArray();
    return Object.fromEntries(rows.map((r) => [r._id, r.cost]));
  },
};

/** Fire-and-forget; usage tracking must never break a model call. */
export const recordLlmUsage = (model: string, usage: OpenAiUsage | undefined): void => {
  if (!usage || process.env.VITEST) return;
  const now = new Date();
  const ctx = context.getStore();
  const record: LlmUsageRecord = {
    at: now.toISOString(),
    day: localDay(now),
    model,
    feature: ctx?.feature ?? "other",
    key: ctx?.key,
    inputTokens: usage.input_tokens ?? 0,
    cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
    costUsd: costOf(usage),
  };
  llmUsageRepository.insert(record).catch((error) => {
    logger.warn("Could not record LLM usage", { message: error instanceof Error ? error.message : String(error) });
  });
};
