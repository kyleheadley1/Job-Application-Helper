import type { ResumeType } from './resume.js';
import type {
  Recommendation,
  RuleEvaluation,
  SalaryAsk,
  ScoreBreakdown,
} from './scoring.js';
import type { JobImportSource, TrackerSpreadsheetFields } from './trackerSpreadsheet.js';

export type JobStatus =
  | 'to_review'
  | 'applied'
  | 'skip'
  | 'rejected'
  | 'interviewing'
  | 'assessment'
  | 'closed'
  | 'offer'
  | 'lapsed';

export type ClearanceTiming = 'active_upfront' | 'sponsorable' | 'unspecified';

export type ClearanceRequirement = {
  required: boolean;
  timing: ClearanceTiming;
  raw?: string;
};

export type GeoScope = {
  titleRegion: string | null;
  postingLocation: string | null;
  cardLocation: string | null;
  remoteType?: 'remote' | 'hybrid' | 'onsite' | 'unknown';
};

export type ExtractedJobData = {
  company: string;
  title: string;
  url?: string;
  rawText?: string;
  location?: string;
  remoteType?: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  locationIsCommutable?: boolean;
  /** Geographic scope from title, card, and posting body. */
  geoScope?: GeoScope;
  salary?: {
    min?: number;
    max?: number;
    currency?: string;
  };
  seniority?: string;
  employmentType?: string;
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
    level?:
      | 'none'
      | 'preferred'
      | 'required'
      | 'equivalent_allowed'
      | 'unknown';
  };
  visaRequirement?: string;
  citizenshipRequirement?: string;
  clearanceRequirement?: ClearanceRequirement | string;
  relocationRequired?: boolean;
  /** ISO date when the role was posted (from JD chrome or import). */
  postedAt?: string;
  /** Visible company from job board / source listing. */
  listingCompanyName?: string;
  /** Named end employer when explicitly disclosed in the JD. */
  employerCompanyName?: string | null;
  /** Recruiter/staffing firm when the listing is third-party representation. */
  agencyCompanyName?: string | null;
  /** User-facing company label (employer, agency client, or listing company). */
  companyDisplayName?: string;
  companyConfidence?: "direct_or_unclear" | "agency_only" | "explicit_employer" | "low";
  /**
   * Parsed Simplify/board employee-count floor when available
   * (e.g. "10,001+ employees" → 10001, "51-200" → 51).
   */
  companyEmployeeCount?: number;
  companyExtractionNotes?: string[];
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

/** Per-stage LLM outcome for triage (extraction vs scoring), aligned with asset slice debug. */
export type TriageStageDebug = {
  success: boolean;
  fallbackUsed: boolean;
  httpStatus?: number;
  errorCode?: string;
  errorType?: string;
  errorMessage?: string;
  parseStage?: string;
  reason?: string;
};

export type TriageDebugExtraction = {
  /** True when live extraction JSON did not validate (same signal as pre–Phase 2.2 `fallbackUsed`). */
  fallbackUsed: boolean;
  extraction: TriageStageDebug;
  scoring: TriageStageDebug;
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
  /** Display-only — not used in score math. */
  referralPathwayAvailable?: boolean;
  referralPathwayNotes?: string;
  generated: GeneratedAssets;
  debugExtraction?: TriageDebugExtraction;
  debugAssetGeneration?: DebugAssetGeneration;
  tracker: {
    priority?: string;
    recommendedAction?: string;
    statusOutcome?: string;
    color?: 'green' | 'yellow' | 'red' | 'blue';
    shortlist?: boolean;
    /** Display tag for shortlist subset (e.g. crowded pool lottery ticket). */
    shortlistTag?: string;
    /** Freshness badge label for shortlist ordering. */
    freshnessTier?: string;
    /** Best-effort posting date override for freshness rules. */
    postedAt?: string;
    /** Manual override for date applied (ISO). Wins over statusHistory-derived appliedAt. */
    appliedAt?: string;
    notes?: string;
  };
  /** Spreadsheet-shaped cells (camelCase); export maps to exact column labels. */
  trackerSpreadsheet?: Partial<TrackerSpreadsheetFields>;
  /** Stable idempotency key for XLSX import upserts. */
  importKey?: string;
  importSource?: JobImportSource;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  scoreHistory?: Array<{
    scoredAt: string;
    score: ScoreBreakdown;
    recommendation: Recommendation;
  }>;
  statusHistory?: StatusHistoryRecord[];
};

export type StatusHistoryRecord = {
  id: string;
  jobId: string;
  fromStatus?: JobStatus;
  toStatus: JobStatus;
  note?: string;
  createdAt: string;
};

export type JobListFilters = {
  status?: JobStatus;
  shortlist?: boolean;
  resume?: ResumeType;
  recommendation?: Recommendation;
  minScore?: number;
  company?: string;
};

export type RefreshShortlistResult = {
  total: number;
  updated: number;
  added: number;
  removed: number;
  unchanged: number;
};

