import type { ExtractedJobData } from "./job.js";
import type { ResumeType } from "./resume.js";
import type { Recommendation, RuleEvaluation, ScoreBreakdown } from "./scoring.js";

export type TopJobSource = "jsearch" | "jobsbase";

export type DiscoveredListing = {
  source: TopJobSource;
  externalId: string;
  company: string;
  title: string;
  description: string;
  applyUrl: string;
  location?: string;
  remote?: boolean;
  sourcePostedAt: string;
  sourceUpdatedAt: string;
};

export type TopJobRecord = {
  id: string;
  source: TopJobSource;
  externalId: string;
  applyUrl: string;
  sourcePostedAt: string;
  sourceUpdatedAt: string;
  lastSyncedAt: string;
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
  score: ScoreBreakdown;
  recommendation: Recommendation;
  topMatch: string;
  mainRisk: string;
  rationale: string[];
  recommendedResume: ResumeType;
  resumeRationale: string[];
  promotedToJobId?: string;
};

export type TopJobsSyncStats = {
  fetched: number;
  preFiltered: number;
  triaged: number;
  stored: number;
  skippedExisting: number;
  source: TopJobSource | "mixed";
  jsearchCreditsUsed: number;
};

export type TopJobsSyncMeta = {
  _id: "sync_meta";
  jsearchCreditsUsedThisMonth: number;
  jsearchCreditsResetAt: string;
  lastSyncAt: string | null;
  lastManualSyncAt: string | null;
  lastSyncStats: TopJobsSyncStats | null;
  lastSyncError: string | null;
};

export type TopJobsSyncStatus = {
  lastSyncAt: string | null;
  lastManualSyncAt: string | null;
  lastSyncStats: TopJobsSyncStats | null;
  lastSyncError: string | null;
  jsearchCreditsUsedThisMonth: number;
  jsearchCreditsRemaining: number;
  jsearchMonthlyCap: number;
  manualRefreshCooldownMin: number;
  canManualRefresh: boolean;
  manualRefreshAvailableAt: string | null;
};
