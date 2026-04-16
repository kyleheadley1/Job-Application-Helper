import { jobsService } from "../services/jobs/jobs.service.js";
export const searchPastApplications = async (company) => jobsService.listJobs({
    company,
});
