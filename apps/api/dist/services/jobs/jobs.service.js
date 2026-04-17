import { randomUUID } from "node:crypto";
import { triageJob } from "../../agents/jobAgent/orchestrator.js";
import { AssetGenerationSkippedError, generateJobAssets, } from "../../agents/jobAgent/assetGeneration.js";
import { userProfile } from "../../config/userProfile.js";
import { getTrackerColor, shouldShortlist } from "../../config/scoringPolicy.js";
import { jobsRepository } from "./jobs.repository.js";
import { resumeContextService } from "../resume/resumeContext.js";
export class JobNotFoundError extends Error {
    code = "JOB_NOT_FOUND";
    constructor() {
        super("Job not found");
        this.name = "JobNotFoundError";
    }
}
export class JobConfirmNotAllowedError extends Error {
    code = "JOB_CONFIRM_NOT_ALLOWED";
    constructor() {
        super("This scored role is not eligible for confirm-applied.");
        this.name = "JobConfirmNotAllowedError";
    }
}
export class JobsService {
    /** Ephemeral scored jobs until user confirms they actually applied. */
    draftJobs = new Map();
    async runTriage(input) {
        const result = await triageJob(input);
        this.draftJobs.set(result.id, result);
        return result;
    }
    async getByIdIncludingDraft(id) {
        const tracked = await jobsRepository.getById(id);
        if (tracked)
            return { job: tracked, tracked: true };
        const draft = this.draftJobs.get(id) ?? null;
        return { job: draft, tracked: false };
    }
    async getById(id) {
        return jobsRepository.getById(id);
    }
    async list(filters) {
        return jobsRepository.list(filters);
    }
    async exportRows(filters) {
        return jobsRepository.exportRows(filters);
    }
    async generateAssetsForJobId(jobId, input) {
        const tracked = await jobsRepository.getById(jobId);
        const draft = tracked ? null : this.draftJobs.get(jobId);
        const job = tracked ?? draft;
        if (!job)
            throw new JobNotFoundError();
        const selectedResumeContext = (await resumeContextService.getContext(job.recommendedResume)) ?? undefined;
        const result = await generateJobAssets({ job, userProfile, selectedResumeContext, force: input?.force });
        if (result.skipped) {
            throw new AssetGenerationSkippedError(result.skipReason ?? "Asset generation skipped.");
        }
        if (tracked) {
            const updated = await jobsRepository.mergeGeneratedAssets(jobId, result.generated, result.debugAssetGeneration);
            if (!updated)
                throw new JobNotFoundError();
            return updated;
        }
        const merged = {
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
    async generateAssetsFromJobBody(body) {
        const { job, persist, force } = body;
        const selectedResumeContext = (await resumeContextService.getContext(job.recommendedResume)) ?? undefined;
        const result = await generateJobAssets({ job, userProfile, selectedResumeContext, force });
        if (result.skipped) {
            throw new AssetGenerationSkippedError(result.skipReason ?? "Asset generation skipped.");
        }
        const merged = {
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
    async updateStatus(id, status, note) {
        const updated = await jobsRepository.updateStatus(id, status, note);
        if (!updated)
            throw new JobNotFoundError();
        return updated;
    }
    async updateNotes(id, notes) {
        const updated = await jobsRepository.updateNotes(id, notes);
        if (!updated)
            throw new JobNotFoundError();
        return updated;
    }
    async confirmApplied(id) {
        const existing = await jobsRepository.getById(id);
        if (existing)
            return existing;
        const draft = this.draftJobs.get(id);
        if (!draft)
            throw new JobNotFoundError();
        if (draft.recommendation === "no") {
            throw new JobConfirmNotAllowedError();
        }
        const now = new Date().toISOString();
        const toPersist = {
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
