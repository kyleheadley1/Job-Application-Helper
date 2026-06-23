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
  /** Required core languages missing from claimable stack (Tier 1). */
  coreLanguageGap?: string[];
  /** Same-language-family framework gaps, e.g. Vue required but React claimable (Tier 2). */
  adjacentFrameworkGap?: string[];
  /** Legacy infra/SRE shape signal — not the same as core-language stackMismatch. */
  infraStackShapeMismatch?: boolean;
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
  /** JD lists Python alongside JS/TS as acceptable — avoid Python-only hard stack framing. */
  pythonStackFlexibleWithJsTs?: boolean;
  /** Healthcare / clinical org but JD is product/full-stack software — do not treat as exotic domain mismatch. */
  healthcareProductEngineering?: boolean;
  /** Backend/product/API role where infra tools are supporting context, not platform-core work. */
  backendProductApiRole?: boolean;
  /** Platform/DevOps/SRE role where infra depth is core to the job shape. */
  infraCoreRole?: boolean;
  /**
   * Thin / generic JD + entry-level applied-AI posting at an unknown startup:
   * damp score inflation, cap recruiter/domain realism.
   */
  vagueEarlyStageAiCalibration?: boolean;
  /** Research-heavy AI role shape (publications/meta-learning/program synthesis/experimental track record). */
  researchHeavyAiRole?: boolean;
  /** Fintech/payments backend role with Go-primary or microservices-heavy production expectations. */
  fintechGoPrimaryStretch?: boolean;
  /** Founding/very-early startup role with high-autonomy ownership risk despite technical overlap. */
  foundingEngineerStretch?: boolean;
  /**
   * JD requires a CS (or equivalent strict) degree plus multiple finance/accounting, publication,
   * or legacy-OOP gates the profile does not satisfy — generic SWE overlap must not dominate.
   */
  credentialHeavyFintechAlgorithm?: boolean;
  /**
   * JD implies 2+ yrs professional bar, production ownership / meaningful scope, and a competitive hiring
   * context — cap inflation from product/story overlap unless profile shows exact JD stack + production depth.
   */
  productionBarCompetitivePool?: boolean;
  /**
   * Go-first / distributed data-infrastructure role (streaming, warehouses, specialized stores).
   */
  goDistributedDataInfraRole?: boolean;
  /**
   * Candidate lacks demonstrated Go/streaming/warehouse production depth and role is not apprenticeship-oriented.
   */
  goDistributedDataInfraCandidateGap?: boolean;
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
