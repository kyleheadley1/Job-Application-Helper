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
  /** Shared secret the Chrome extension sends as `Authorization: Bearer <token>`. */
  extensionApiToken: process.env.EXTENSION_API_TOKEN?.trim() || undefined,
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || undefined,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined,
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI?.trim() || "http://localhost:4000/api/gmail/oauth/callback",
  /** Where the OAuth callback sends the browser back to (the web app dashboard). */
  webAppUrl: (process.env.WEB_APP_URL?.trim() || "http://localhost:5173").replace(/\/+$/, ""),
  serperApiKey: process.env.SERPER_API_KEY?.trim() || undefined,
  /** Lifetime Serper query budget (the free grant is 2,500 one-time queries). */
  serperMaxQueriesTotal: Number(process.env.SERPER_MAX_QUERIES_TOTAL ?? 1250),
  /** Email classification is simple; low effort cuts hidden reasoning tokens (billed as output). */
  gmailClassifyReasoningEffort: (["minimal", "low", "medium", "high"] as const).find(
    (e) => e === (process.env.GMAIL_CLASSIFY_REASONING_EFFORT ?? "minimal"),
  ),
  /** IANA zone assumed for interview times that an email states without a timezone. */
  userTimezone: process.env.USER_TIMEZONE?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone,
  /** USD per 1M tokens; defaults are gpt-5-mini list prices. */
  openAiInputPricePerM: Number(process.env.OPENAI_INPUT_PRICE_PER_M ?? 0.25),
  openAiCachedInputPricePerM: Number(process.env.OPENAI_CACHED_INPUT_PRICE_PER_M ?? 0.025),
  openAiOutputPricePerM: Number(process.env.OPENAI_OUTPUT_PRICE_PER_M ?? 2),
  jdRecoveryMaxPerRun: Number(process.env.JD_RECOVERY_MAX_PER_RUN ?? 5),
  /** Minutes between background Gmail syncs (0 disables). */
  gmailAutoSyncMinutes: Math.max(0, Number(process.env.GMAIL_AUTO_SYNC_MINUTES ?? 15) || 0),
  /** Daily job-alert scan; runs only while Gmail is connected. */
  topJobsSyncEnabled: parseBooleanEnv(process.env.TOP_JOBS_SYNC_ENABLED, true),
  /** Cron in TOP_JOBS_SYNC_TIMEZONE — default 6:00 AM US Eastern daily. */
  topJobsSyncCron: process.env.TOP_JOBS_SYNC_CRON ?? "0 6 * * *",
  topJobsSyncTimezone: process.env.TOP_JOBS_SYNC_TIMEZONE ?? DEFAULT_TOP_JOBS_SYNC_TIMEZONE,
  topJobsSyncScheduleHour: Number(process.env.TOP_JOBS_SYNC_SCHEDULE_HOUR ?? 6),
  topJobsSyncScheduleMinute: Number(process.env.TOP_JOBS_SYNC_SCHEDULE_MINUTE ?? 0),
  topJobsSyncCatchupOnStart: parseBooleanEnv(process.env.TOP_JOBS_SYNC_CATCHUP_ON_START, true),
  topJobsMaxTriagesPerSync: Number(process.env.TOP_JOBS_MAX_TRIAGES_PER_SYNC ?? 5),
  /** Hard monthly OpenAI spend cap for Top Jobs (alert parsing + scoring), paced evenly per day. */
  topJobsMonthlyBudgetUsd: Number(process.env.TOP_JOBS_MONTHLY_BUDGET_USD ?? 2),
  /** Daily next-steps agent; runs once a day after a Gmail sync. */
  agentEnabled: parseBooleanEnv(process.env.AGENT_ENABLED, true),
  /** Hard monthly OpenAI spend cap for the agent, paced evenly per day. Over budget it falls back to free rules. */
  agentMonthlyBudgetUsd: Number(process.env.AGENT_MONTHLY_BUDGET_USD ?? 1.5),
  /** Hard monthly OpenAI spend cap for the on-demand chat assistant, paced evenly per day. */
  assistantMonthlyBudgetUsd: Number(process.env.ASSISTANT_MONTHLY_BUDGET_USD ?? 1.5),
  /** Hard monthly OpenAI spend cap for the plain-English summary on the weekly insights run. */
  insightsMonthlyBudgetUsd: Number(process.env.INSIGHTS_MONTHLY_BUDGET_USD ?? 0.3),
  topJobsMinScore: Number(process.env.TOP_JOBS_MIN_SCORE ?? 70),
  /** How far back alert emails are read, and how long an unchecked alert role stays queued (days). */
  topJobsListingMaxAgeDays: Number(process.env.TOP_JOBS_LISTING_MAX_AGE_DAYS ?? 14),
  topJobsManualRefreshCooldownMin: Number(
    process.env.TOP_JOBS_MANUAL_REFRESH_COOLDOWN_MIN ??
      (process.env.NODE_ENV === "development" ? 1 : 60),
  ),
  /** Resolved path used for dotenv (audit / support). */
  rootEnvPath,
  rootEnvFileExists: fs.existsSync(rootEnvPath),
};
