import { jobsService } from "../services/jobs/jobs.service.js";
export const updateJobStatus = async (id, status, note) => jobsService.updateStatus(id, status, note);
