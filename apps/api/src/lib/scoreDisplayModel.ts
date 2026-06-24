import {
  CAPABILITY_MAXES,
  LEGACY_CAPABILITY_SOURCE_MAXES,
  resolveSubFactorBindingness,
  resolveSubFactorPenaltyName,
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
  ScoreBreakdown,
  ScoreDisplay,
  StrategicLeverSelection,
  SurvivabilityDisplayRow,
  SurvivabilityLever,
  SurvivabilityPenalty,
} from "../types/scoring.js";
import { evaluateHardGates } from "./hardGates.js";
import {
  isStructuralOnly,
  selectDominantLever,
} from "./strategicLever.js";
import type { SurvivabilityBreakdown } from "./survivabilityScore.js";

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
): SurvivabilityDisplayRow[] => {
  const rows = (Object.keys(SURVIVABILITY_WEIGHTS) as SurvivabilitySubFactorKey[]).map(
    (key) => {
      const score = breakdown[key];
      const weight = SURVIVABILITY_WEIGHTS[key];
      const meta = SURVIVABILITY_SUB_FACTOR_META[key];
      return {
        key: key as string,
        label: meta.label,
        score,
        weight,
        contribution: score * weight,
        lever: meta.lever,
        leverLabel: meta.leverLabel,
        bindingness: resolveSubFactorBindingness(key, rules),
        penaltyName: resolveSubFactorPenaltyName(key, rules),
      };
    },
  );
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

  if (flag.id === "seniorityOverreach") return rules.seniorityOverreach;
  if (flag.id === "coreLanguageMismatch") return Boolean(rules.explicitCoreLanguageMismatch);
  return false;
};

const flagPenaltyLever = (flagId: string): SurvivabilityLever => {
  if (flagId === "degreeGateStructuredEmployer") return "referral";
  if (flagId === "financePenalty" || flagId === "quantTradingMismatch") return "referral";
  if (flagId === "coreLanguageMismatch") return "resume";
  return "none";
};

const flagPenaltyLeverLabel = (flagId: string): string => {
  const lever = flagPenaltyLever(flagId);
  if (lever === "referral") return "REFERRAL routes around this";
  if (lever === "resume") return "resume framing";
  if (lever === "cover_letter") return "tailored resume / cover letter";
  return "NONE — structural, can't fix";
};

