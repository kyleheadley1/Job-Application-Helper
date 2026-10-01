import { getDb } from "../../config/mongo.js";
import type { JobRecord } from "../../types/job.js";

export type CaptureMethod = "selection" | "jsonld" | "container" | "paste";
export type CaptureStatus = "queued" | "scoring" | "complete" | "failed";

export type JobCapture = {
  id: string;
  sourceUrl?: string;
  normalizedSourceUrl?: string;
  pageTitle?: string;
  jdText: string;
  captureMethod: CaptureMethod;
  jdTextHash: string;
  status: CaptureStatus;
  error?: string;
  jobId?: string;
  result?: JobRecord;
  createdAt: string;
  updatedAt: string;
};

type CaptureDoc = JobCapture & { _id: string };

const ACTIVE_STATUSES: CaptureStatus[] = ["queued", "scoring", "complete"];

export class CapturesRepository {
  private async collection() {
    const db = await getDb();
    return db.collection<CaptureDoc>("job_captures");
  }

  private fromDoc(doc: CaptureDoc): JobCapture {
    const { _id, ...rest } = doc;
    return { ...rest, id: rest.id ?? _id };
  }

  async insert(capture: JobCapture): Promise<JobCapture> {
    const col = await this.collection();
    await col.insertOne({ ...capture, _id: capture.id });
    return capture;
  }

  async getById(id: string): Promise<JobCapture | null> {
    const col = await this.collection();
    const doc = await col.findOne({ _id: id });
    return doc ? this.fromDoc(doc) : null;
  }

  async findByJobId(jobId: string): Promise<JobCapture | null> {
    const col = await this.collection();
    const doc = await col.findOne({ jobId });
    return doc ? this.fromDoc(doc) : null;
  }

  /** Most recent non-failed capture with the same JD text or the same source URL. */
  async findActiveDuplicate(params: {
    jdTextHash: string;
    normalizedSourceUrl?: string;
  }): Promise<JobCapture | null> {
    const col = await this.collection();
    const or: Array<Record<string, string>> = [{ jdTextHash: params.jdTextHash }];
    if (params.normalizedSourceUrl) {
      or.push({ normalizedSourceUrl: params.normalizedSourceUrl });
    }
    const doc = await col.findOne(
      { $or: or, status: { $in: ACTIVE_STATUSES } },
      { sort: { createdAt: -1 } },
    );
    return doc ? this.fromDoc(doc) : null;
  }

  async update(id: string, patch: Partial<Omit<JobCapture, "id">>): Promise<JobCapture | null> {
    const col = await this.collection();
    const updatedAt = new Date().toISOString();
    const set: Record<string, unknown> = { updatedAt };
    const unset: Record<string, ""> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) unset[key] = "";
      else set[key] = value;
    }
    const doc = await col.findOneAndUpdate(
      { _id: id },
      Object.keys(unset).length > 0 ? { $set: set, $unset: unset } : { $set: set },
      { returnDocument: "after" },
    );
    return doc ? this.fromDoc(doc) : null;
  }

  async listRecent(limit: number): Promise<JobCapture[]> {
    const col = await this.collection();
    const docs = await col
      .find({}, { projection: { jdText: 0 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return docs.map((doc) => this.fromDoc(doc as CaptureDoc));
  }

  async listUnfinished(): Promise<JobCapture[]> {
    const col = await this.collection();
    const docs = await col
      .find({ status: { $in: ["queued", "scoring"] } })
      .sort({ createdAt: 1 })
      .toArray();
    return docs.map((doc) => this.fromDoc(doc));
  }

  async deleteByJobId(jobId: string): Promise<boolean> {
    const col = await this.collection();
    const res = await col.deleteMany({ jobId });
    return res.deletedCount > 0;
  }
}

export const capturesRepository = new CapturesRepository();
