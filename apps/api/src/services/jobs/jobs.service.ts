import { randomUUID } from "node:crypto";
import type { JobListFilters, JobRecord, JobStatus } from "../../types/job.js";
import type { JobExportRow } from "../../tracker/canonicalSpreadsheet.js";
import { triageJob } from "../../agents/jobAgent/orchestrator.js";
import {
  AssetGenerationSkippedError,
  generateJobAssets,
} from "../../agents/jobAgent/assetGeneration.js";
import { userProfile } from "../../config/userProfile.js";
import { getTrackerColor, shouldShortlist } from "../../config/scoringPolicy.js";
import { buildTrackerSpreadsheetFromJob } from "../../tracker/canonicalSpreadsheet.js";
import { jobsRepository } from "./jobs.repository.js";
import { resumeContextService } from "../resume/resumeContext.js";

export class JobNotFoundError extends Error {
  readonly code = "JOB_NOT_FOUND" as const;
  constructor() {
    super("Job not found");
    this.name = "JobNotFoundError";
  }
}

export class JobConfirmNotAllowedError extends Error {
  readonly code = "JOB_CONFIRM_NOT_ALLOWED" as const;
  constructor() {
    super("This scored role is not eligible for confirm-applied.");
    this.name = "JobConfirmNotAllowedError";
  }
}

export class JobNoJdSourceError extends Error {
  readonly code = "JOB_NO_JD_SOURCE" as const;
  constructor() {
    super("This role has no stored JD text or URL to re-triage.");
    this.name = "JobNoJdSourceError";
  }
}

export function canConfirmApplied(job: Pick<JobRecord, "recommendation" | "score">): boolean {
  return true;
}

export class JobsService {
  /** Ephemeral scored jobs until user confirms they actually applied. */
  private readonly draftJobs = new Map<string, JobRecord>();

  async runTriage(input: {
    url?: string;
    rawText?: string;
    companyHint?: string;
    fullPrep?: boolean;
  }): Promise<JobRecord> {
    const result = await triageJob(input);
    this.draftJobs.set(result.id, result);
    return result;
  }

  /** Re-run extraction, rules, and scoring for an existing draft or tracked role. */
  async runRetriage(id: string): Promise<{ job: JobRecord; tracked: boolean }> {
    const { job: prev, tracked } = await this.getByIdIncludingDraft(id);
    if (!prev) throw new JobNotFoundError();

    const rawText = prev.extracted.rawText?.trim();
    const url = prev.extracted.url?.trim();
    if (!rawText && !url) throw new JobNoJdSourceError();

    const fresh = await triageJob({
      url: url || undefined,
      rawText: rawText || undefined,
      companyHint:
        prev.extracted.listingCompanyName?.trim() ||
        prev.extracted.companyDisplayName?.trim() ||
        prev.extracted.company,
      fullPrep: false,
    });

    const now = new Date().toISOString();
    const historyEntry = {
      scoredAt: now,
      score: fresh.score,
      recommendation: fresh.recommendation,
    };
    const ts = prev.trackerSpreadsheet ?? {};
    const prevOriginal =
      typeof ts.originalAltScore === "string" && ts.originalAltScore.trim()
        ? ts.originalAltScore.trim()
        : "";

    const merged: JobRecord = {
      ...prev,
      extracted: fresh.extracted,
      rules: fresh.rules,
      score: fresh.score,
      recommendation: fresh.recommendation,
      salaryAsk: fresh.salaryAsk,
      recommendedResume: fresh.recommendedResume,
      resumeRationale: fresh.resumeRationale,
      topMatch: fresh.topMatch,
      mainRisk: fresh.mainRisk,
      rationale: fresh.rationale,
      risks: fresh.risks,
      debugExtraction: fresh.debugExtraction,
      generated: {},
      updatedAt: now,
      scoreHistory: [...(prev.scoreHistory ?? []), historyEntry],
      tracker: {
        ...prev.tracker,
        priority: fresh.tracker.priority,
        recommendedAction: fresh.tracker.recommendedAction,
        notes: prev.tracker.notes,
        statusOutcome: tracked ? (prev.tracker.statusOutcome ?? prev.status) : fresh.tracker.statusOutcome,
        shortlist: shouldShortlist(fresh.score.total, prev.status),
        color: getTrackerColor(prev.status, fresh.score.total),
      },
    };
    merged.trackerSpreadsheet = buildTrackerSpreadsheetFromJob(merged);
    if (tracked) {
      merged.trackerSpreadsheet = {
        ...merged.trackerSpreadsheet,
        originalAltScore: prevOriginal || String(prev.score.total),
        latestScore: String(fresh.score.total),
      };
    }

    if (tracked) {
      const saved = await jobsRepository.upsertJob(merged);
      return { job: saved, tracked: true };
    }
    this.draftJobs.set(id, merged);
    return { job: merged, tracked: false };
  }

