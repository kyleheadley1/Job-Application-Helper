import { randomUUID } from "node:crypto";
import { getTrackerColor } from "../../config/scoringPolicy.js";
import { toAppliedAtIso } from "../../lib/appliedAtDate.js";
import { recomputeStoredJobScore } from "../../lib/recomputeStoredJobScore.js";
import { shortlistTrackerFields } from "../../lib/shortlist.js";
import { getDb } from "../../config/mongo.js";
import type {
  DebugAssetGeneration,
  GeneratedAssets,
  JobListFilters,
  JobRecord,
  JobStatus,
  RefreshShortlistResult,
} from "../../types/job.js";
import type { ResumeContextSet } from "../../types/resumeContext.js";
import type { JobExportRow } from "../../tracker/canonicalSpreadsheet.js";
import { buildJobExportRow } from "../../tracker/canonicalSpreadsheet.js";
import { normalizeStoredJobScores } from "../../lib/scoringCaps.js";
import { sanitizeStoredJobRecord } from "../../lib/sanitizeStoredJob.js";
import type { Filter, WithId } from "mongodb";

export class JobsRepository {
  private async collection() {
    const db = await getDb();
    return db.collection<JobRecord & { _id: string }>("jobs");
  }

  private fromDoc(doc: WithId<JobRecord & { _id: string }>): JobRecord {
    const { _id, ...rest } = doc;
    return sanitizeStoredJobRecord(
      normalizeStoredJobScores({ ...rest, id: rest.id ?? _id }),
    );
  }

  private upsertTrackerFields(prev: JobRecord, nextStatus: JobStatus): JobRecord["tracker"] {
    const asJob: JobRecord = { ...prev, status: nextStatus };
    return {
      ...prev.tracker,
      statusOutcome: nextStatus,
      ...shortlistTrackerFields(asJob),
      color: getTrackerColor(nextStatus, prev.score.total),
    };
  }

  async saveTriage(record: JobRecord): Promise<JobRecord> {
    const col = await this.collection();
    await col.insertOne({ ...record, _id: record.id });
    return record;
  }

  async mergeGeneratedAssets(
    id: string,
    generated: GeneratedAssets,
    debugAssetGeneration?: DebugAssetGeneration,
  ): Promise<JobRecord | null> {
    const col = await this.collection();
    const prev = await col.findOne({ _id: id });
    if (!prev) return null;
    const now = new Date().toISOString();
    await col.updateOne(
      { _id: id },
      {
        $set: {
          generated,
          ...(debugAssetGeneration !== undefined ? { debugAssetGeneration } : {}),
          updatedAt: now,
        },
      },
    );
    const next = await col.findOne({ _id: id });
    return next ? this.fromDoc(next) : null;
  }

  /** Insert or replace by `id` (used when generating from an unsaved client-held job). */
  async upsertJob(record: JobRecord): Promise<JobRecord> {
    const now = new Date().toISOString();
    const col = await this.collection();
    const next: JobRecord = { ...record, updatedAt: now };
    const { createdAt, ...setFields } = next;
    await col.updateOne(
      { _id: record.id },
      {
        $set: { ...setFields, _id: next.id },
        $setOnInsert: { createdAt: createdAt || now },
      },
      { upsert: true },
    );
    const saved = await col.findOne({ _id: record.id });
    if (!saved) return next;
    return this.fromDoc(saved);
  }

  async getRecent(limit = 20): Promise<JobRecord[]> {
    const col = await this.collection();
    const docs = await col.find({}).sort({ updatedAt: -1 }).limit(limit).toArray();
    return docs.map((d) => this.fromDoc(d));
  }

  /** Full scan for maintenance scripts (e.g. controlled tracker rescoring). */
  async findAll(): Promise<JobRecord[]> {
    const col = await this.collection();
    const docs = await col.find({}).sort({ updatedAt: -1 }).toArray();
    return docs.map((d) => this.fromDoc(d));
  }

