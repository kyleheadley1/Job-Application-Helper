export type Recommendation =
  | "apply_cold"
  | "referral_gated"
  | "stretch_signal"
  | "skip"
  | "no"
  | "yes"
  | "selective_yes";

/** Pre-composite model values kept for persisted job migration. */
export type LegacyRecommendation = "yes" | "selective_yes" | "no";

export type HardRuleFlag = {
  id: string;
  message: string;
};

/** LLM-scored transparency dimensions (not composite axes). */
export type LegacyScoreDimension =
  | "stackFit"
  | "levelFit"
  | "domainFit"
  | "resumeStoryClarity"
  | "functionalOverlap"
  | "recruiterFriendliness"
  | "careerValue";

export type SurvivabilityLever = "referral" | "resume" | "cover_letter" | "none";

export type BindingnessTier = "binding" | "material" | "cosmetic" | "structural";

export type CapabilityBreakdown = {
  stackFit: number;
  levelFit: number;
  functionalOverlap: number;
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

export type ScoreDisplay = {
  capability: number;
  capabilityBreakdown: CapabilityBreakdown;
  survivability: number;
  final: number;
  survivabilityRows: SurvivabilityDisplayRow[];
  hardGates: string[];
  survivabilityPenalties: SurvivabilityPenalty[];
  dominantLever?: StrategicLeverSelection;
  actionLine: string;
};

export type ScoreBreakdown = {
  stackFit: number;
  levelFit: number;
  domainFit: number;
  resumeStoryClarity: number;
  functionalOverlap: number;
  recruiterFriendliness: number;
  careerValue: number;
  /** Capability axis (stack + level + functional), 0–100. */
  capability?: number;
  capabilityBreakdown?: CapabilityBreakdown;
  /** Survivability multiplier, 0.30–1.00. */
  survivability?: number;
  survivabilityBreakdown?: Record<string, number>;
  /** UI-ready decomposition derived from capability × survivability model. */
  scoreDisplay?: ScoreDisplay;
  /** Human-readable 2x2 quadrant label. */
  recommendationLabel?: string;
  /** Final score = round(capability × survivability), or hard-gate floor. */
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
  /** Post-clamp structural disqualifiers surfaced in UI (Rule 3+). */
  hardRuleFlags?: HardRuleFlag[];
  /** Infra/platform or ML-research role shape outside product SWE lane (Rule 2). */
  roleShapeOutsideLane?: boolean;
  /** JD accepts any of a listed language set; candidate matches ≥1 — no core-language gate. */
  disjunctiveLanguageRequirementSatisfied?: boolean;
  disjunctiveAcceptedLanguages?: string[];
  notes: string[];
  penaltyVector?: Record<string, number>;
};

export type SalaryAsk = {
  number?: number;
  rangeMin?: number;
  rangeMax?: number;
};
