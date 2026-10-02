import { getDb } from "../../../config/mongo.js";
import type { StoredResumeType } from "../../../types/resume.js";
import type { ApplicationStatus } from "../gmailApplications.js";
import type { EvidenceSource, MatchLevel } from "./assessJdMatch.js";

export type RecoveryStatus = "scored" | "unverified" | "not_found" | "fetch_failed";

export type RecoveryAttempt = {
  url: string;
  source: EvidenceSource;
  ok: boolean;
  reason?: string;
  matchLevel?: MatchLevel;
};

export type OutcomeHistoryEntry = { status: ApplicationStatus; at: string };

export type ApplicationEvaluation = {
  key: string;
  company: string;
  role: string | null;
  appliedAt: string;
  requisitionId?: string;
  recovery: {
    status: RecoveryStatus;
    reason?: string;
    source?: EvidenceSource;
    url?: string;
    match?: { level: MatchLevel; signals: string[] };
    attempts: RecoveryAttempt[];
    serperQueries: number;
  };
  /** Stored so a later rubric change can re-score the same text. */
  jd?: { text: string; textHash: string; title?: string; company?: string; datePosted?: string };
  fit?: {
    total: number;
    recommendation: string;
    recommendedResume: StoredResumeType;
    scoredAt: string;
    promptVersion: string;
  };
  /** Gmail status at the moment of scoring; never passed to the scorer. */
  outcomeAtScoring?: ApplicationStatus;
  outcome: { status: ApplicationStatus; updatedAt: string; history: OutcomeHistoryEntry[] };
  createdAt: string;
  updatedAt: string;
};

type Doc = ApplicationEvaluation & { _id: string };

let indexesEnsured = false;

const strip = ({ _id, ...rest }: Doc): ApplicationEvaluation => rest;

export const evaluationsRepository = {
  async collection() {
    const db = await getDb();
    const col = db.collection<Doc>("application_evaluations");
    if (!indexesEnsured) {
      indexesEnsured = true;
      await col.createIndex({ appliedAt: -1 }).catch(() => {
        indexesEnsured = false;
      });
    }
    return col;
  },

  async findByKeys(keys: string[]): Promise<Map<string, ApplicationEvaluation>> {
    if (keys.length === 0) return new Map();
    const col = await this.collection();
    const docs = await col.find({ _id: { $in: keys } }).toArray();
    return new Map(docs.map((d) => [d._id, strip(d)]));
  },

  async listSince(sinceIso: string): Promise<ApplicationEvaluation[]> {
    const col = await this.collection();
    const docs = await col.find({ appliedAt: { $gte: sinceIso } }).sort({ appliedAt: -1 }).toArray();
    return docs.map(strip);
  },

  async upsert(evaluation: ApplicationEvaluation): Promise<void> {
    const col = await this.collection();
    await col.replaceOne({ _id: evaluation.key }, evaluation, { upsert: true });
  },

  /** Outcome-only update; never touches the score. */
  async updateOutcome(key: string, outcome: ApplicationEvaluation["outcome"]): Promise<void> {
    const col = await this.collection();
    await col.updateOne({ _id: key }, { $set: { outcome, updatedAt: new Date().toISOString() } });
  },
};
