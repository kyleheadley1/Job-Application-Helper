import type { JobListFilters, JobRecord, JobStatus } from "../../types/job.js";
import type { JobExportRow } from "../../tracker/canonicalSpreadsheet.js";
import { triageJob } from "../../agents/jobAgent/orchestrator.js";
import {
  AssetGenerationSkippedError,
  generateJobAssets,
} from "../../agents/jobAgent/assetGeneration.js";
import { userProfile } from "../../config/userProfile.js";
import { jobsRepository } from "./jobs.repository.js";

export class JobNotFoundError extends Error {
  readonly code = "JOB_NOT_FOUND" as const;
  constructor() {
    super("Job not found");
    this.name = "JobNotFoundError";
  }
}

export class JobsService {
  async runTriage(input: {
    url?: string;
    rawText?: string;
    companyHint?: string;
    fullPrep?: boolean;
  }): Promise<JobRecord> {
    const result = await triageJob(input);
    return jobsRepository.saveTriage(result);
  }

  async getById(id: string): Promise<JobRecord | null> {
    return jobsRepository.getById(id);
  }

  async list(filters: JobListFilters): Promise<{ items: JobRecord[]; total: number; totalAll: number }> {
    return jobsRepository.list(filters);
  }

  async exportRows(filters: JobListFilters): Promise<{ rows: JobExportRow[]; total: number }> {
    return jobsRepository.exportRows(filters);
  }

  async generateAssetsForJobId(jobId: string, input?: { force?: boolean }): Promise<JobRecord> {
    const job = await jobsRepository.getById(jobId);
    if (!job) throw new JobNotFoundError();
    const result = await generateJobAssets({ job, userProfile, force: input?.force });
    if (result.skipped) {
      throw new AssetGenerationSkippedError(result.skipReason ?? "Asset generation skipped.");
    }
    const updated = await jobsRepository.mergeGeneratedAssets(
      jobId,
      result.generated,
      result.debugAssetGeneration,
    );
    if (!updated) throw new JobNotFoundError();
    return updated;
  }

  async generateAssetsFromJobBody(body: {
    job: JobRecord;
    persist?: boolean;
    force?: boolean;
  }): Promise<JobRecord> {
    const { job, persist, force } = body;
    const result = await generateJobAssets({ job, userProfile, force });
    if (result.skipped) {
      throw new AssetGenerationSkippedError(result.skipReason ?? "Asset generation skipped.");
    }
    const merged: JobRecord = {
      ...job,
      generated: result.generated,
      ...(result.debugAssetGeneration !== undefined
        ? { debugAssetGeneration: result.debugAssetGeneration }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    if (persist) {
      return jobsRepository.upsertJob(merged);
    }
    return merged;
  }

  async updateStatus(id: string, status: JobStatus, note?: string): Promise<JobRecord> {
    const updated = await jobsRepository.updateStatus(id, status, note);
    if (!updated) throw new JobNotFoundError();
    return updated;
  }

  async updateNotes(id: string, notes: string): Promise<JobRecord> {
    const updated = await jobsRepository.updateNotes(id, notes);
    if (!updated) throw new JobNotFoundError();
    return updated;
  }
}

export const jobsService = new JobsService();
