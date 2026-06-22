import type { ExtractedJobData, Recommendation, ResumeType, RuleEvaluation, ScoreBreakdown } from "./job";

export type TopJobSource = "jsearch" | "jobsbase";

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
  resumeRationale?: string[];
  promotedToJobId?: string;
};

export type TopJobsSyncStatus = {
  lastSyncAt: string | null;
  lastManualSyncAt: string | null;
  lastSyncStats: {
    fetched: number;
    preFiltered: number;
    triaged: number;
    stored: number;
    skippedExisting: number;
    source: TopJobSource | "mixed";
    jsearchCreditsUsed: number;
  } | null;
  lastSyncError: string | null;
  jsearchCreditsUsedThisMonth: number;
  jsearchCreditsRemaining: number;
  jsearchMonthlyCap: number;
  manualRefreshCooldownMin: number;
  canManualRefresh: boolean;
  manualRefreshAvailableAt: string | null;
};
