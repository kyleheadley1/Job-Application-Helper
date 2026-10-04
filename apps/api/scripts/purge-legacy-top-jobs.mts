#!/usr/bin/env tsx
/**
 * One-time cleanup: deletes Top Jobs rows from the retired JSearch / jobsbase sources.
 * Rows already added to the tracker are kept; tracker jobs are never touched.
 * Dry run by default; pass --yes to delete.
 */
import { getDb, closeDb } from "../src/config/mongo.js";

const LEGACY_SOURCES = ["jsearch", "jobsbase"];

const main = async (): Promise<void> => {
  const db = await getDb();
  const col = db.collection("top_jobs");
  const filter = { source: { $in: LEGACY_SOURCES }, promotedToJobId: { $exists: false } };
  const count = await col.countDocuments(filter);
  const kept = await col.countDocuments({ source: { $in: LEGACY_SOURCES }, promotedToJobId: { $exists: true } });
  if (!process.argv.includes("--yes")) {
    console.log(`Would delete ${count} legacy Top Jobs rows (keeping ${kept} added to the tracker). Re-run with --yes.`);
  } else {
    const { deletedCount } = await col.deleteMany(filter);
    console.log(`Deleted ${deletedCount} legacy Top Jobs rows (kept ${kept} added to the tracker).`);
  }
  await closeDb();
};

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await closeDb();
  process.exit(1);
});
