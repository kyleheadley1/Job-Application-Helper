export type Recommendation = 'yes' | 'selective_yes' | 'no';

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

export type RuleEvaluation = {
  explicitDegreeRisk: boolean;
  traditionalCompanyPenalty: boolean;
  financePenalty: boolean;
  strictNewGradPipeline: boolean;
  earlyCareerFriendlyRole: boolean;
  /** Alias for strictNewGradPipeline (API stability). */
  newGradPenalty: boolean;
  seniorityOverreach: boolean;
  locationMismatch: boolean;
  visaMismatch: boolean;
  citizenshipMismatch: boolean;
  clearanceMismatch: boolean;
  stackMismatch: boolean;
  domainMismatch: boolean;
  startupFounderMismatch: boolean;
  /** Big-tech / enterprise-style org where explicit stack gates are usually strict. */
  matureStructuredEmployer?: boolean;
  /** Explicit production-language requirement in JD does not match profile; only set for mature employers. */
  explicitCoreLanguageMismatch?: boolean;
  /** When mismatch is set: `java` | `go` | `python`. */
  explicitCoreLanguage?: string | null;
  /**
   * Forward-deployed / growth-style title without strong external customer-delivery JD:
   * builder-first software engineering; calibrate scores down from inflated 90+ bands.
   */
  fdeBuilderSoftwarePrimary?: boolean;
  /**
   * Thin / generic JD + entry-level applied-AI posting at an unknown startup:
   * damp score inflation, cap recruiter/domain realism.
   */
  vagueEarlyStageAiCalibration?: boolean;
  /**
   * True first-pass gates only (UI "Hard-rule flags"): commutable location, degree, explicit core language.
   * Visa/citizenship/clearance and other notes stay in `notes` / key risks.
   */
  hardRuleNotes?: string[];
  notes: string[];
  penaltyVector?: Record<string, number>;
};

export type SalaryAsk = {
  number?: number;
  rangeMin?: number;
  rangeMax?: number;
};
