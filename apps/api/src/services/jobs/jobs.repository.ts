import type { DebugAssetGeneration, GeneratedAssets, JobRecord } from "../../types/job.js";

export class JobsRepository {
  private readonly records: JobRecord[] = [];

  async saveTriage(record: JobRecord): Promise<JobRecord> {
    this.records.unshift(record);
    if (this.records.length > 200) {
      this.records.pop();
    }
    return record;
  }

  async mergeGeneratedAssets(
    id: string,
    generated: GeneratedAssets,
    debugAssetGeneration?: DebugAssetGeneration,
  ): Promise<JobRecord | null> {
    const idx = this.records.findIndex((item) => item.id === id);
    if (idx === -1) return null;
    const prev = this.records[idx];
    const now = new Date().toISOString();
    const next: JobRecord = {
      ...prev,
      generated,
      ...(debugAssetGeneration !== undefined ? { debugAssetGeneration } : {}),
      updatedAt: now,
    };
    this.records[idx] = next;
    return next;
  }

  /** Insert or replace by `id` (used when generating from an unsaved client-held job). */
  async upsertJob(record: JobRecord): Promise<JobRecord> {
    const idx = this.records.findIndex((item) => item.id === record.id);
    const now = new Date().toISOString();
    const next: JobRecord = { ...record, updatedAt: now };
    if (idx >= 0) {
      this.records[idx] = next;
      return next;
    }
    this.records.unshift(next);
    if (this.records.length > 200) {
      this.records.pop();
    }
    return next;
  }

  async getRecent(limit = 20): Promise<JobRecord[]> {
    return this.records.slice(0, limit);
  }

  clearForTests(): void {
    this.records.length = 0;
  }

  async getById(id: string): Promise<JobRecord | null> {
    const found = this.records.find((item) => item.id === id);
    return found ?? null;
  }
}

export const jobsRepository = new JobsRepository();
