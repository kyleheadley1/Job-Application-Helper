import {
  CAPABILITY_MAXES,
  CLEARANCE_REQUIRES_EXISTING_SURV_PENALTY,
  LEGACY_CAPABILITY_SOURCE_MAXES,
  resolveSubFactorBindingness,
  resolveSubFactorPenaltyName,
  SCORE_BAND_LABELS,
  SURVIVABILITY_SUB_FACTOR_META,
  SURVIVABILITY_TUNING,
  SURVIVABILITY_WEIGHTS,
  type SurvivabilitySubFactorKey,
} from "../config/capabilitySurvivabilityPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import type {
  CapabilityBreakdown,
  HardRuleFlag,
  Recommendation,
  RuleEvaluation,
  ScoreBand,
  ScoreBreakdown,
  ScoreDisplay,
  StrategicLeverSelection,
  SurvivabilityDisplayRow,
  SurvivabilityLever,
  SurvivabilityPenalty,
} from "../types/scoring.js";
import type { UserProfile } from "../types/userProfile.js";
import { userProfile as defaultUserProfile } from "../config/userProfile.js";
import {
  NONE_IN_LOOP_LEVER_LABEL,
  resolveDegreeGapLever,
  STRUCTURAL_LEVER_LABEL,
} from "./degreeGap.js";
import { evaluateHardGates } from "./hardGates.js";
import { earlyCareerLevelVetoesSeniorityGate } from "./seniorityGate.js";
import { applySpecializationGapToBreakdown, specializationGapHeadlineWorthy } from "./capabilityGap.js";
import {
  applyDifferentiatorCoverageCap,
  type DifferentiatorCoverageResult,
} from "./differentiatorCoverage.js";
import {
  applyAdjacentRoleFunctionCap,
  applyFrontendPrimaryRoleCap,
  applyPlatformInfraRoleCap,
  classifyFrontendPrimaryRole,
  classifyPlatformInfraRole,
} from "./roleFunctionClassifier.js";
import { buildContractCaveat, contractFinalDock } from "./contractEmployment.js";
import { GENAI_RESTRICTION_WARNING } from "./genAiRestriction.js";
import {
  computeFinalComposite,
  computeGapDock,
  computeWorthTailoring,
  formatScoreDerivation,
  resolveBandHeadline,
  resolveScoreBand,
} from "./compositeScoring.js";
import {
  isStructuralOnly,
  selectDominantLever,
} from "./strategicLever.js";
import { composeSpecializationGapActionLine } from "./gapActionLine.js";
import { deriveReferralAdvice } from "./referralAdvice.js";
import { certificationCredentialLeverLabel } from "./certificationBoost.js";
import { computePoolFriendliness } from "./poolFriendliness.js";
import type { SurvivabilityBreakdown } from "./survivabilityScore.js";
import { hydrateSurvivabilityBreakdown } from "./survivabilityScore.js";

export type {
  CapabilityBreakdown,
  ScoreDisplay,
  StrategicLeverSelection,
  SurvivabilityDisplayRow,
  SurvivabilityLever,
  SurvivabilityPenalty,
};

const scaleToCapability = (raw: number, legacyMax: number, capabilityMax: number): number =>
  Math.round((raw / legacyMax) * capabilityMax);

export const computeCapabilityBreakdown = (rawScore: ScoreBreakdown): CapabilityBreakdown => ({
  stackFit: scaleToCapability(
    rawScore.stackFit,
    LEGACY_CAPABILITY_SOURCE_MAXES.stackFit,
    CAPABILITY_MAXES.stackFit,
  ),
  levelFit: scaleToCapability(
    rawScore.levelFit,
    LEGACY_CAPABILITY_SOURCE_MAXES.levelFit,
    CAPABILITY_MAXES.levelFit,
  ),
  functionalOverlap: scaleToCapability(
    rawScore.functionalOverlap,
    LEGACY_CAPABILITY_SOURCE_MAXES.functionalOverlap,
    CAPABILITY_MAXES.functionalOverlap,
  ),
});

export const sumCapabilityBreakdown = (breakdown: CapabilityBreakdown): number =>
  Math.min(
    100,
    breakdown.stackFit + breakdown.levelFit + breakdown.functionalOverlap,
  );