  /**
   * Apply rescored snapshot: preserves historical Original / Alt score once set,
   * updates Latest Score and narrative fields, appends scoreHistory, refreshes shortlist bit.
   */
  async applyTrackerRescore(params: {
    id: string;
    previousScoreTotal: number;
    rules: JobRecord["rules"];
    score: JobRecord["score"];
    recommendation: JobRecord["recommendation"];
    salaryAsk: JobRecord["salaryAsk"];
    topMatch: JobRecord["topMatch"];
    mainRisk: JobRecord["mainRisk"];
    rationale: JobRecord["rationale"];
    risks: JobRecord["risks"];
    referralPathwayAvailable?: JobRecord["referralPathwayAvailable"];
    referralPathwayNotes?: JobRecord["referralPathwayNotes"];
  }): Promise<JobRecord | null> {
    const col = await this.collection();
    const prev = await col.findOne({ _id: params.id });
    if (!prev) return null;
    const prevJob = this.fromDoc(prev);
    const now = new Date().toISOString();
    const ts = prevJob.trackerSpreadsheet ?? {};
    const prevOriginal =
      typeof ts.originalAltScore === "string" && ts.originalAltScore.trim()
        ? ts.originalAltScore.trim()
        : "";
    const nextSpreadsheet = {
      ...ts,
      latestScore: String(params.score.total),
      originalAltScore: prevOriginal ? prevOriginal : String(params.previousScoreTotal),
    };
    const nextTracker = {
      ...prevJob.tracker,
      ...this.upsertTrackerFields(
        { ...prevJob, score: params.score },
        prevJob.status,
      ),
    };
    const historyEntry = {
      scoredAt: now,
      score: params.score,
      recommendation: params.recommendation,
    };
    await col.updateOne(
      { _id: params.id },
      {
        $set: {
          rules: params.rules,
          score: params.score,
          recommendation: params.recommendation,
          salaryAsk: params.salaryAsk,
          topMatch: params.topMatch,
          mainRisk: params.mainRisk,
          rationale: params.rationale,
          risks: params.risks,
          ...(params.referralPathwayAvailable !== undefined
            ? { referralPathwayAvailable: params.referralPathwayAvailable }
            : {}),
          ...(params.referralPathwayNotes !== undefined
            ? { referralPathwayNotes: params.referralPathwayNotes }
            : {}),
          tracker: nextTracker,
          trackerSpreadsheet: nextSpreadsheet,
          updatedAt: now,
        },
        $push: { scoreHistory: historyEntry },
      },
    );
    const next = await col.findOne({ _id: params.id });
    return next ? this.fromDoc(next) : null;
  }

  async list(
    filters: JobListFilters = {},
  ): Promise<{ items: JobRecord[]; total: number; totalAll: number }> {
    const col = await this.collection();
    const query: Filter<JobRecord & { _id: string }> = {};
    if (filters.status) query.status = filters.status;
    if (filters.shortlist !== undefined) query["tracker.shortlist"] = filters.shortlist;
    if (filters.resume) query.recommendedResume = filters.resume;
    if (filters.recommendation) query.recommendation = filters.recommendation;
    if (filters.minScore !== undefined) query["score.total"] = { $gte: filters.minScore };
    if (filters.company) query["extracted.company"] = { $regex: filters.company, $options: "i" };
    const [docs, totalAll] = await Promise.all([
      col.find(query).sort({ updatedAt: -1 }).toArray(),
      col.countDocuments({}),
    ]);
    const items = docs.map((d) => this.fromDoc(d));
    return { items, total: items.length, totalAll };
  }

  async clearForTests(): Promise<void> {
    const col = await this.collection();
    await col.deleteMany({});
  }

