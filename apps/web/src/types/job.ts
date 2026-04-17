export type ResumeType = "SWE" | "SIE" | "EARLY_CAREER";
export type Recommendation = "yes" | "selective_yes" | "no";
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
  stack: string[];
  requiredSkills: string[];
  preferredSkills: string[];
  domainTags: string[];
  responsibilities: string[];
  requirements: string[];
};

export type RuleEvaluation = {
  explicitDegreeRisk: boolean;
  traditionalCompanyPenalty: boolean;
  financePenalty: boolean;
  strictNewGradPipeline: boolean;
  earlyCareerFriendlyRole: boolean;
  newGradPenalty: boolean;
  seniorityOverreach: boolean;
  locationMismatch: boolean;
  visaMismatch: boolean;
  citizenshipMismatch: boolean;
  clearanceMismatch: boolean;
  stackMismatch: boolean;
  domainMismatch: boolean;
  startupFounderMismatch: boolean;
  notes: string[];
};

export type ScoreBreakdown = {
  stackFit: number;
  levelFit: number;
  domainFit: number;
  resumeStoryClarity: number;
  functionalOverlap: number;
  recruiterFriendliness: number;
  careerValue: number;
  total: number;
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

export type TrackerSpreadsheetFields = {
  rank?: string;
  discussed?: string;
  company?: string;
  role?: string;
  latestScore?: string;
  originalAltScore?: string;
  priority?: string;
  recommendedAction?: string;
  statusOutcome?: string;
  salaryAsk?: string;
  jdInput?: string;
  topMatch?: string;
  mainRisk?: string;
  notes?: string;
  resume?: string;
};

export type JobRecord = {
  id: string;
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
  score: ScoreBreakdown;
  recommendation: Recommendation;
  salaryAsk: { number?: number; rangeMin?: number; rangeMax?: number };
  recommendedResume: ResumeType;
  resumeRationale: string[];
  topMatch: string;
  mainRisk: string;
  rationale: string[];
  risks: string[];
  generated: GeneratedAssets;
  debugAssetGeneration?: DebugAssetGeneration;
  trackerSpreadsheet?: Partial<TrackerSpreadsheetFields>;
  importKey?: string;
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
  statusHistory?: Array<{
    id: string;
    jobId: string;
    fromStatus?: JobStatus;
    toStatus: JobStatus;
    note?: string;
    createdAt: string;
  }>;
};
