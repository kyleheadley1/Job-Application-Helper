import { randomUUID } from "node:crypto";
import { getDb } from "../../config/mongo.js";
import { env } from "../../config/env.js";
import type {
  TopJobRecord,
  TopJobSource,
  TopJobsSyncMeta,
  TopJobsSyncStats,
  TopJobsSyncStatus,
} from "../../types/topJob.js";
import type { WithId } from "mongodb";

const SYNC_META_ID = "sync_meta" as const;

const defaultSyncMeta = (): TopJobsSyncMeta => ({
  _id: SYNC_META_ID,
  jsearchCreditsUsedThisMonth: 0,
  jsearchCreditsResetAt: nextMonthStartIso(),
  lastSyncAt: null,
  lastManualSyncAt: null,
  lastSyncStats: null,
  lastSyncError: null,
});

function nextMonthStartIso(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export class TopJobsRepository {
  private async topJobsCol() {
    const db = await getDb();
    return db.collection<TopJobRecord & { _id: string }>("top_jobs");
  }

  private async metaCol() {
    const db = await getDb();
    return db.collection<TopJobsSyncMeta & { _id: string }>("top_jobs_sync_meta");
  }

  private fromDoc(doc: WithId<TopJobRecord & { _id: string }>): TopJobRecord {
    const { _id, ...rest } = doc;
    return { ...rest, id: rest.id ?? _id };
  }

  async list(minScore = env.topJobsMinScore): Promise<TopJobRecord[]> {
    const col = await this.topJobsCol();
    const docs = await col
      .find({ "score.total": { $gte: minScore } })
      .sort({ sourcePostedAt: -1 })
      .toArray();
    return docs.map((d) => this.fromDoc(d));
  }

  async findBySourceKey(source: TopJobSource, externalId: string): Promise<TopJobRecord | null> {
    const col = await this.topJobsCol();
    const doc = await col.findOne({ source, externalId });
    return doc ? this.fromDoc(doc) : null;
  }

  async findByApplyUrl(applyUrl: string): Promise<TopJobRecord | null> {
    const col = await this.topJobsCol();
    const doc = await col.findOne({ applyUrl });
    return doc ? this.fromDoc(doc) : null;
  }

  async getById(id: string): Promise<TopJobRecord | null> {
    const col = await this.topJobsCol();
    const doc = await col.findOne({ _id: id });
    return doc ? this.fromDoc(doc) : null;
  }

  async upsert(record: TopJobRecord): Promise<TopJobRecord> {
    const col = await this.topJobsCol();
    await col.updateOne(
      { _id: record.id },
      { $set: { ...record, _id: record.id } },
      { upsert: true },
    );
    return record;
  }

  async markPromoted(id: string, promotedToJobId: string): Promise<TopJobRecord | null> {
    const col = await this.topJobsCol();
    const prev = await col.findOne({ _id: id });
    if (!prev) return null;
    await col.updateOne({ _id: id }, { $set: { promotedToJobId } });
    return { ...this.fromDoc(prev), promotedToJobId };
  }

  async getSyncMeta(): Promise<TopJobsSyncMeta> {
    const col = await this.metaCol();
    const doc = await col.findOne({ _id: SYNC_META_ID });
    if (!doc) {
      const meta = defaultSyncMeta();
      await col.insertOne({ ...meta, _id: SYNC_META_ID });
      return meta;
    }
    const meta = { ...doc, _id: SYNC_META_ID };
    if (new Date(meta.jsearchCreditsResetAt).getTime() <= Date.now()) {
      meta.jsearchCreditsUsedThisMonth = 0;
      meta.jsearchCreditsResetAt = nextMonthStartIso();
      await col.updateOne(
        { _id: SYNC_META_ID },
        {
          $set: {
            jsearchCreditsUsedThisMonth: 0,
            jsearchCreditsResetAt: meta.jsearchCreditsResetAt,
          },
        },
      );
    }
    return meta;
  }

  async recordSyncResult(params: {
    stats: TopJobsSyncStats;
    manual: boolean;
    jsearchCreditsDelta: number;
    error?: string | null;
  }): Promise<TopJobsSyncMeta> {
    const col = await this.metaCol();
    const meta = await this.getSyncMeta();
    const now = new Date().toISOString();
    const next: TopJobsSyncMeta = {
      ...meta,
      jsearchCreditsUsedThisMonth: meta.jsearchCreditsUsedThisMonth + params.jsearchCreditsDelta,
      lastSyncAt: now,
      lastManualSyncAt: params.manual ? now : meta.lastManualSyncAt,
      lastSyncStats: params.stats,
      lastSyncError: params.error ?? null,
    };
    await col.updateOne(
      { _id: SYNC_META_ID },
      { $set: next },
      { upsert: true },
    );
    return next;
  }

  async getSyncStatus(): Promise<TopJobsSyncStatus> {
    const meta = await this.getSyncMeta();
    const cooldownMs = env.topJobsManualRefreshCooldownMin * 60_000;
    const lastManual = meta.lastManualSyncAt ? new Date(meta.lastManualSyncAt).getTime() : 0;
    const cooldownEnds = lastManual + cooldownMs;
    const canManualRefresh = Date.now() >= cooldownEnds;

    return {
      lastSyncAt: meta.lastSyncAt,
      lastManualSyncAt: meta.lastManualSyncAt,
      lastSyncStats: meta.lastSyncStats,
      lastSyncError: meta.lastSyncError,
      jsearchCreditsUsedThisMonth: meta.jsearchCreditsUsedThisMonth,
      jsearchCreditsRemaining: Math.max(0, env.jsearchMonthlyCap - meta.jsearchCreditsUsedThisMonth),
      jsearchMonthlyCap: env.jsearchMonthlyCap,
      manualRefreshCooldownMin: env.topJobsManualRefreshCooldownMin,
      canManualRefresh,
      manualRefreshAvailableAt: canManualRefresh ? null : new Date(cooldownEnds).toISOString(),
    };
  }

  createId(): string {
    return randomUUID();
  }
}

export const topJobsRepository = new TopJobsRepository();
