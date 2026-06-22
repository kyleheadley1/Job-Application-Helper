import cron, { type ScheduledTask } from "node-cron";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { runTopJobsSync } from "./topJobsSync.js";

let scheduledTask: ScheduledTask | null = null;

export const startTopJobsScheduler = (): void => {
  if (!env.topJobsSyncEnabled) {
    logger.info("Top jobs scheduler disabled");
    return;
  }
  if (scheduledTask) return;

  if (!cron.validate(env.topJobsSyncCron)) {
    logger.warn("Invalid TOP_JOBS_SYNC_CRON; scheduler not started", {
      cron: env.topJobsSyncCron,
    });
    return;
  }

  scheduledTask = cron.schedule(env.topJobsSyncCron, () => {
    runTopJobsSync({ manual: false }).catch((error) => {
      logger.error("Scheduled top jobs sync failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });

  logger.info("Top jobs scheduler started", { cron: env.topJobsSyncCron });
};

export const stopTopJobsScheduler = (): void => {
  scheduledTask?.stop();
  scheduledTask = null;
};
