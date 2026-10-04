import { getDb } from "../../config/mongo.js";
import type { AlertPlatform } from "../../types/topJob.js";

export type AlertListingStatus = "pending" | "filtered" | "duplicate" | "jd_unavailable" | "below_min" | "stored";

export type AlertListingDoc = {
  /** Normalized company + title, so the same role from several platforms collapses into one row. */
  _id: string;
  company: string;
  title: string;
  location: string | null;
  platforms: AlertPlatform[];
  links: Array<{ platform: AlertPlatform; url: string; externalId?: string }>;
  emailIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  status: AlertListingStatus;
  reason?: string;
  topJobId?: string;
  processedAt?: string;
};

export type AlertMessageDoc = {
  _id: string;
  platform: AlertPlatform | null;
  date: string;
  listings: number;
  processedAt: string;
};

export type NewAlertListing = {
  key: string;
  company: string;
  title: string;
  location: string | null;
  platform: AlertPlatform;
  url: string | null;
  externalId?: string;
  emailId: string;
  emailDate: string;
};

export const alertListingsRepository = {
  async listings() {
    const db = await getDb();
    return db.collection<AlertListingDoc>("top_jobs_alert_listings");
  },

  async messages() {
    const db = await getDb();
    return db.collection<AlertMessageDoc>("top_jobs_alert_messages");
  },

  async processedMessageIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const col = await this.messages();
    const docs = await col.find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray();
    return new Set(docs.map((d) => d._id));
  },

  async markMessageProcessed(doc: Omit<AlertMessageDoc, "processedAt">): Promise<void> {
    const col = await this.messages();
    await col.updateOne(
      { _id: doc._id },
      { $set: { ...doc, processedAt: new Date().toISOString() } },
      { upsert: true },
    );
  },

  async upsertListing(l: NewAlertListing): Promise<void> {
    const col = await this.listings();
    await col.updateOne(
      { _id: l.key },
      {
        $setOnInsert: {
          company: l.company,
          title: l.title,
          location: l.location,
          firstSeenAt: l.emailDate,
          status: "pending",
        },
        $addToSet: {
          platforms: l.platform,
          emailIds: l.emailId,
          ...(l.url ? { links: { platform: l.platform, url: l.url, ...(l.externalId ? { externalId: l.externalId } : {}) } } : {}),
        },
        $max: { lastSeenAt: l.emailDate },
      },
      { upsert: true },
    );
  },

  async listPending(sinceIso: string): Promise<AlertListingDoc[]> {
    const col = await this.listings();
    return col.find({ status: "pending", lastSeenAt: { $gte: sinceIso } }).sort({ lastSeenAt: -1 }).toArray();
  },

  async countPending(sinceIso: string): Promise<number> {
    const col = await this.listings();
    return col.countDocuments({ status: "pending", lastSeenAt: { $gte: sinceIso } });
  },

  async setOutcome(
    key: string,
    outcome: { status: Exclude<AlertListingStatus, "pending">; reason?: string; topJobId?: string },
  ): Promise<void> {
    const col = await this.listings();
    await col.updateOne({ _id: key }, { $set: { ...outcome, processedAt: new Date().toISOString() } });
  },
};
