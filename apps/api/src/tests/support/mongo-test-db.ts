import { MongoClient } from "mongodb";
import { env } from "../../config/env.js";
import { setDbOverrideForTests } from "../../config/mongo.js";

export type MongoTestHarness = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export const createMongoTestHarness = (dbName = "api_test"): MongoTestHarness => {
  let client: MongoClient | null = null;
  let dbNameResolved = "";

  return {
    start: async () => {
      client = new MongoClient(env.mongoUri, { ignoreUndefined: true });
      await client.connect();
      dbNameResolved = `${dbName}_${Date.now()}`;
      const db = client.db(dbNameResolved);
      await setDbOverrideForTests(db);
    },
    stop: async () => {
      await setDbOverrideForTests(null);
      if (client) {
        if (dbNameResolved) {
          await client.db(dbNameResolved).dropDatabase().catch(() => undefined);
        }
        await client.close();
      }
      client = null;
      dbNameResolved = "";
    },
  };
};

