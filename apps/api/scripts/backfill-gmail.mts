#!/usr/bin/env tsx
import { getDb, closeDb } from "../src/config/mongo.js";
import { backfillGmailRange } from "../src/services/gmail/gmailSync.js";
import { logger } from "../src/lib/logger.js";

const usage = "Usage: npm run backfill:gmail --workspace api -- 2025-09-01 2026-09-04";

const parseDay = (value: string | undefined): Date => {
  const date = new Date(`${value ?? ""}T00:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "") || Number.isNaN(date.getTime())) throw new Error(usage);
  return date;
};

const main = async (): Promise<void> => {
  const [afterArg, beforeArg] = process.argv.slice(2);
  const after = parseDay(afterArg);
  const before = parseDay(beforeArg);
  if (after >= before) throw new Error(`The start date must be before the end date. ${usage}`);
  await getDb();
  const result = await backfillGmailRange(after, before);
  logger.info("Gmail backfill CLI finished", result);
  await closeDb();
  process.exit(0);
};

main().catch(async (error) => {
  logger.error("Gmail backfill CLI failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  await closeDb();
  process.exit(1);
});
