import { Router } from "express";
import {
  AssetGenerationSkippedError,
} from "../agents/jobAgent/assetGeneration.js";
import {
  GenerateAssetsForIdBodySchema,
  GenerateAssetsFromJobBodySchema,
  JobRecordSchema,
  TriageRequestSchema,
  TriageResponseSchema,
} from "../agents/jobAgent/schemas.js";
import { JobNotFoundError, jobsService } from "../services/jobs/jobs.service.js";

export const jobsRouter = Router();

jobsRouter.post("/triage", async (req, res, next) => {
  try {
    const payload = TriageRequestSchema.parse(req.body);
    const result = await jobsService.runTriage(payload);
    const validated = TriageResponseSchema.parse(result);
    res.json(validated);
  } catch (error) {
    next(error);
  }
});

jobsRouter.post("/generate-assets", async (req, res, next) => {
  try {
    const body = GenerateAssetsFromJobBodySchema.parse(req.body);
    const job = await jobsService.generateAssetsFromJobBody(body);
    res.json(JobRecordSchema.parse(job));
  } catch (error) {
    if (error instanceof AssetGenerationSkippedError) {
      res.status(400).json({ error: error.code, message: error.message });
      return;
    }
    next(error);
  }
});

jobsRouter.get("/:id", async (req, res, next) => {
  try {
    const job = await jobsService.getById(req.params.id);
    if (!job) {
      res.status(404).json({ error: "JOB_NOT_FOUND", message: "Job not found" });
      return;
    }
    res.json(JobRecordSchema.parse(job));
  } catch (error) {
    next(error);
  }
});

jobsRouter.post("/:id/generate-assets", async (req, res, next) => {
  try {
    const body = GenerateAssetsForIdBodySchema.parse(req.body ?? {});
    const job = await jobsService.generateAssetsForJobId(req.params.id, body);
    res.json(JobRecordSchema.parse(job));
  } catch (error) {
    if (error instanceof AssetGenerationSkippedError) {
      res.status(400).json({ error: error.code, message: error.message });
      return;
    }
    if (error instanceof JobNotFoundError) {
      res.status(404).json({ error: error.code, message: error.message });
      return;
    }
    next(error);
  }
});
