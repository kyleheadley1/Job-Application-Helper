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

/** Which pipeline step surfaced a posting. */
export type RecoveryStage = "email" | "email_board" | "guessed_board" | "serper_board" | "serper" | "manual";

/** A recovered posting that wasn't verified automatically; kept so the user can pick it. */
export type RecoveryCandidate = {
  url: string;
  source: EvidenceSource;
  stage?: RecoveryStage;
  matchLevel: MatchLevel;
  title?: string;
  company?: string;
  location?: string;
  text: string;
};

/** What a confirmed company board held, so "not found" can say "closed" vs "title didn't match". */
export type BoardCheck = { board: string; jobs: number; closestTitle?: string; similarity?: number };

export type FitBreakdown = {
  categories: Record<string, number>;
  capability?: number;
  survivability?: number;
  gapDock?: number;
  hardGates?: string[];
  topMatch?: string;
  mainRisk?: string;
  risks?: string[];
};

export type OutcomeHistoryEntry = { status: ApplicationStatus; at: string };

export type ApplicationEvaluation = {
  key: string;
  company: string;
  role: string | null;
  appliedAt: string;
  requisitionId?: string;
  /** Pipeline version that produced this row; older unscored rows are retried. */
  recoveryVersion?: number;
  recovery: {
    status: RecoveryStatus;
    reason?: string;
    /** Every reason the posting wasn't verified, most actionable first. */
    notes?: string[];
    source?: EvidenceSource;
    /** Step that found the stored posting (absent on rows from before stages were recorded). */
    foundVia?: RecoveryStage;
    url?: string;
    match?: { level: MatchLevel; signals: string[] };
    attempts: RecoveryAttempt[];
    serperQueries: number;
    /** "user" when the posting was picked or pasted by hand. */
    verifiedBy?: "auto" | "user";
    /** Role taken from a board title found in the email, when the classifier had none. */
    recoveredRole?: string;
    candidates?: RecoveryCandidate[];
    boardChecks?: BoardCheck[];
  };
  /** Stored so a later rubric change can re-score the same text. */
  jd?: { text: string; textHash: string; title?: string; company?: string; datePosted?: string };
  fit?: {
    total: number;
    recommendation: string;
    recommendedResume: StoredResumeType;
    scoredAt: string;
    promptVersion: string;
    /** Why the score is what it is; absent on rows scored before breakdowns were stored. */
    breakdown?: FitBreakdown;
  };
  /** Gmail status at the moment of scoring; never passed to the scorer. */
  outcomeAtScoring?: ApplicationStatus;
  outcome: {
    status: ApplicationStatus;
    updatedAt: string;
    history: OutcomeHistoryEntry[];
    furthestStage?: Exclude<ApplicationStatus, "rejected">;
  };
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

  async findByKey(key: string): Promise<ApplicationEvaluation | null> {
    const col = await this.collection();
    const doc = await col.findOne({ _id: key });
    return doc ? strip(doc) : null;
  },

  /** Every evaluation whose key starts with one of these company keys (`company::role`). */
  async findByCompanyKeys(companyKeys: string[]): Promise<ApplicationEvaluation[]> {
    if (companyKeys.length === 0) return [];
    const col = await this.collection();
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const docs = await col.find({ _id: { $regex: `^(?:${companyKeys.map(escape).join("|")})::` } }).toArray();
    return docs.map(strip);
  },

  /** Move an evaluation to a new key without touching its score. */
  async rekey(oldKey: string, evaluation: ApplicationEvaluation): Promise<void> {
    const col = await this.collection();
    await col.replaceOne({ _id: evaluation.key }, evaluation, { upsert: true });
    if (oldKey !== evaluation.key) await col.deleteOne({ _id: oldKey });
  },

  /** Outcome-only update; never touches the score. */
  async updateOutcome(key: string, outcome: ApplicationEvaluation["outcome"]): Promise<void> {
    const col = await this.collection();
    await col.updateOne({ _id: key }, { $set: { outcome, updatedAt: new Date().toISOString() } });
  },
};
