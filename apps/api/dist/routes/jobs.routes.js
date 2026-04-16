import { Router } from "express";
import { TriageRequestSchema, TriageResponseSchema } from "../agents/jobAgent/schemas.js";
import { jobsService } from "../services/jobs/jobs.service.js";
export const jobsRouter = Router();
jobsRouter.post("/triage", async (req, res, next) => {
    try {
        const payload = TriageRequestSchema.parse(req.body);
        const result = await jobsService.runTriage(payload);
        const validated = TriageResponseSchema.parse(result);
        res.json(validated);
    }
    catch (error) {
        next(error);
    }
});
