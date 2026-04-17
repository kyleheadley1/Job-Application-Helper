import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger.js";

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

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/job_agent_mvp",
  mongoDbName: process.env.MONGO_DB_NAME ?? "job_agent_mvp",
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-5-mini",
  resumeContextDir: process.env.RESUME_CONTEXT_DIR,
  /** Resolved path used for dotenv (audit / support). */
  rootEnvPath,
  rootEnvFileExists: fs.existsSync(rootEnvPath),
};
