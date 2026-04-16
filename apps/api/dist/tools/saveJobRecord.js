import { jobsService } from "../services/jobs/jobs.service.js";
export const saveJobRecord = async (job) => jobsService.saveJob(job);
