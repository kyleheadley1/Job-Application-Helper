import { MongoClient, type Db } from "mongodb";
import { env } from "./env.js";

let client: MongoClient | null = null;
let db: Db | null = null;

export const getDb = async (): Promise<Db> => {
  if (db) return db;
  client = new MongoClient(env.mongoUri);
  await client.connect();
  db = client.db(env.mongoDbName);
  return db;
};

export const closeDb = async (): Promise<void> => {
  if (client) {
    await client.close();
  }
  client = null;
  db = null;
};
