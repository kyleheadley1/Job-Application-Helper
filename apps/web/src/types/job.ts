export type ResumeType = "SWE" | "SIE" | "EARLY_CAREER";
export type Recommendation =
  | "apply_cold"
  | "referral_gated"
  | "stretch_signal"
  | "skip"
  | "no"
  | "yes"
  | "selective_yes";
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
  employmentType?: string;
  seniority?: string;
  stack: string[];
  requiredSkills: string[];
  preferredSkills: string[];
  domainTags: string[];
  responsibilities: string[];
  requirements: string[];
  listingCompanyName?: string;
  employerCompanyName?: string | null;
  agencyCompanyName?: string | null;
  companyDisplayName?: string;
  companyConfidence?: "direct_or_unclear" | "agency_only" | "explicit_employer";
  companyExtractionNotes?: string[];
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
  coreLanguageGap?: string[];
  adjacentFrameworkGap?: string[];
  infraStackShapeMismatch?: boolean;
  domainMismatch: boolean;
  startupFounderMismatch: boolean;
  matureStructuredEmployer?: boolean;
  explicitCoreLanguageMismatch?: boolean;
  explicitCoreLanguage?: string | null;
  fdeBuilderSoftwarePrimary?: boolean;
  pythonStackFlexibleWithJsTs?: boolean;
  healthcareProductEngineering?: boolean;
  backendProductApiRole?: boolean;
  infraCoreRole?: boolean;
  vagueEarlyStageAiCalibration?: boolean;
  researchHeavyAiRole?: boolean;
  fintechGoPrimaryStretch?: boolean;
  foundingEngineerStretch?: boolean;
  credentialHeavyFintechAlgorithm?: boolean;
  productionBarCompetitivePool?: boolean;
  goDistributedDataInfraRole?: boolean;
  goDistributedDataInfraCandidateGap?: boolean;
  hardRuleNotes?: string[];
  hardRuleFlags?: Array<{ id: string; message: string }>;
  roleShapeOutsideLane?: boolean;
  disjunctiveLanguageRequirementSatisfied?: boolean;
  disjunctiveAcceptedLanguages?: string[];
  notes: string[];
};

export type SurvivabilityLever =
  | "referral"
  | "resume"
  | "cover_letter"
  | "none"
  | "portfolio"
  | "upskill";

export type BindingnessTier = "binding" | "material" | "cosmetic" | "structural";

export type ScoreBreakdown = {
  stackFit: number;
  levelFit: number;
  domainFit: number;
  resumeStoryClarity: number;
  functionalOverlap: number;
  recruiterFriendliness: number;
  careerValue: number;
  capability?: number;
  capabilityBreakdown?: {
    stackFit: number;
    levelFit: number;
    functionalOverlap: number;
  };
  survivability?: number;
  survivabilityBreakdown?: Record<string, number>;
  scoreDisplay?: ScoreDisplay;
  recommendationLabel?: string;
  total: number;
};

export type SurvivabilityDisplayRow = {
  key: string;
  label: string;
  score: number;
  weight: number;
  contribution: number;
  lever: SurvivabilityLever;
  leverLabel: string;
  bindingness: BindingnessTier;
  penaltyName: string;
};

export type SurvivabilityPenalty = {
  message: string;
  lever: SurvivabilityLever;
  leverLabel: string;
};

export type StrategicLeverSelection = {
  key: string;
  lever: SurvivabilityLever;
  leverLabel: string;
  penaltyName: string;
  bindingness: BindingnessTier;
  strategicValue: number;
  isCollapsedReferral: boolean;
};

export type ReferralUrgency = "strongly_advised" | "advised" | "optional";

export type EligibilityFlag = {
  reason: string;
  evidence: string;
  lever: "verify";
  severity: "check";
};

export type ScoreDisplay = {
  capability: number;
  capabilityBreakdown: {
    stackFit: number;
    levelFit: number;
    functionalOverlap: number;
  };
  survivability: number;
  final: number;
  survAdjustment: number;
  gapDock: number;
  scoreDerivation: string;
  scoreBand: "strong_apply" | "apply" | "skip" | "no";
  bandHeadline: "Strong yes" | "Yes" | "If quick" | "Skip";
  worthTailoring: boolean;
  survivabilityRows: SurvivabilityDisplayRow[];
  hardGates: string[];
  survivabilityPenalties: SurvivabilityPenalty[];
  dominantLever?: StrategicLeverSelection;
  actionLine: string;
  referralAdvice: string;
  referralUrgency: ReferralUrgency;
  eligibilityAdvisory?: EligibilityFlag;
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
  agencyCompanyName?: string;
  employerCompanyName?: string;
  companyConfidence?: string;
  companyExtractionNotes?: string;
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
  referralPathwayAvailable?: boolean;
  referralPathwayNotes?: string;
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
