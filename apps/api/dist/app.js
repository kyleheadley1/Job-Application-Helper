import express from "express";
import cors from "cors";
import helmet from "helmet";
import { ZodError } from "zod";
import { jobsRouter } from "./routes/jobs.routes.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
export const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.get("/health", (_req, res) => {
    res.json({ ok: true });
});
app.use("/api/jobs", jobsRouter);
app.use((error, _req, res, _next) => {
    if (error instanceof ZodError) {
        res.status(400).json({ message: "Validation error", issues: error.issues });
        return;
    }
    const maybeParse = error;
    if (maybeParse.type === "entity.too.large") {
        res.status(413).json({
            message: "Request body too large",
            detail: "JSON payloads are limited to 2mb; paste a shorter JD or trim formatting.",
        });
        return;
    }
    if (error instanceof SyntaxError || maybeParse.type === "entity.parse.failed") {
        res.status(400).json({ message: "Invalid JSON body", detail: error.message });
        return;
    }
    const err = error instanceof Error ? error : new Error(String(error));
    if (/fetch|extract|response|upstream/i.test(err.message)) {
        res.status(502).json({ message: "Upstream triage dependency failed", detail: err.message });
        return;
    }
    logger.error("Unhandled API error", {
        message: err.message,
        stack: err.stack,
        name: err.name,
    });
    const isDev = env.nodeEnv !== "production";
    res.status(500).json({
        message: "Internal server error",
        ...(isDev ? { detail: err.message } : {}),
    });
});
