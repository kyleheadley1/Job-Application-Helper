import fs from "node:fs";
import path from "node:path";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { closeDb, getDb } from "./config/mongo.js";
import { logger } from "./lib/logger.js";
import { runAllApplicationsImport } from "./tracker/runAllApplicationsImport.js";
import { jobsRepository } from "./services/jobs/jobs.repository.js";
import { repoRootDir } from "./config/env.js";
import { resumeContextService } from "./services/resume/resumeContext.js";
import { startTopJobsScheduler } from "./services/topJobs/topJobsScheduler.js";

const trackerWorkbookPath = (): string =>
  env.trackerSeedWorkbookPath?.trim()
    ? path.resolve(env.trackerSeedWorkbookPath)
    : path.join(repoRootDir, "data", "job_role_scores_current.xlsx");

const ensureTrackerSeed = async (): Promise<void> => {
  if (!env.autoImportTrackerOnStart) {
    logger.info("Tracker auto-import on start is disabled");
    return;
  }
  const workbookPath = trackerWorkbookPath();
  if (!fs.existsSync(workbookPath)) {
    logger.warn("Tracker seed workbook not found; skipping auto-import", { workbookPath });
    return;
  }
  const before = await jobsRepository.list({});
  const result = await runAllApplicationsImport(workbookPath);
  const after = await jobsRepository.list({});
  logger.info("Tracker auto-import completed on startup", {
    workbookPath,
    importedRowsProcessed: result.imported,
    skippedRows: result.skipped,
    totalBefore: before.totalAll,
    totalAfter: after.totalAll,
  });
};

const preloadResumeContext = async (): Promise<void> => {
  if (!env.preloadResumeContextOnStart) {
    logger.info("Resume context preload on start is disabled");
    return;
  }
  const started = Date.now();
  const contexts = await resumeContextService.getAvailableContexts();
  logger.info("Resume context preloaded on startup", {
    loadedTypes: Object.keys(contexts),
    elapsedMs: Date.now() - started,
  });
};

const start = async (): Promise<void> => {
  await getDb();
  await ensureTrackerSeed();
  await preloadResumeContext();
  startTopJobsScheduler();
  const server = app.listen(env.port, () => {
    logger.info("API server started", { port: env.port, env: env.nodeEnv });
  });

  const shutdown = async () => {
    server.close();
    await closeDb();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

start().catch((error) => {
  logger.error("API server failed to start", { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
