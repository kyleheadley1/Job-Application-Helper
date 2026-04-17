import type { ResumeType } from "./resume.js";
import type { Recommendation, RuleEvaluation, SalaryAsk, ScoreBreakdown } from "./scoring.js";

export type JobStatus =
  | "to_review"
  | "applied"
  | "skip"
  | "rejected"
  | "interviewing"
  | "assessment"
  | "closed"
  | "offer";

export type ExtractedJobData = {
  company: string;
  title: string;
  url?: string;
  rawText?: string;
  location?: string;
  remoteType?: "remote" | "hybrid" | "onsite" | "unknown";
  locationIsCommutable?: boolean;
  salary?: {
    min?: number;
    max?: number;
    currency?: string;
  };
  seniority?: string;
  yearsExperience?: {
    raw?: string;
    min?: number;
    max?: number;
  };
  stack: string[];
  requiredSkills: string[];
  preferredSkills: string[];
  domainTags: string[];
  degreeRequirement?: {
    raw?: string;
    level?: "none" | "preferred" | "required" | "equivalent_allowed" | "unknown";
  };
  visaRequirement?: string;
  citizenshipRequirement?: string;
  clearanceRequirement?: string;
  relocationRequired?: boolean;
  responsibilities: string[];
  requirements: string[];
};

export type GeneratedAssets = {
  whyCompany?: string;
  coverLetter?: string;
  talkingPoints?: string[];
  tailoredBulletCandidates?: string[];
  emphasize?: string[];
  avoidClaiming?: string[];
  recruiterReplyDraft?: string;
};

export type TriageDebugExtraction = {
  fallbackUsed: boolean;
  extractedFromRawText: string[];
  missingCriticalFields: string[];
};

/** Per-slice LLM outcome for asset generation (MVP audit trail). */
export type AssetGenerationSliceDebug = {
  success: boolean;
  fallbackUsed: boolean;
  httpStatus?: number;
  errorCode?: string;
  errorType?: string;
  errorMessage?: string;
  parseStage?: string;
  reason?: string;
};

export type DebugAssetGeneration = {
  slices: Record<string, AssetGenerationSliceDebug>;
};

export type JobRecord = {
  id: string;
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
  score: ScoreBreakdown;
  recommendation: Recommendation;
  salaryAsk: SalaryAsk;
  recommendedResume: ResumeType;
  resumeRationale: string[];
  topMatch: string;
  mainRisk: string;
  rationale: string[];
  risks: string[];
  generated: GeneratedAssets;
  debugExtraction?: TriageDebugExtraction;
  debugAssetGeneration?: DebugAssetGeneration;
  tracker: {
    priority?: string;
    recommendedAction?: string;
    statusOutcome?: string;
    color?: "green" | "yellow" | "red" | "blue";
    shortlist?: boolean;
    notes?: string;
  };
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  scoreHistory?: Array<{
    scoredAt: string;
    score: ScoreBreakdown;
    recommendation: Recommendation;
  }>;
};

export type StatusHistoryRecord = {
  id: string;
  jobId: string;
  fromStatus?: JobStatus;
  toStatus: JobStatus;
  note?: string;
  createdAt: string;
};
