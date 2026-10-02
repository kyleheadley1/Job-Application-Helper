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
  status: ApplicationStatus;
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

export type EvaluationSummary = {
  status: RecoveryStatus;
  reason?: string;
  fitTotal?: number;
  recommendation?: string;
  recommendedResume?: ResumeType;
  matchLevel?: MatchLevel;
  url?: string;
};

export type RubricSummary = {
  rows: Array<{ outcome: ApplicationStatus; count: number; meanFit: number | null }>;
  scored: number;
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
  serper: { used: number; cap: number; configured: boolean };
  rubricSummary: RubricSummary;
};

export type GmailApplicationsResponse = {
  days: number;
  applications: GmailApplication[];
  pendingRecovery: number;
};

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
};