export const buildSurvivabilityPenalties = (
  rules: RuleEvaluation,
  extracted: ExtractedJobData,
): SurvivabilityPenalty[] => {
  const penalties: SurvivabilityPenalty[] = [];
  const seen = new Set<string>();

  for (const flag of rules.hardRuleFlags ?? []) {
    if (flagIsHardGate(flag, rules, extracted)) continue;
    if (seen.has(flag.id)) continue;
    seen.add(flag.id);
    penalties.push({
      message: flag.message,
      lever: flagPenaltyLever(flag.id),
      leverLabel: flagPenaltyLeverLabel(flag.id),
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

const pathwaySource = (notes?: string): string => {
  if (!notes?.trim()) return "referral";
  const first = notes.split(";")[0]?.trim();
  if (!first) return "referral";
  if (first.startsWith("Connection via ")) {
    return first.replace(/^Connection via /i, "");
  }
  if (first.startsWith("Shared program connection (")) {
    const match = first.match(/\(([^)]+)\)/);
    return match?.[1] ?? first;
  }
  if (first.startsWith("Connection from previous company (")) {
    const match = first.match(/\(([^)]+)\)/);
    return match?.[1] ?? first;
  }
  return first;
};

const structuralReason = (rows: SurvivabilityDisplayRow[]): string => {
  const structural = rows.filter((row) => row.bindingness === "structural");
  if (structural.length) {
    return structural.sort((a, b) => a.score - b.score)[0]!.label.toLowerCase();
  }
  return "competitive applicant pool";
};

export const deriveActionLine = (params: {
  recommendation: Recommendation;
  survivabilityRows: SurvivabilityDisplayRow[];
  rules: RuleEvaluation;
  referralPathwayAvailable?: boolean;
  referralPathwayNotes?: string;
  hardGates?: string[];
  dominantLever?: StrategicLeverSelection;
}): string => {
  const {
    recommendation,
    survivabilityRows,
    referralPathwayAvailable,
    referralPathwayNotes,
  } = params;

  const dominant =
    params.dominantLever ??
    selectDominantLever(survivabilityRows, params.rules, referralPathwayAvailable);

  if (recommendation === "no") {
    const reason = params.hardGates?.[0] ?? "hard gate fired";
    return `Do not apply — ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
  }

  if (recommendation === "apply_cold" || recommendation === "yes") {
    return "Strong odds — apply directly.";
  }

  if (isStructuralOnly(survivabilityRows, Boolean(referralPathwayAvailable))) {
    const reason = structuralReason(survivabilityRows);
    if (recommendation === "skip") {
      return `Weak fit and weak odds — odds are structural — ${reason}; effort won't move them much.`;
    }
    return `Odds are structural — ${reason}; effort won't move them much.`;
  }

  if (
    recommendation === "referral_gated" &&
    referralPathwayAvailable &&
    dominant?.lever === "referral"
  ) {
    const source = pathwaySource(referralPathwayNotes);
    return `Use the ${source} connection — a referral routes around the ${dominant.penaltyName}.`;
  }

  if (
    recommendation === "referral_gated" ||
    recommendation === "selective_yes" ||
    recommendation === "stretch_signal"
  ) {
    const prefix =
      recommendation === "stretch_signal"
        ? "Stretch fit — signal may carry you."
        : "Worth a tailored application; cold odds are low.";
    if (!dominant) {
      return prefix;
    }
    const leverName =
      dominant.lever === "cover_letter"
        ? "tailored cover letter"
        : dominant.lever === "resume"
          ? "resume polish"
          : dominant.leverLabel.toLowerCase();
    return `${prefix} Best lever: ${leverName} to address ${dominant.penaltyName}.`;
  }

  if (recommendation === "skip") {
    const reason = dominant?.penaltyName ?? structuralReason(survivabilityRows);
    return `Weak fit and weak odds — ${reason}.`;
  }

  return "";
};

export const buildScoreDisplay = (params: {
  score: ScoreBreakdown;
  rules: RuleEvaluation;
  extracted: ExtractedJobData;
  recommendation: Recommendation;
  referralPathwayAvailable?: boolean;
  referralPathwayNotes?: string;
  hardGateReasons?: string[];
}): ScoreDisplay | undefined => {
  const capability = params.score.capability;
  if (capability == null) return undefined;

  const capabilityBreakdown = computeCapabilityBreakdown(params.score);
  assertCapabilityBreakdownMatchesHeadline(capability, capabilityBreakdown);

  const hardGates = buildHardGatesList(
    params.rules,
    params.extracted,
    params.recommendation,
    params.hardGateReasons,
  );
  const survivabilityPenalties = buildSurvivabilityPenalties(params.rules, params.extracted);

  const breakdown = params.score.survivabilityBreakdown as SurvivabilityBreakdown | undefined;
  const survivability = params.score.survivability ?? 0;

  let survivabilityRows: SurvivabilityDisplayRow[] = [];
  if (breakdown && typeof breakdown.weightedAverage === "number") {
    survivabilityRows = buildSurvivabilityRows(breakdown, params.rules);
    assertSurvivabilityRowsMatchMultiplier(breakdown, survivabilityRows);
  }

  const dominantLever = selectDominantLever(
    survivabilityRows,
    params.rules,
    params.referralPathwayAvailable,
  );

  const actionLine = deriveActionLine({
    recommendation: params.recommendation,
    survivabilityRows,
    rules: params.rules,
    referralPathwayAvailable: params.referralPathwayAvailable,
    referralPathwayNotes: params.referralPathwayNotes,
    hardGates,
    dominantLever,
  });

  return {
    capability,
    capabilityBreakdown,
    survivability,
    final: params.score.total,
    survivabilityRows,
    hardGates,
    survivabilityPenalties,
    dominantLever,
    actionLine,
  };
};

export { selectDominantLever, computeStrategicValue } from "./strategicLever.js";
