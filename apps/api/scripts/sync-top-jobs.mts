#!/usr/bin/env tsx
import { getDb, closeDb } from "../src/config/mongo.js";
import { runTopJobsSync } from "../src/services/topJobs/topJobsSync.js";
import { logger } from "../src/lib/logger.js";

const main = async (): Promise<void> => {
  await getDb();
  const stats = await runTopJobsSync({ manual: true });
  logger.info("Top jobs sync CLI finished", stats);
  await closeDb();
};

main().catch(async (error) => {
  logger.error("Top jobs sync CLI failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  await closeDb();
  process.exit(1);
});