  async getByIdIncludingDraft(id: string): Promise<{ job: JobRecord | null; tracked: boolean }> {
    const tracked = await jobsRepository.getById(id);
    if (tracked) return { job: tracked, tracked: true };
    const draft = this.draftJobs.get(id) ?? null;
    return { job: draft, tracked: false };
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
    const tracked = await jobsRepository.getById(jobId);
    const draft = tracked ? null : this.draftJobs.get(jobId);
    const job = tracked ?? draft;
    if (!job) throw new JobNotFoundError();
    const selectedResumeContext = (await resumeContextService.getContext(job.recommendedResume)) ?? undefined;
    const result = await generateJobAssets({ job, userProfile, selectedResumeContext, force: input?.force });
    if (result.skipped) {
      throw new AssetGenerationSkippedError(result.skipReason ?? "Asset generation skipped.");
    }
    if (tracked) {
      const updated = await jobsRepository.mergeGeneratedAssets(
        jobId,
        result.generated,
        result.debugAssetGeneration,
      );
      if (!updated) throw new JobNotFoundError();
      return updated;
    }
    const merged: JobRecord = {
      ...job,
      generated: result.generated,
      ...(result.debugAssetGeneration !== undefined
        ? { debugAssetGeneration: result.debugAssetGeneration }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    this.draftJobs.set(jobId, merged);
    return merged;
  }

  async generateAssetsFromJobBody(body: {
    job: JobRecord;
    persist?: boolean;
    force?: boolean;
  }): Promise<JobRecord> {
    const { job, persist, force } = body;
    const selectedResumeContext = (await resumeContextService.getContext(job.recommendedResume)) ?? undefined;
    const result = await generateJobAssets({ job, userProfile, selectedResumeContext, force });
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

  async removeFromTracker(id: string): Promise<void> {
    const deletedTracked = await jobsRepository.deleteById(id);
    const deletedDraft = this.draftJobs.delete(id);
    if (!deletedTracked && !deletedDraft) throw new JobNotFoundError();
  }

  async confirmApplied(id: string): Promise<JobRecord> {
    const existing = await jobsRepository.getById(id);
    if (existing) return existing;
    const draft = this.draftJobs.get(id);
    if (!draft) throw new JobNotFoundError();
    if (!canConfirmApplied(draft)) {
      throw new JobConfirmNotAllowedError();
    }

    const now = new Date().toISOString();
    const toPersist: JobRecord = {
      ...draft,
      status: "applied",
      updatedAt: now,
      tracker: {
        ...draft.tracker,
        statusOutcome: "applied",
        shortlist: shouldShortlist(draft.score.total, "applied"),
        color: getTrackerColor("applied", draft.score.total),
      },
      statusHistory: [
        ...(draft.statusHistory ?? []),
        {
          id: randomUUID(),
          jobId: draft.id,
          fromStatus: draft.status,
          toStatus: "applied",
          note: "Confirmed I applied",
          createdAt: now,
        },
      ],
    };

    const saved = await jobsRepository.upsertJob(toPersist);
    this.draftJobs.delete(id);
    return saved;
  }
}

export const jobsService = new JobsService();
