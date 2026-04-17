import { triageJob } from "../../agents/jobAgent/orchestrator.js";
import { AssetGenerationSkippedError, generateJobAssets, } from "../../agents/jobAgent/assetGeneration.js";
import { userProfile } from "../../config/userProfile.js";
import { jobsRepository } from "./jobs.repository.js";
export class JobNotFoundError extends Error {
    code = "JOB_NOT_FOUND";
    constructor() {
        super("Job not found");
        this.name = "JobNotFoundError";
    }
}
export class JobsService {
    async runTriage(input) {
        const result = await triageJob(input);
        return jobsRepository.saveTriage(result);
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
        const job = await jobsRepository.getById(jobId);
        if (!job)
            throw new JobNotFoundError();
        const result = await generateJobAssets({ job, userProfile, force: input?.force });
        if (result.skipped) {
            throw new AssetGenerationSkippedError(result.skipReason ?? "Asset generation skipped.");
        }
        const updated = await jobsRepository.mergeGeneratedAssets(jobId, result.generated, result.debugAssetGeneration);
        if (!updated)
            throw new JobNotFoundError();
        return updated;
    }
    async generateAssetsFromJobBody(body) {
        const { job, persist, force } = body;
        const result = await generateJobAssets({ job, userProfile, force });
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
}
export const jobsService = new JobsService();
