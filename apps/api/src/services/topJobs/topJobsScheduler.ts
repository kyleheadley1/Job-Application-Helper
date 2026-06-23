import cron, { type ScheduledTask } from "node-cron";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { runTopJobsSync } from "./topJobsSync.js";
import { topJobsRepository } from "./topJobs.repository.js";
import { needsCatchupSync } from "./topJobsScheduleTime.js";

let scheduledTask: ScheduledTask | null = null;

const runBackgroundSync = async (reason: "scheduled" | "catchup"): Promise<void> => {
  try {
    const stats = await runTopJobsSync({ manual: false });
    logger.info(`Top jobs ${reason} sync completed`, stats);
  } catch (error) {
    logger.error(`Top jobs ${reason} sync failed`, {
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export const maybeRunCatchupSync = async (): Promise<void> => {
  if (!env.topJobsSyncEnabled || !env.topJobsSyncCatchupOnStart) {
    return;
  }

  const meta = await topJobsRepository.getSyncMeta();
  const shouldRun = needsCatchupSync({
    lastSyncAt: meta.lastSyncAt,
    timeZone: env.topJobsSyncTimezone,
    scheduleHour: env.topJobsSyncScheduleHour,
    scheduleMinute: env.topJobsSyncScheduleMinute,
  });

  if (!shouldRun) {
    logger.info("Top jobs catchup not needed", {
      lastSyncAt: meta.lastSyncAt,
      timezone: env.topJobsSyncTimezone,
      scheduleHour: env.topJobsSyncScheduleHour,
    });
    return;
  }

  logger.info("Top jobs catchup sync starting", {
    timezone: env.topJobsSyncTimezone,
    scheduleHour: env.topJobsSyncScheduleHour,
    lastSyncAt: meta.lastSyncAt,
  });
  await runBackgroundSync("catchup");
};

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

  scheduledTask = cron.schedule(
    env.topJobsSyncCron,
    () => {
      void runBackgroundSync("scheduled");
    },
    { timezone: env.topJobsSyncTimezone },
  );

  logger.info("Top jobs scheduler started", {
    cron: env.topJobsSyncCron,
    timezone: env.topJobsSyncTimezone,
    catchupOnStart: env.topJobsSyncCatchupOnStart,
  });

  void maybeRunCatchupSync();
};

export const stopTopJobsScheduler = (): void => {
  scheduledTask?.stop();
  scheduledTask = null;
};
