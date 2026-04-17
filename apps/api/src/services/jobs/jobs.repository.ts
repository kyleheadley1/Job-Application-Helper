import { randomUUID } from "node:crypto";
import {
  getTrackerColor,
  shouldShortlist,
} from "../../config/scoringPolicy.js";
import { getDb } from "../../config/mongo.js";
import type {
  DebugAssetGeneration,
  GeneratedAssets,
  JobExportRow,
  JobListFilters,
  JobRecord,
  JobStatus,
} from "../../types/job.js";
import type { Filter, WithId } from "mongodb";

export class JobsRepository {
  private async collection() {
    const db = await getDb();
    return db.collection<JobRecord & { _id: string }>("jobs");
  }

  private fromDoc(doc: WithId<JobRecord & { _id: string }>): JobRecord {
    const { _id, ...rest } = doc;
    return { ...rest, id: rest.id ?? _id };
  }

  private formatSalaryAsk(job: JobRecord): string {
    const s = job.salaryAsk;
    if (typeof s.number === "number") return String(s.number);
    if (typeof s.rangeMin === "number" || typeof s.rangeMax === "number") {
      const min = typeof s.rangeMin === "number" ? String(s.rangeMin) : "";
      const max = typeof s.rangeMax === "number" ? String(s.rangeMax) : "";
      return [min, max].filter(Boolean).join(" - ");
    }
    return "";
  }

  private upsertTrackerFields(prev: JobRecord, nextStatus: JobStatus): JobRecord["tracker"] {
    const nextShortlist = shouldShortlist(prev.score.total, nextStatus);
    return {
      ...prev.tracker,
      statusOutcome: nextStatus,
      shortlist: nextShortlist,
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
    await col.updateOne(
      { _id: record.id },
      {
        $set: { ...next, _id: next.id },
        $setOnInsert: { createdAt: record.createdAt || now },
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

  async list(filters: JobListFilters = {}): Promise<{ items: JobRecord[]; total: number }> {
    const col = await this.collection();
    const query: Filter<JobRecord & { _id: string }> = {};
    if (filters.status) query.status = filters.status;
    if (filters.shortlist !== undefined) query["tracker.shortlist"] = filters.shortlist;
    if (filters.resume) query.recommendedResume = filters.resume;
    if (filters.recommendation) query.recommendation = filters.recommendation;
    if (filters.minScore !== undefined) query["score.total"] = { $gte: filters.minScore };
    if (filters.company) query["extracted.company"] = { $regex: filters.company, $options: "i" };
    const docs = await col.find(query).sort({ updatedAt: -1 }).toArray();
    const items = docs.map((d) => this.fromDoc(d));
    return { items, total: items.length };
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
    await col.updateOne(
      { _id: id },
      {
        $set: {
          status,
          tracker: nextTracker,
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
    await col.updateOne(
      { _id: id },
      {
        $set: {
          tracker: { ...prevJob.tracker, notes: notes.trim() },
          updatedAt: now,
        },
      },
    );
    const next = await col.findOne({ _id: id });
    return next ? this.fromDoc(next) : null;
  }

  async exportRows(filters: JobListFilters = {}): Promise<{ rows: JobExportRow[]; total: number }> {
    const { items } = await this.list(filters);
    const rows: JobExportRow[] = items.map((job) => ({
      Company: job.extracted.company,
      Role: job.extracted.title,
      "Latest Score": job.score.total,
      "Recommended Action": job.tracker.recommendedAction ?? "",
      "Salary Ask": this.formatSalaryAsk(job),
      "Top Match": job.topMatch,
      "Main Risk": job.mainRisk,
      Resume: job.recommendedResume,
      "Status / Outcome": job.tracker.statusOutcome ?? job.status,
      Shortlist: Boolean(job.tracker.shortlist),
      Notes: job.tracker.notes ?? "",
      "Created At": job.createdAt,
      "Updated At": job.updatedAt,
    }));
    return { rows, total: rows.length };
  }
}

export const jobsRepository = new JobsRepository();
