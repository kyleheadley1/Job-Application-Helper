import express from "express";
import cors from "cors";
import helmet from "helmet";
import { ZodError } from "zod";
import { jobsRouter } from "./routes/jobs.routes.js";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/jobs", jobsRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    res.status(400).json({ message: "Validation error", issues: error.issues });
    return;
  }
  if (error instanceof Error && /fetch|extract|response|upstream/i.test(error.message)) {
    res.status(502).json({ message: "Upstream triage dependency failed", detail: error.message });
    return;
  }
  res.status(500).json({ message: "Internal server error" });
});
