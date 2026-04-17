import { Router } from "express";
import { AssetGenerationSkippedError, } from "../agents/jobAgent/assetGeneration.js";
import { GenerateAssetsForIdBodySchema, GenerateAssetsFromJobBodySchema, JobExportQuerySchema, JobExportRowSchema, JobListQuerySchema, JobRecordSchema, TriageRequestSchema, TriageResponseSchema, UpdateJobNotesBodySchema, UpdateJobStatusBodySchema, } from "../agents/jobAgent/schemas.js";
import { JobNotFoundError, jobsService } from "../services/jobs/jobs.service.js";
import { TRACKER_EXPORT_HEADERS } from "../tracker/canonicalSpreadsheet.js";
export const jobsRouter = Router();
const toCsvCell = (value) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, "\"\"")}"`;
    }
    return text;
};
const toCsv = (rows) => {
    if (rows.length === 0)
        return "";
    const headers = [...TRACKER_EXPORT_HEADERS];
    const headerLine = headers.map((h) => toCsvCell(h)).join(",");
    const lines = rows.map((row) => headers.map((h) => toCsvCell(row[h] ?? "")).join(","));
    return [headerLine, ...lines].join("\n");
};
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
jobsRouter.post("/generate-assets", async (req, res, next) => {
    try {
        const body = GenerateAssetsFromJobBodySchema.parse(req.body);
        const job = await jobsService.generateAssetsFromJobBody(body);
        res.json(JobRecordSchema.parse(job));
    }
    catch (error) {
        if (error instanceof AssetGenerationSkippedError) {
            res.status(400).json({ error: error.code, message: error.message });
            return;
        }
        next(error);
    }
});
jobsRouter.get("/", async (req, res, next) => {
    try {
        const query = JobListQuerySchema.parse(req.query);
        const result = await jobsService.list(query);
        res.json({
            items: result.items.map((item) => JobRecordSchema.parse(item)),
            total: result.total,
            totalAll: result.totalAll,
            filtersApplied: query,
        });
    }
    catch (error) {
        next(error);
    }
});
jobsRouter.get("/export", async (req, res, next) => {
    try {
        const query = JobExportQuerySchema.parse(req.query);
        const { format = "json", ...filters } = query;
        const result = await jobsService.exportRows(filters);
        const rows = result.rows.map((row) => JobExportRowSchema.parse(row));
        if (format === "csv") {
            const csv = toCsv(rows);
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader("Content-Disposition", "attachment; filename=\"jobs-export.csv\"");
            res.send(csv);
            return;
        }
        res.json({
            rows,
            total: result.total,
            filtersApplied: filters,
        });
    }
    catch (error) {
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
    }
    catch (error) {
        next(error);
    }
});
jobsRouter.patch("/:id/status", async (req, res, next) => {
    try {
        const body = UpdateJobStatusBodySchema.parse(req.body ?? {});
        const job = await jobsService.updateStatus(req.params.id, body.status, body.note);
        res.json(JobRecordSchema.parse(job));
    }
    catch (error) {
        if (error instanceof JobNotFoundError) {
            res.status(404).json({ error: error.code, message: error.message });
            return;
        }
        next(error);
    }
});
jobsRouter.patch("/:id/notes", async (req, res, next) => {
    try {
        const body = UpdateJobNotesBodySchema.parse(req.body ?? {});
        const job = await jobsService.updateNotes(req.params.id, body.notes);
        res.json(JobRecordSchema.parse(job));
    }
    catch (error) {
        if (error instanceof JobNotFoundError) {
            res.status(404).json({ error: error.code, message: error.message });
            return;
        }
        next(error);
    }
});
jobsRouter.post("/:id/generate-assets", async (req, res, next) => {
    try {
        const body = GenerateAssetsForIdBodySchema.parse(req.body ?? {});
        const job = await jobsService.generateAssetsForJobId(req.params.id, body);
        res.json(JobRecordSchema.parse(job));
    }
    catch (error) {
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
