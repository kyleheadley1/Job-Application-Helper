import { MongoClient } from "mongodb";
import { env } from "./env.js";
let client = null;
let db = null;
export const getDb = async () => {
    if (db)
        return db;
    client = new MongoClient(env.mongoUri);
    await client.connect();
    db = client.db(env.mongoDbName);
    return db;
};
export const closeDb = async () => {
    if (client) {
        await client.close();
    }
    client = null;
    db = null;
};
