import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger.js";
import { DEFAULT_TOP_JOBS_SYNC_TIMEZONE } from "../services/topJobs/topJobsScheduleTime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Monorepo (repository) root from this file’s directory:
 * `config` → `src` → `api` → `apps` → repo root = four `..` segments.
 * (Three levels only reached `apps/`, which wrongly pointed at `apps/.env`.)
 */
export const repoRootDir = path.resolve(__dirname, "..", "..", "..", "..");

/** Single intended secrets file for the whole monorepo (do not rely on `cwd`). */
export const rootEnvPath = path.join(repoRootDir, ".env");

const loadResult = dotenv.config({ path: rootEnvPath });

if (loadResult.error) {
  const code = (loadResult.error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    logger.warn("Root .env not found; using process.env only", { rootEnvPath, cwd: process.cwd() });
  } else {
    logger.error("Failed to load root .env", {
      rootEnvPath,
      cwd: process.cwd(),
      message: loadResult.error.message,
    });
  }
} else {
  logger.info("Loaded monorepo root .env", {
    rootEnvPath,
    openAiKeyConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 0),
  });
}

const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/job_agent_mvp",
  mongoDbName: process.env.MONGO_DB_NAME ?? "job_agent_mvp",
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-5-mini",
  resumeContextDir: process.env.RESUME_CONTEXT_DIR,
  autoImportTrackerOnStart: parseBooleanEnv(
    process.env.AUTO_IMPORT_TRACKER_ON_START,
    true,
  ),
  trackerSeedWorkbookPath: process.env.TRACKER_SEED_WORKBOOK_PATH,
  triageFastMode: parseBooleanEnv(process.env.TRIAGE_FAST_MODE, false),
  triageSkipLlmResumeSelectionInFastMode: parseBooleanEnv(
    process.env.TRIAGE_SKIP_LLM_RESUME_SELECTION_IN_FAST_MODE,
    true,
  ),
  preloadResumeContextOnStart: parseBooleanEnv(
    process.env.PRELOAD_RESUME_CONTEXT_ON_START,
    true,
  ),
  rapidApiKey: process.env.RAPIDAPI_KEY,
  topJobsSyncEnabled: parseBooleanEnv(process.env.TOP_JOBS_SYNC_ENABLED, false),
  /** Cron in TOP_JOBS_SYNC_TIMEZONE — default 6:00 AM US Eastern daily. */
  topJobsSyncCron: process.env.TOP_JOBS_SYNC_CRON ?? "0 6 * * *",
  topJobsSyncTimezone: process.env.TOP_JOBS_SYNC_TIMEZONE ?? DEFAULT_TOP_JOBS_SYNC_TIMEZONE,
  topJobsSyncScheduleHour: Number(process.env.TOP_JOBS_SYNC_SCHEDULE_HOUR ?? 6),
  topJobsSyncScheduleMinute: Number(process.env.TOP_JOBS_SYNC_SCHEDULE_MINUTE ?? 0),
  topJobsSyncCatchupOnStart: parseBooleanEnv(process.env.TOP_JOBS_SYNC_CATCHUP_ON_START, true),
  topJobsMaxTriagesPerSync: Number(process.env.TOP_JOBS_MAX_TRIAGES_PER_SYNC ?? 15),
  topJobsMinScore: Number(process.env.TOP_JOBS_MIN_SCORE ?? 70),
  /** Max listing age for discovery fetch (days). Default 14 = two weeks. */
  topJobsListingMaxAgeDays: Number(process.env.TOP_JOBS_LISTING_MAX_AGE_DAYS ?? 14),
  topJobsManualRefreshCooldownMin: Number(
    process.env.TOP_JOBS_MANUAL_REFRESH_COOLDOWN_MIN ??
      (process.env.NODE_ENV === "development" ? 1 : 60),
  ),
  topJobsSource: (process.env.TOP_JOBS_SOURCE ?? "auto") as "auto" | "jsearch" | "jobsbase",
  jsearchMonthlyCap: Number(process.env.JSEARCH_MONTHLY_CAP ?? 180),
  jsearchNumPages: Number(process.env.JSEARCH_NUM_PAGES ?? 2),
  jsearchDatePosted: (process.env.JSEARCH_DATE_POSTED ?? "month") as
    | "week"
    | "month"
    | "3days"
    | "today"
    | "all",
  /** Resolved path used for dotenv (audit / support). */
  rootEnvPath,
  rootEnvFileExists: fs.existsSync(rootEnvPath),
};
