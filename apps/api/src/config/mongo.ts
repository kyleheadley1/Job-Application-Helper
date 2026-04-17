import { MongoClient, type Db } from "mongodb";
import { env } from "./env.js";
import { logger } from "../lib/logger.js";

let client: MongoClient | null = null;
let db: Db | null = null;
let dbOverride: Db | null = null;
let indexesEnsured = false;

const ensureIndexes = async (targetDb: Db): Promise<void> => {
  if (indexesEnsured) return;
  const jobs = targetDb.collection("jobs");
  await Promise.all([
    jobs.createIndex({ status: 1, updatedAt: -1 }),
    jobs.createIndex({ "tracker.shortlist": 1, updatedAt: -1 }),
    jobs.createIndex({ recommendedResume: 1, updatedAt: -1 }),
    jobs.createIndex({ recommendation: 1, updatedAt: -1 }),
    jobs.createIndex({ "score.total": -1 }),
    jobs.createIndex({ "extracted.company": 1 }),
    jobs.createIndex({ updatedAt: -1 }),
  ]);
  indexesEnsured = true;
};

export const getDb = async (): Promise<Db> => {
  if (dbOverride) return dbOverride;
  if (db) return db;
  client = new MongoClient(env.mongoUri, { ignoreUndefined: true });
  await client.connect();
  db = client.db(env.mongoDbName);
  await ensureIndexes(db);
  logger.info("MongoDB connected", { dbName: env.mongoDbName });
  return db;
};

export const closeDb = async (): Promise<void> => {
  if (client) {
    await client.close();
  }
  client = null;
  db = null;
  indexesEnsured = false;
};

/** Test-only helper to inject an isolated DB (e.g., mongodb-memory-server). */
export const setDbOverrideForTests = async (override: Db | null): Promise<void> => {
  dbOverride = override;
  if (dbOverride) {
    await ensureIndexes(dbOverride);
  } else {
    indexesEnsured = false;
  }
};
