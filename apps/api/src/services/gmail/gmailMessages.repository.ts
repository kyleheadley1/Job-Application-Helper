import { getDb } from "../../config/mongo.js";
import type { EmailClassification } from "./gmailClassifier.js";

/** Per-message classification cache. Full email bodies are never stored. */
export type StoredGmailMessage = {
  id: string;
  threadId: string;
  date: string;
  from: string;
  subject: string;
  prefilterPassed: boolean;
  prefilterReason: string;
  /** Set only when the message went through the LLM. */
  classification?: EmailClassification;
  /** False when the LLM call failed; such messages are retried on the next sync. */
  llmSucceeded?: boolean;
  processedAt: string;
};

type Doc = StoredGmailMessage & { _id: string };

export const gmailMessagesRepository = {
  async collection() {
    const db = await getDb();
    return db.collection<Doc>("gmail_messages");
  },

  /** Ids already processed successfully (LLM failures are excluded so they get retried). */
  async findProcessedIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const col = await this.collection();
    const docs = await col
      .find(
        { _id: { $in: ids }, llmSucceeded: { $ne: false } },
        { projection: { _id: 1 } },
      )
      .toArray();
    return new Set(docs.map((d) => d._id));
  },

  async upsert(message: StoredGmailMessage): Promise<void> {
    const col = await this.collection();
    await col.replaceOne({ _id: message.id }, message, { upsert: true });
  },

  async listApplicationMessagesSince(sinceIso: string): Promise<StoredGmailMessage[]> {
    const col = await this.collection();
    const docs = await col
      .find({ date: { $gte: sinceIso }, "classification.isApplicationEmail": true })
      .sort({ date: 1 })
      .toArray();
    return docs.map(({ _id, ...rest }) => ({ ...rest, id: rest.id ?? _id }));
  },
};
