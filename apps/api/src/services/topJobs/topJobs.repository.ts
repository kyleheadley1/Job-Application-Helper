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
import { gmailAuth } from "../gmail/gmailAuth.js";
import { serperClient } from "../gmail/jdRecovery/serperClient.js";
import { alertListingsRepository } from "./alertListings.repository.js";
import { loadTopJobsBudget } from "./topJobsBudget.js";

const SYNC_META_ID = "sync_meta" as const;

const defaultSyncMeta = (): TopJobsSyncMeta => ({
  _id: SYNC_META_ID,
  lastSyncAt: null,
  lastManualSyncAt: null,
  lastSyncStats: null,
  lastSyncError: null,
});

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
      .find({ "score.total": { $gte: minScore }, hiddenReason: { $exists: false } })
      .sort({ sourcePostedAt: -1 })
      .toArray();
    return docs.map((d) => this.fromDoc(d));
  }

  /** Every stored row, hidden ones included; used to avoid re-scoring roles already seen. */
  async listAll(): Promise<TopJobRecord[]> {
    const col = await this.topJobsCol();
    return (await col.find({}).toArray()).map((d) => this.fromDoc(d));
  }

  async hide(id: string, reason: NonNullable<TopJobRecord["hiddenReason"]>): Promise<void> {
    const col = await this.topJobsCol();
    await col.updateOne({ _id: id }, { $set: { hiddenReason: reason, hiddenAt: new Date().toISOString() } });
  }

  async markLiveChecked(id: string): Promise<void> {
    const col = await this.topJobsCol();
    await col.updateOne({ _id: id }, { $set: { liveCheckedAt: new Date().toISOString() } });
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
    return {
      _id: SYNC_META_ID,
      lastSyncAt: doc.lastSyncAt ?? null,
      lastManualSyncAt: doc.lastManualSyncAt ?? null,
      lastSyncStats: doc.lastSyncStats && "alertEmails" in doc.lastSyncStats ? doc.lastSyncStats : null,
      lastSyncError: doc.lastSyncError ?? null,
    };
  }

  async recordSyncResult(params: {
    stats: TopJobsSyncStats;
    manual: boolean;
    error?: string | null;
  }): Promise<TopJobsSyncMeta> {
    const col = await this.metaCol();
    const meta = await this.getSyncMeta();
    const now = new Date().toISOString();
    const next: TopJobsSyncMeta = {
      ...meta,
      lastSyncAt: now,
      lastManualSyncAt: params.manual ? now : meta.lastManualSyncAt,
      lastSyncStats: params.stats,
      lastSyncError: params.error ?? null,
    };
    await col.updateOne(
      { _id: SYNC_META_ID },
      { $set: next, $unset: { jsearchCreditsUsedThisMonth: "", jsearchCreditsResetAt: "" } },
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
    const [gmail, pendingListings, budget] = await Promise.all([
      gmailAuth.getStatus(),
      alertListingsRepository.countPending(
        new Date(Date.now() - env.topJobsListingMaxAgeDays * 86_400_000).toISOString(),
      ),
      loadTopJobsBudget(),
    ]);

    return {
      lastSyncAt: meta.lastSyncAt,
      lastManualSyncAt: meta.lastManualSyncAt,
      lastSyncStats: meta.lastSyncStats,
      lastSyncError: meta.lastSyncError,
      manualRefreshCooldownMin: env.topJobsManualRefreshCooldownMin,
      canManualRefresh,
      manualRefreshAvailableAt: canManualRefresh ? null : new Date(cooldownEnds).toISOString(),
      gmailConnected: gmail.configured && gmail.connected,
      serperConfigured: serperClient.isConfigured(),
      openAiKeyConfigured: Boolean(env.openAiApiKey?.trim()),
      pendingListings,
      budget: { monthlyUsd: budget.monthlyUsd, spentThisMonthUsd: budget.spentThisMonthUsd },
    };
  }

  createId(): string {
    return randomUUID();
  }
}

export const topJobsRepository = new TopJobsRepository();