export const buildFullCapabilityBreakdown = (
  rawScore: ScoreBreakdown,
  rules: RuleEvaluation,
  extracted: ExtractedJobData,
): {
  breakdown: CapabilityBreakdown;
  differentiatorCoverage: DifferentiatorCoverageResult;
  roleFunctionCapNote?: string;
} => {
  const withGap = applySpecializationGapToBreakdown(
    computeCapabilityBreakdown(rawScore),
    rules.specializationGap,
  );
  const withRoleCap = applyAdjacentRoleFunctionCap(withGap, extracted);
  const withFrontendCap = applyFrontendPrimaryRoleCap(withRoleCap.breakdown, extracted);
  const withPlatformCap = applyPlatformInfraRoleCap(withFrontendCap.breakdown, extracted);
  const frontendPrimary =
    withFrontendCap.classification.detected || classifyFrontendPrimaryRole(extracted).detected;
  const platformInfra =
    withPlatformCap.classification.detected || classifyPlatformInfraRole(extracted).detected;
  const capped = applyDifferentiatorCoverageCap(withPlatformCap.breakdown, extracted, {
    adjacentRoleFunction: withRoleCap.classification.detected,
    frontendPrimaryRole: frontendPrimary,
    platformInfraRole: platformInfra,
  });
  const roleFunctionCapNote = withRoleCap.classification.detected
    ? withRoleCap.classification.note
    : withPlatformCap.classification.detected
      ? withPlatformCap.classification.note
      : withFrontendCap.classification.detected
        ? withFrontendCap.classification.note
        : undefined;
  return {
    breakdown: capped.breakdown,
    differentiatorCoverage: capped.coverage,
    roleFunctionCapNote,
  };
};

/** Dev/test invariant: capability headline equals sum of displayed components. */
export const assertCapabilityBreakdownMatchesHeadline = (
  capability: number,
  breakdown: CapabilityBreakdown,
): void => {
  const sum = sumCapabilityBreakdown(breakdown);
  if (sum !== capability) {
    throw new Error(
      `Capability breakdown sum ${sum} does not match headline ${capability}`,
    );
  }
};

export const buildSurvivabilityRows = (
  breakdown: SurvivabilityBreakdown,
  rules: RuleEvaluation,
  profile: UserProfile = defaultUserProfile,
): SurvivabilityDisplayRow[] => {
  const rows = (Object.keys(SURVIVABILITY_WEIGHTS) as SurvivabilitySubFactorKey[]).map(
    (key) => {
      const score = breakdown[key];
      const weight = SURVIVABILITY_WEIGHTS[key];
      const meta = SURVIVABILITY_SUB_FACTOR_META[key];
      const certBoost = key === "credentialSignal" ? breakdown.certificationBoost : undefined;
      const degreeLever =
        key === "credentialSignal" && !certBoost && !rules.jdDegreePositive
          ? resolveDegreeGapLever(rules, profile)
          : null;
      const poolMeta = key === "poolFriendliness" ? breakdown.poolFriendlinessMeta : undefined;
      const degreePositiveCredential = key === "credentialSignal" && rules.jdDegreePositive;
      const lever = certBoost
        ? "credential"
        : degreePositiveCredential
          ? "portfolio"
        : poolMeta?.lever ??
          degreeLever?.lever ??
          meta.lever;
      const leverLabel = certBoost
        ? certificationCredentialLeverLabel(certBoost.status)
        : degreePositiveCredential
          ? "portfolio-first screen — lead with shipped work"
        : poolMeta?.leverLabel ??
          degreeLever?.leverLabel ??
          meta.leverLabel;
      const bindingness = certBoost
        ? "material"
        : degreePositiveCredential
          ? "favorable"
        : poolMeta?.bindingness ?? resolveSubFactorBindingness(key, rules);
      return {
        key: key as string,
        label: meta.label,
        score,
        weight,
        contribution: score * weight,
        lever,
        leverLabel,
        bindingness,
        penaltyName: resolveSubFactorPenaltyName(key, rules),
      };
    },
  );

  if (rules.clearanceRequiresExistingPenalty) {
    rows.push({
      key: "clearanceRequiresExisting",
      label: "Security clearance",
      score: 0,
      weight: 0,
      contribution: -CLEARANCE_REQUIRES_EXISTING_SURV_PENALTY,
      lever: "none",
      leverLabel: STRUCTURAL_LEVER_LABEL,
      bindingness: "structural",
      penaltyName: "existing clearance requirement",
    });
  }

  return rows.sort((a, b) => a.score - b.score);
};

