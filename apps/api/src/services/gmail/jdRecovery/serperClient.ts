import { getDb } from "../../../config/mongo.js";
import { env } from "../../../config/env.js";

const SERPER_URL = "https://google.serper.dev/search";
const USAGE_DOC_ID = "serper";

export type SerperResult = { title: string; link: string; snippet?: string };

export const serperClient = {
  isConfigured(): boolean {
    return Boolean(env.serperApiKey);
  },

  async search(query: string, num = 10): Promise<SerperResult[]> {
    if (!env.serperApiKey) throw new Error("SERPER_API_KEY is not configured");
    const res = await fetch(SERPER_URL, {
      method: "POST",
      headers: { "X-API-KEY": env.serperApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Serper request failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const body = (await res.json()) as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
    return (body.organic ?? [])
      .filter((r): r is { title?: string; link: string; snippet?: string } => typeof r.link === "string")
      .map((r) => ({ title: r.title ?? "", link: r.link, snippet: r.snippet }));
  },
};

type UsageDoc = { _id: string; jobKeys: string[]; queries: number; updatedAt: string };

export type SerperUsage = { jobKeys: string[]; queries: number; cap: number };

/** Lifetime Serper usage, counted in distinct application keys. */
export const serperUsageRepository = {
  async collection() {
    const db = await getDb();
    return db.collection<UsageDoc>("serper_usage");
  },

  async get(): Promise<SerperUsage> {
    const col = await this.collection();
    const doc = await col.findOne({ _id: USAGE_DOC_ID });
    return { jobKeys: doc?.jobKeys ?? [], queries: doc?.queries ?? 0, cap: env.serperMaxJobsTotal };
  },

  async record(jobKey: string, queries: number): Promise<void> {
    const col = await this.collection();
    await col.updateOne(
      { _id: USAGE_DOC_ID },
      {
        $addToSet: { jobKeys: jobKey },
        $inc: { queries },
        $set: { updatedAt: new Date().toISOString() },
      },
      { upsert: true },
    );
  },
};