  async getById(id: string): Promise<JobRecord | null> {
    const col = await this.collection();
    const found = await col.findOne({ _id: id });
    return found ? this.fromDoc(found) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    const col = await this.collection();
    const result = await col.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  async updateStatus(id: string, status: JobStatus, note?: string): Promise<JobRecord | null> {
    const col = await this.collection();
    const prev = await col.findOne({ _id: id });
    if (!prev) return null;
    const prevJob = this.fromDoc(prev);
    const now = new Date().toISOString();
    const historyItem = {
      id: randomUUID(),
      jobId: prevJob.id,
      fromStatus: prevJob.status,
      toStatus: status,
      note: note?.trim() ? note.trim() : undefined,
      createdAt: now,
    };
    const nextTracker = {
      ...this.upsertTrackerFields(prevJob, status),
      ...(prevJob.tracker.notes !== undefined ? { notes: prevJob.tracker.notes } : {}),
    };
    const nextSpreadsheet = {
      ...prevJob.trackerSpreadsheet,
      statusOutcome: status,
    };
    await col.updateOne(
      { _id: id },
      {
        $set: {
          status,
          tracker: nextTracker,
          trackerSpreadsheet: nextSpreadsheet,
          updatedAt: now,
        },
        $push: { statusHistory: historyItem },
      },
    );
    const next = await col.findOne({ _id: id });
    return next ? this.fromDoc(next) : null;
  }

  async updateNotes(id: string, notes: string): Promise<JobRecord | null> {
    const col = await this.collection();
    const prev = await col.findOne({ _id: id });
    if (!prev) return null;
    const prevJob = this.fromDoc(prev);
    const now = new Date().toISOString();
    const nextSpreadsheet = {
      ...prevJob.trackerSpreadsheet,
      notes: notes.trim(),
    };
    await col.updateOne(
      { _id: id },
      {
        $set: {
          tracker: { ...prevJob.tracker, notes: notes.trim() },
          trackerSpreadsheet: nextSpreadsheet,
          updatedAt: now,
        },
      },
    );
    const next = await col.findOne({ _id: id });
    return next ? this.fromDoc(next) : null;
  }

  /**
   * Manually set date applied. Stores tracker.appliedAt and rewrites (or creates)
   * the earliest applied statusHistory timestamp so counters/export stay consistent.
   * If the role is still to_review/skip, promotes status to applied.
   */
  async updateAppliedAt(id: string, appliedAtInput: string): Promise<JobRecord | null> {
    const col = await this.collection();
    const prev = await col.findOne({ _id: id });
    if (!prev) return null;
    const prevJob = this.fromDoc(prev);
    const appliedAt = toAppliedAtIso(appliedAtInput);
    const now = new Date().toISOString();

    const history = [...(prevJob.statusHistory ?? [])];
    const appliedIndexes = history
      .map((h, i) => (h.toStatus === "applied" ? i : -1))
      .filter((i) => i >= 0);
    let earliestIdx = -1;
    if (appliedIndexes.length) {
      earliestIdx = appliedIndexes.reduce((best, i) =>
        new Date(history[i].createdAt).getTime() < new Date(history[best].createdAt).getTime()
          ? i
          : best,
      );
      history[earliestIdx] = {
        ...history[earliestIdx],
        createdAt: appliedAt,
        note: history[earliestIdx].note?.trim()
          ? history[earliestIdx].note
          : "Applied date set manually",
      };
    } else {
      history.push({
        id: randomUUID(),
        jobId: prevJob.id,
        fromStatus: prevJob.status,
        toStatus: "applied",
        note: "Applied date set manually",
        createdAt: appliedAt,
      });
    }

    const promoteToApplied = prevJob.status === "to_review" || prevJob.status === "skip";
    const nextStatus = promoteToApplied ? "applied" : prevJob.status;
    const nextTracker = {
      ...prevJob.tracker,
      appliedAt,
      ...(promoteToApplied
        ? {
            statusOutcome: "applied",
            color: getTrackerColor("applied", prevJob.score.total),
            shortlist: false,
            shortlistTag: undefined,
            freshnessTier: undefined,
          }
        : {}),
    };
    const nextSpreadsheet = {
      ...prevJob.trackerSpreadsheet,
      ...(promoteToApplied ? { statusOutcome: "applied" as const } : {}),
    };

    await col.updateOne(
      { _id: id },
      {
        $set: {
          status: nextStatus,
          tracker: nextTracker,
          trackerSpreadsheet: nextSpreadsheet,
          statusHistory: history,
          updatedAt: now,
        },
      },
    );
    const next = await col.findOne({ _id: id });
    return next ? this.fromDoc(next) : null;
  }

  async exportRows(filters: JobListFilters = {}): Promise<{ rows: JobExportRow[]; total: number }> {
    const { items } = await this.list(filters);
    const rows: JobExportRow[] = items.map((job) => buildJobExportRow(job));
    return { rows, total: rows.length };
  }

  /**
   * Recompute composite score from stored category scores, then sync shortlist flags.
   * Does not append scoreHistory — use applyTrackerRescore for audited rescoring.
   */
  async syncScoreAndShortlistForJob(
    job: JobRecord,
    recomputed: ReturnType<typeof recomputeStoredJobScore>,
  ): Promise<{ wasShortlist: boolean; nowShortlist: boolean; changed: boolean }> {
    const col = await this.collection();
    const wasShortlist = job.tracker.shortlist === true;
    const merged: JobRecord = {
      ...job,
      rules: recomputed.rules,
      score: recomputed.score,
      recommendation: recomputed.recommendation,
      salaryAsk: recomputed.salaryAsk,
      referralPathwayAvailable: recomputed.referralPathwayAvailable,
      referralPathwayNotes: recomputed.referralPathwayNotes,
    };
    const nextTracker = {
      ...job.tracker,
      ...shortlistTrackerFields(merged),
      color: getTrackerColor(job.status, recomputed.score.total),
    };
    const nowShortlist = nextTracker.shortlist === true;
    const now = new Date().toISOString();
    await col.updateOne(
      { _id: job.id },
      {
        $set: {
          rules: recomputed.rules,
          score: recomputed.score,
          recommendation: recomputed.recommendation,
          salaryAsk: recomputed.salaryAsk,
          ...(recomputed.referralPathwayAvailable !== undefined
            ? { referralPathwayAvailable: recomputed.referralPathwayAvailable }
            : {}),
          ...(recomputed.referralPathwayNotes !== undefined
            ? { referralPathwayNotes: recomputed.referralPathwayNotes }
            : {}),
          tracker: nextTracker,
          updatedAt: now,
        },
      },
    );
    const changed =
      wasShortlist !== nowShortlist ||
      job.score.total !== recomputed.score.total ||
      job.tracker.shortlistTag !== nextTracker.shortlistTag ||
      job.tracker.freshnessTier !== nextTracker.freshnessTier;
    return { wasShortlist, nowShortlist, changed };
  }

  async refreshAllShortlists(params: {
    jobs: JobRecord[];
    resumeContexts: ResumeContextSet;
  }): Promise<RefreshShortlistResult> {
    let updated = 0;
    let added = 0;
    let removed = 0;
    let unchanged = 0;

    for (const job of params.jobs) {
      const recomputed = recomputeStoredJobScore({
        job,
        resumeContexts: params.resumeContexts,
      });
      const result = await this.syncScoreAndShortlistForJob(job, recomputed);
      if (!result.changed) {
        unchanged++;
        continue;
      }
      updated++;
      if (!result.wasShortlist && result.nowShortlist) added++;
      if (result.wasShortlist && !result.nowShortlist) removed++;
    }

    return {
      total: params.jobs.length,
      updated,
      added,
      removed,
      unchanged,
    };
  }

  /** Upsert by content-derived `importKey` (XLSX seed only; not live sync). Preserves `id` / `createdAt` when the key already exists. */
  async upsertByImportKey(record: JobRecord): Promise<JobRecord> {
    if (!record.importKey) {
      throw new Error("importKey is required for upsertByImportKey");
    }
    const col = await this.collection();
    const existing = await col.findOne({ importKey: record.importKey });
    const now = new Date().toISOString();
    if (existing) {
      const id = String(existing._id);
      const prev = this.fromDoc(existing);
      const next: JobRecord = {
        ...record,
        id,
        createdAt: prev.createdAt,
        updatedAt: now,
      };
      await col.replaceOne(
        { _id: id },
        { ...next, _id: id } as JobRecord & { _id: string },
      );
      const saved = await col.findOne({ _id: id });
      return saved ? this.fromDoc(saved) : next;
    }
    const next: JobRecord = { ...record, updatedAt: now };
    await col.insertOne({ ...next, _id: next.id });
    return next;
  }
}

export const jobsRepository = new JobsRepository();