/** Dev/test invariant: weighted sub-factors match breakdown; multiplier matches clamp policy. */
export const assertSurvivabilityRowsMatchMultiplier = (
  breakdown: SurvivabilityBreakdown,
  rows: SurvivabilityDisplayRow[],
  tolerance = 0.011,
): void => {
  const weighted = rows.reduce((sum, row) => sum + row.contribution, 0);
  if (Math.abs(weighted - breakdown.weightedAverage) > tolerance) {
    throw new Error(
      `Survivability weighted sum ${weighted.toFixed(4)} does not match weightedAverage ${breakdown.weightedAverage.toFixed(4)}`,
    );
  }
  const expectedMultiplier = Math.min(
    1,
    Math.max(SURVIVABILITY_TUNING.floor, breakdown.weightedAverage),
  );
  if (Math.abs(breakdown.multiplier - expectedMultiplier) > 0.001) {
    throw new Error(
      `Survivability multiplier ${breakdown.multiplier} does not match clamped weighted average ${expectedMultiplier}`,
    );
  }
};

const flagIsHardGate = (
  flag: HardRuleFlag,
  rules: RuleEvaluation,
  extracted: ExtractedJobData,
): boolean => {
  const gate = evaluateHardGates(rules, extracted);
  if (!gate.fired) return false;

  if (flag.id === "seniorityOverreach") {
    return rules.seniorityOverreach && !earlyCareerLevelVetoesSeniorityGate(extracted);
  }
  if (flag.id === "coreLanguageMismatch") return Boolean(rules.explicitCoreLanguageMismatch);
  return false;
};

const flagPenaltyLever = (
  flagId: string,
  rules: RuleEvaluation,
  profile: UserProfile,
): SurvivabilityLever => {
  if (flagId === "degreeGateStructuredEmployer" || flagId === "degreePreferenceWithEquivalency") {
    return resolveDegreeGapLever(rules, profile)?.lever ?? "none";
  }
  if (flagId === "coreLanguageMismatch") return "resume";
  return "none";
};

const flagPenaltyLeverLabel = (
  flagId: string,
  rules: RuleEvaluation,
  profile: UserProfile,
): string => {
  const degreePair =
    flagId === "degreeGateStructuredEmployer" || flagId === "degreePreferenceWithEquivalency"
      ? resolveDegreeGapLever(rules, profile)
      : null;
  if (degreePair) return degreePair.leverLabel;
  const lever = flagPenaltyLever(flagId, rules, profile);
  if (lever === "resume") return "resume framing";
  if (lever === "cover_letter") return "tailored resume / cover letter";
  return STRUCTURAL_LEVER_LABEL;
};

const specializationPenaltyLeverLabel = (lever: SurvivabilityLever): string => {
  if (lever === "portfolio") return "build portfolio evidence";
  if (lever === "upskill") return "upskill with real project work";
  if (lever === "resume") return "resume framing";
  if (lever === "none_in_loop") return NONE_IN_LOOP_LEVER_LABEL;
  return STRUCTURAL_LEVER_LABEL;
};

export const buildSurvivabilityPenalties = (
  rules: RuleEvaluation,
  extracted: ExtractedJobData,
  profile: UserProfile = defaultUserProfile,
): SurvivabilityPenalty[] => {
  const penalties: SurvivabilityPenalty[] = [];
  const seen = new Set<string>();

  if (rules.specializationGap) {
    const gap = rules.specializationGap;
    const lever: SurvivabilityLever =
      gap.lever === "portfolio"
        ? "portfolio"
        : gap.lever === "upskill"
          ? "upskill"
          : gap.lever === "resume"
            ? "resume"
            : "none";
    penalties.push({
      message: `${gap.name} — ${gap.evidence}`,
      lever,
      leverLabel: specializationPenaltyLeverLabel(lever),
    });
    seen.add("specializationGap");
  }

  if (rules.clearanceRequiresExistingPenalty) {
    penalties.push({
      message:
        rules.clearanceEligibilityFlag?.reason ??
        "Likely requires existing clearance — verify before applying.",
      lever: "none",
      leverLabel: STRUCTURAL_LEVER_LABEL,
    });
    seen.add("clearanceRequiresExisting");
  }

  for (const flag of rules.hardRuleFlags ?? []) {
    if (flagIsHardGate(flag, rules, extracted)) continue;
    if (seen.has(flag.id)) continue;
    seen.add(flag.id);
    penalties.push({
      message: flag.message,
      lever: flagPenaltyLever(flag.id, rules, profile),
      leverLabel: flagPenaltyLeverLabel(flag.id, rules, profile),
    });
  }

  return penalties;
};

