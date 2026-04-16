import { triageJob } from "../../agents/jobAgent/orchestrator.js";
import { jobsRepository } from "./jobs.repository.js";
export class JobsService {
    async runTriage(input) {
        const result = await triageJob(input);
        return jobsRepository.saveTriage(result);
    }
}
export const jobsService = new JobsService();
