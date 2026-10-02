import type { JobStatus, ResumeType } from "./job";

export type GmailStatus = {
  configured: boolean;
  connected: boolean;
  email?: string;
  lastSyncAt?: string;
  needsReconnect?: boolean;
};

export type EmailEventType = "applied" | "rejected" | "interview" | "assessment" | "offer" | "other";

export type ApplicationStatus = "applied" | "assessment" | "interviewing" | "rejected" | "offer";

export type ApplicationEmail = {
  id: string;
  subject: string;
  from: string;
  date: string;
  eventType: EmailEventType;
  gmailUrl: string;
};

export type GmailApplication = {
  key: string;
  company: string;
  role: string | null;
  appliedAt: string;
  appliedAtKnown?: boolean;
  status: ApplicationStatus;
  furthestStage?: Exclude<ApplicationStatus, "rejected">;
  lastUpdateAt: string;
  emails: ApplicationEmail[];
  trackerJobId?: string;
  trackerStatus?: JobStatus;
  trackerTitle?: string;
  suggestedStatus?: JobStatus;
  evaluation?: EvaluationSummary;
};

export type RecoveryStatus = "scored" | "unverified" | "not_found" | "fetch_failed";
export type MatchLevel = "exact" | "high" | "low" | "none";

export type RecoveryAttempt = {
  url: string;
  source: string;
  ok: boolean;
  reason?: string;
  matchLevel?: MatchLevel;
};

export type EvaluationSummary = {
  status: RecoveryStatus;
  reason?: string;
  notes?: string[];
  attempts?: RecoveryAttempt[];
  candidates?: Array<{ url: string; title?: string; location?: string; matchLevel: MatchLevel; source: string }>;
  verifiedBy?: "auto" | "user";
  jdTitle?: string;
  recoveredRole?: string;
  boardChecks?: Array<{ board: string; jobs: number; closestTitle?: string; similarity?: number }>;
  fitBreakdown?: {
    categories: Record<string, number>;
    capability?: number;
    survivability?: number;
    gapDock?: number;
    hardGates?: string[];
    topMatch?: string;
    mainRisk?: string;
    risks?: string[];
  };
  fitTotal?: number;
  recommendation?: string;
  recommendedResume?: ResumeType;
  matchLevel?: MatchLevel;
  url?: string;
};

export type RubricPoint = {
  company: string;
  role: string | null;
  fit: number;
  verifiedBy: "auto" | "user";
  furthestStage?: Exclude<ApplicationStatus, "rejected">;
};

export type RubricSummary = {
  rows: Array<{ outcome: ApplicationStatus; count: number; meanFit: number | null }>;
  reachedInterview?: { count: number; meanFit: number | null };
  scored: number;
  userVerified: number;
  points: Partial<Record<ApplicationStatus, RubricPoint[]>>;
  byRecoveryStatus: Record<RecoveryStatus, number>;
};

export type RecoveryRunState = {
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  processed: number;
  scored: number;
  error?: string;
};

export type EvaluationsResponse = {
  days: number;
  run: RecoveryRunState;
  /** `used` and `cap` are Serper queries. */
  serper: { used: number; cap: number; configured: boolean };
  rubricSummary: RubricSummary;
  metrics?: RecoveryMetrics;
  costs?: CostSummary;
};

export type StageBucket = "email" | "company_board" | "serper" | "manual";

export type RecoveryMetrics = {
  applications: number;
  withUsefulData: number;
  verifiedAuto: number;
  userPicked: number;
  userPasted: number;
  needsPick: number;
  notFound: number;
  byBucket: Record<StageBucket, { verified: number; candidatesOnly: number }>;
  serper: {
    jobsSearched: number;
    jobsWithResults: number;
    verified: number;
    candidatesOnly: number;
    queriesUsed: number;
    budget: number;
    freeGrant: number;
  };
};

export type LlmFeature = "gmail_classify" | "jd_recovery" | "other";

export type CostSummary = {
  model: string;
  trackingSince: string | null;
  today: number;
  last7Days: number;
  windowDays: number;
  windowTotal: number;
  byFeature: Record<LlmFeature, { costUsd: number; calls: number }>;
  byDay: Array<{ day: string; costUsd: number }>;
  perScoredRole: number | null;
  perEmailClassified: number | null;
};

export type GmailApplicationsResponse = {
  days: number;
  applications: GmailApplication[];
  pendingRecovery: number;
};

export type RecoveryStart = { queued: number; running: boolean; started: boolean };

export type GmailSyncResult = {
  days: number;
  scanned: number;
  alreadyProcessed: number;
  prefiltered: number;
  classified: number;
  applicationEmails: number;
  llmFailures: number;
  applications: GmailApplication[];
  pendingRecovery: number;
  recovery?: RecoveryStart;
};
