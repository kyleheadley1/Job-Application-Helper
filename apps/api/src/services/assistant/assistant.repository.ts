import { getDb } from "../../config/mongo.js";
import type { JobStatus } from "../../types/job.js";

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  /** Approval cards created while answering this message. */
  proposalIds?: string[];
  /** Lookups the assistant ran, for the "how did it know" line under an answer. */
  tools?: string[];
};

export type ProposalPayload =
  | { kind: "tracker_status"; jobId: string; company: string; title: string; fromStatus: JobStatus; status: JobStatus; note: string }
  | { kind: "email_draft"; appKey: string; company: string; role: string | null; emailKind: string; preferEmailId?: string; body: string }
  | { kind: "score_listing"; listingKey: string; company: string; title: string };

export type ProposalStatus = "open" | "approved" | "dismissed" | "failed";

export type AssistantProposal = {
  id: string;
  title: string;
  payload: ProposalPayload;
  status: ProposalStatus;
  createdAt: string;
  resolvedAt?: string;
  /** What approving did (draft id, score outcome) or why it failed. */
  result?: string;
};

type ThreadDoc = { _id: string; messages: AssistantMessage[]; updatedAt: string };
type ProposalDoc = Omit<AssistantProposal, "id"> & { _id: string };

const THREAD_ID = "default";
/** Older turns are dropped from storage too; only the recent ones are ever sent to the model. */
const MAX_STORED_MESSAGES = 200;

const fromProposal = ({ _id, ...rest }: ProposalDoc): AssistantProposal => ({ id: _id, ...rest });

export const assistantRepository = {
  async threads() {
    return (await getDb()).collection<ThreadDoc>("assistant_threads");
  },

  async proposals() {
    return (await getDb()).collection<ProposalDoc>("assistant_proposals");
  },

  async getMessages(): Promise<AssistantMessage[]> {
    const doc = await (await this.threads()).findOne({ _id: THREAD_ID });
    return doc?.messages ?? [];
  },

  async appendMessages(messages: AssistantMessage[]): Promise<void> {
    await (await this.threads()).updateOne(
      { _id: THREAD_ID },
      {
        $push: { messages: { $each: messages, $slice: -MAX_STORED_MESSAGES } },
        $set: { updatedAt: new Date().toISOString() },
      },
      { upsert: true },
    );
  },

  async clear(): Promise<void> {
    await (await this.threads()).updateOne(
      { _id: THREAD_ID },
      { $set: { messages: [], updatedAt: new Date().toISOString() } },
      { upsert: true },
    );
  },

  async saveProposal(p: AssistantProposal): Promise<void> {
    const { id, ...rest } = p;
    await (await this.proposals()).replaceOne({ _id: id }, rest, { upsert: true });
  },

  async getProposal(id: string): Promise<AssistantProposal | null> {
    const doc = await (await this.proposals()).findOne({ _id: id });
    return doc ? fromProposal(doc) : null;
  },

  async proposalsByIds(ids: string[]): Promise<AssistantProposal[]> {
    if (ids.length === 0) return [];
    const docs = await (await this.proposals()).find({ _id: { $in: ids } }).toArray();
    return docs.map(fromProposal);
  },

  async resolveProposal(id: string, status: Exclude<ProposalStatus, "open">, at: string, result?: string): Promise<void> {
    await (await this.proposals()).updateOne(
      { _id: id, status: "open" },
      { $set: { status, resolvedAt: at, ...(result ? { result } : {}) } },
    );
  },
};
