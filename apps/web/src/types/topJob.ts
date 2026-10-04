import type { ExtractedJobData, Recommendation, ResumeType, RuleEvaluation, ScoreBreakdown } from "./job";

export type AlertPlatform = "linkedin" | "indeed" | "ziprecruiter" | "remotehunter";

export type TopJobSource = `${AlertPlatform}_alert`;

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

export type TopJobsSyncStats = {
  alertEmails: number;
  listingsParsed: number;
  fetched: number;
  preFiltered: number;
  triaged: number;
  stored: number;
  skippedExisting: number;
  belowMinScore: number;
  jdUnavailable: number;
  locationFiltered?: number;
  closed?: number;
  retired?: number;
  serperQueries: number;
  budgetLimited?: boolean;
  prescreened?: number;
  prescreenSkipped?: number;
  bySource: Partial<Record<AlertPlatform, number>>;
};

export type TopJobsSyncStatus = {
  lastSyncAt: string | null;
  lastManualSyncAt: string | null;
  lastSyncStats: TopJobsSyncStats | null;
  lastSyncError: string | null;
  manualRefreshCooldownMin: number;
  canManualRefresh: boolean;
  manualRefreshAvailableAt: string | null;
  gmailConnected: boolean;
  serperConfigured: boolean;
  openAiKeyConfigured: boolean;
  pendingListings: number;
  budget?: { monthlyUsd: number; spentThisMonthUsd: number };
};