export const buildHardGatesList = (
  rules: RuleEvaluation,
  extracted: ExtractedJobData,
  recommendation: Recommendation,
  hardGateReasons?: string[],
): string[] => {
  if (recommendation === "no" && hardGateReasons?.length) {
    return hardGateReasons;
  }
  const gate = evaluateHardGates(rules, extracted);
  return gate.fired ? gate.reasons : [];
};

const structuralReason = (rows: SurvivabilityDisplayRow[]): string => {
  const structural = rows.filter((row) => row.bindingness === "structural");
  if (structural.length) {
    return structural.sort((a, b) => a.score - b.score)[0]!.label.toLowerCase();
  }
  return "competitive applicant pool";
};

export const deriveActionLine = (params: {
  scoreBand: ScoreBand;
  capability: number;
  worthTailoring: boolean;
  recommendation: Recommendation;
  survivabilityRows: SurvivabilityDisplayRow[];
  rules: RuleEvaluation;
  hardGates?: string[];
  dominantLever?: StrategicLeverSelection;
}): string => {
  const { scoreBand, worthTailoring, rules } = params;
  const gap = rules.specializationGap;
  const gapWorthy = specializationGapHeadlineWorthy(gap);

  if (
    rules.jdDegreePositive &&
    scoreBand !== "no" &&
    scoreBand !== "skip"
  ) {
    return "Portfolio-first screen — cold apply has real odds; lead with shipped work (DevAI, GitHub). Referral helpful, not gating.";
  }

  if (scoreBand === "no") {
    const reason = params.hardGates?.[0] ?? "hard gate fired";
    return `Do not apply — ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
  }

  if (scoreBand === "strong_apply") {
    if (gapWorthy && gap) {
      return composeSpecializationGapActionLine("Clearly in the ballpark", gap, worthTailoring);
    }
    if (worthTailoring) {
      return "Clearly in the ballpark — worth a tailored resume + cover letter.";
    }
    return "Clearly in the ballpark — slam-dunk fit.";
  }

  if (scoreBand === "apply") {
    if (gapWorthy && gap) {
      const prefix = worthTailoring ? "Strong shot" : "Worth applying";
      return composeSpecializationGapActionLine(prefix, gap, worthTailoring);
    }
    if (worthTailoring) {
      return "Worth applying — a tailored resume + cover letter.";
    }
    return SCORE_BAND_LABELS.apply;
  }

  if (scoreBand === "skip") {
    if (gapWorthy && gap) {
      return composeSpecializationGapActionLine("Stretch", gap, false);
    }
    if (rules.capabilityGap) {
      return `Not worth the effort — ${rules.capabilityGap.reason}.`;
    }
    const dominant =
      params.dominantLever ??
      selectDominantLever(params.survivabilityRows, params.rules);
    const reason = dominant?.penaltyName ?? structuralReason(params.survivabilityRows);
    return `Not worth the effort — ${reason}.`;
  }

  return "";
};

export const buildScoreDisplay = (params: {
  score: ScoreBreakdown;
  rules: RuleEvaluation;
  extracted: ExtractedJobData;
  profile?: UserProfile;
  recommendation: Recommendation;
  referralPathwayAvailable?: boolean;
  referralPathwayNotes?: string;
  hardGateReasons?: string[];
}): ScoreDisplay | undefined => {
  const profile = params.profile ?? defaultUserProfile;
  const headlineCapability = params.score.capability;
  if (headlineCapability == null && params.rules.specializationGap == null) return undefined;

  const { breakdown: capabilityBreakdown, differentiatorCoverage, roleFunctionCapNote } =
    buildFullCapabilityBreakdown(params.score, params.rules, params.extracted);
  const capability = sumCapabilityBreakdown(capabilityBreakdown);
  assertCapabilityBreakdownMatchesHeadline(capability, capabilityBreakdown);

  const hardGates = buildHardGatesList(
    params.rules,
    params.extracted,
    params.recommendation,
    params.hardGateReasons,
  );
  const survivabilityPenalties = buildSurvivabilityPenalties(
    params.rules,
    params.extracted,
    profile,
  );

  const poolMeta = computePoolFriendliness(params.extracted, profile);
  const breakdownRaw = hydrateSurvivabilityBreakdown(params.score);
  let breakdown: SurvivabilityBreakdown | undefined;
  if (breakdownRaw) {
    let weightedAverage = 0;
    for (const [key, weight] of Object.entries(SURVIVABILITY_WEIGHTS) as Array<
      [SurvivabilitySubFactorKey, number]
    >) {
      const subScore = key === "poolFriendliness" ? poolMeta.score : breakdownRaw[key];
      weightedAverage += subScore * weight;
    }
    if (params.rules.clearanceRequiresExistingPenalty) {
      weightedAverage -= CLEARANCE_REQUIRES_EXISTING_SURV_PENALTY;
    }
    breakdown = {
      ...breakdownRaw,
      poolFriendliness: poolMeta.score,
      weightedAverage,
      multiplier: Math.min(
        1,
        Math.max(SURVIVABILITY_TUNING.floor, weightedAverage),
      ),
      poolFriendlinessMeta: poolMeta,
    };
  }
  const survivability = params.score.survivability ?? 0;

  let survivabilityRows: SurvivabilityDisplayRow[] = [];
  if (breakdown && typeof breakdown.weightedAverage === "number") {
    survivabilityRows = buildSurvivabilityRows(breakdown, params.rules, profile);
    assertSurvivabilityRowsMatchMultiplier(breakdown, survivabilityRows);
  }

  const gapDock = computeGapDock(params.rules, profile);
  const contractDock = contractFinalDock(params.extracted);
  const composite = computeFinalComposite({
    capability,
    survivability,
    gapDock,
    contractDock,
  });
  const final = params.score.total ?? composite.final;
  const scoreBand = resolveScoreBand(final, hardGates.length > 0);
  const scoreDerivation =
    hardGates.length > 0 && final !== composite.final
      ? `${formatScoreDerivation(composite)} → capped at ${final} (hard gate)`
      : formatScoreDerivation({ ...composite, final });
  const worthTailoring = computeWorthTailoring(final, scoreBand);
  const bandHeadline = resolveBandHeadline(scoreBand, final);

  const dominantLever = selectDominantLever(survivabilityRows, params.rules);

  const actionLine = deriveActionLine({
    scoreBand,
    capability,
    worthTailoring,
    recommendation: params.recommendation,
    survivabilityRows,
    rules: params.rules,
    hardGates,
    dominantLever,
  });

  const referral = deriveReferralAdvice({
    survivabilityBreakdown: breakdown,
    referralPathwayAvailable: params.referralPathwayAvailable,
    referralPathwayNotes: params.referralPathwayNotes,
    jdDegreePositive: params.rules.jdDegreePositive,
  });

  const degreePositiveNote = params.rules.jdDegreePositive
    ? "Degree-positive JD: employer welcomes non-degree / 'show the work' — credential drag neutralized."
    : undefined;
  const contractCaveat = buildContractCaveat(params.extracted);
  const genAiRestrictionWarning = params.rules.jdProhibitsGenAI
    ? GENAI_RESTRICTION_WARNING
    : undefined;

  const eligibilityAdvisories = [
    params.rules.eligibilityFlag,
    params.rules.clearanceEligibilityFlag,
  ].filter((flag): flag is NonNullable<typeof flag> => Boolean(flag));

  return {
    capability,
    capabilityBreakdown,
    differentiatorCoverageNote:
      params.score.differentiatorCoverageNote ?? differentiatorCoverage.note,
    roleFunctionCapNote: params.score.roleFunctionCapNote ?? roleFunctionCapNote,
    survivability,
    final,
    survAdjustment: composite.survAdjustment,
    gapDock: composite.gapDock,
    scoreDerivation,
    scoreBand,
    bandHeadline,
    worthTailoring,
    survivabilityRows,
    hardGates,
    survivabilityPenalties,
    dominantLever,
    actionLine,
    referralAdvice: referral.advice,
    referralUrgency: referral.urgency,
    degreePositiveNote,
    contractCaveat,
    genAiRestrictionWarning,
    credentialBoostNote: params.score.certificationBoost?.note ?? breakdown?.certificationBoost?.note,
    poolFriendlinessNote: breakdown?.poolFriendlinessMeta?.note,
    eligibilityAdvisory: eligibilityAdvisories[0],
    eligibilityAdvisories,
  };
};

export { selectDominantLever, computeStrategicValue } from "./strategicLever.js";
