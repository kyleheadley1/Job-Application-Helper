import { getDb } from "../../config/mongo.js";
import type { ProposedAdjustment } from "./analyze.js";
import type { InsightsResult } from "./insights.js";

export type InsightsRun = InsightsResult & {
  id: string;
  trigger: "weekly" | "manual";
  /** Plain-English read of the numbers; absent when the budget was spent or the call failed. */
  summary?: string;
};

/**
 * proposed: waiting for you. approved: applied to new scores. dismissed: you said no; never re-proposed.
 * disabled: was approved, now off. withdrawn: a later run no longer supports it (only while still proposed).
 */
export type AdjustmentStatus = "proposed" | "approved" | "dismissed" | "disabled" | "withdrawn";

export type ScoringAdjustment = ProposedAdjustment & {
  status: AdjustmentStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
};

type RunDoc = Omit<InsightsRun, "id"> & { _id: string };
type AdjustmentDoc = Omit<ScoringAdjustment, "id"> & { _id: string };

const runFromDoc = ({ _id, ...rest }: RunDoc): InsightsRun => ({ id: _id, ...rest });
const adjFromDoc = ({ _id, ...rest }: AdjustmentDoc): ScoringAdjustment => ({ id: _id, ...rest });

export const insightsRepository = {
  async runs() {
    return (await getDb()).collection<RunDoc>("insights_runs");
  },

  async adjustments() {
    return (await getDb()).collection<AdjustmentDoc>("scoring_adjustments");
  },

  async latestRun(): Promise<InsightsRun | null> {
    const doc = await (await this.runs()).find({}).sort({ generatedAt: -1 }).limit(1).next();
    return doc ? runFromDoc(doc) : null;
  },

  async saveRun(run: InsightsRun): Promise<void> {
    const { id, ...rest } = run;
    await (await this.runs()).replaceOne({ _id: id }, rest, { upsert: true });
  },

  async listAdjustments(): Promise<ScoringAdjustment[]> {
    const docs = await (await this.adjustments()).find({}).sort({ updatedAt: -1 }).toArray();
    return docs.map(adjFromDoc);
  },

  async listApproved(): Promise<ScoringAdjustment[]> {
    const docs = await (await this.adjustments()).find({ status: "approved" }).toArray();
    return docs.map(adjFromDoc);
  },

  async getAdjustment(id: string): Promise<ScoringAdjustment | null> {
    const doc = await (await this.adjustments()).findOne({ _id: id });
    return doc ? adjFromDoc(doc) : null;
  },

  async saveAdjustment(a: ScoringAdjustment): Promise<void> {
    const { id, ...rest } = a;
    await (await this.adjustments()).replaceOne({ _id: id }, rest, { upsert: true });
  },
};
