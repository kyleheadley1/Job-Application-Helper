import {
  BINDINGNESS_TIER_RANK,
  BINDINGNESS_TIER_WEIGHT,
  LEVER_TYPE_RANK,
  STRATEGIC_VALUE_EPSILON,
  SURVIVABILITY_SUB_FACTOR_PRIORITY,
  SURVIVABILITY_TARGET_NEUTRAL,
  type BindingnessTier,
  type SurvivabilitySubFactorKey,
} from "../config/capabilitySurvivabilityPolicy.js";
import type {
  RuleEvaluation,
  SpecializationGap,
  SurvivabilityDisplayRow,
  SurvivabilityLever,
} from "../types/scoring.js";
import { specializationGapIsNonAddressable } from "./capabilityGap.js";

export type StrategicLeverSelection = {
  key: string;
  lever: SurvivabilityLever;
  leverLabel: string;
  penaltyName: string;
  bindingness: BindingnessTier;
  strategicValue: number;
  isCollapsedReferral: boolean;
};

export const computeHeadroom = (subScore: number): number => {
  const raw = SURVIVABILITY_TARGET_NEUTRAL - subScore;
  return Math.min(SURVIVABILITY_TARGET_NEUTRAL, Math.max(0, raw));
};

export const computeLeverFeasibility = (
  lever: SurvivabilityLever,
  referralPathwayAvailable: boolean,
): number => {
  if (lever === "none" || lever === "portfolio" || lever === "upskill") return 0;
  if (lever === "referral") return referralPathwayAvailable ? 1 : 0;
  return 1;
};

export const specializationGapLeverSelection = (
  gap: SpecializationGap | undefined,
): StrategicLeverSelection | undefined => {
  if (!gap || !specializationGapIsNonAddressable(gap)) return undefined;
  const lever: SurvivabilityLever =
    gap.lever === "portfolio" ? "portfolio" : gap.lever === "upskill" ? "upskill" : "none";
  return {
    key: "specializationGap",
    lever,
    leverLabel:
      lever === "portfolio"
        ? "build portfolio evidence"
        : lever === "upskill"
          ? "upskill with real project work"
          : "NONE — structural, can't fix in-loop",
    penaltyName: gap.name,
    bindingness: gap.severity === "high" ? "binding" : "material",
    strategicValue: BINDINGNESS_TIER_WEIGHT.binding * SURVIVABILITY_TARGET_NEUTRAL,
    isCollapsedReferral: false,
  };
};

export const computeStrategicValue = (
  bindingness: BindingnessTier,
  subScore: number,
  lever: SurvivabilityLever,
  referralPathwayAvailable: boolean,
): number => {
  const tierWeight = BINDINGNESS_TIER_WEIGHT[bindingness];
  if (tierWeight === 0) return 0;
  return tierWeight * computeHeadroom(subScore) * computeLeverFeasibility(lever, referralPathwayAvailable);
};

const subFactorPriorityIndex = (key: string): number => {
  const idx = SURVIVABILITY_SUB_FACTOR_PRIORITY.indexOf(key as SurvivabilitySubFactorKey);
  return idx === -1 ? SURVIVABILITY_SUB_FACTOR_PRIORITY.length : idx;
};

/** Positive when `a` is preferred over `b` on tier → priority → lever only. */
export const compareBindingnessPriority = (
  a: Pick<StrategicLeverSelection, "key" | "bindingness" | "lever">,
  b: Pick<StrategicLeverSelection, "key" | "bindingness" | "lever">,
): number => {
  if (BINDINGNESS_TIER_RANK[a.bindingness] !== BINDINGNESS_TIER_RANK[b.bindingness]) {
    return BINDINGNESS_TIER_RANK[a.bindingness] - BINDINGNESS_TIER_RANK[b.bindingness];
  }
  const priorityDelta =
    subFactorPriorityIndex(b.key) - subFactorPriorityIndex(a.key);
  if (priorityDelta !== 0) return priorityDelta;
  return LEVER_TYPE_RANK[a.lever as keyof typeof LEVER_TYPE_RANK] -
    LEVER_TYPE_RANK[b.lever as keyof typeof LEVER_TYPE_RANK];
};

/** Positive when `a` is preferred over `b`. Never uses raw sub-scores. */
export const compareStrategicLevers = (
  a: StrategicLeverSelection,
  b: StrategicLeverSelection,
): number => {
  if (Math.abs(a.strategicValue - b.strategicValue) > STRATEGIC_VALUE_EPSILON) {
    return a.strategicValue - b.strategicValue;
  }
  return compareBindingnessPriority(a, b);
};

const pickHighestTierInCluster = (
  cluster: StrategicLeverSelection[],
): StrategicLeverSelection => {
  return cluster.reduce((best, curr) =>
    compareBindingnessPriority(curr, best) > 0 ? curr : best,
  );
};

const rowToCandidate = (
  row: SurvivabilityDisplayRow,
  referralPathwayAvailable: boolean,
): StrategicLeverSelection => ({
  key: row.key,
  lever: row.lever,
  leverLabel: row.leverLabel,
  penaltyName: row.penaltyName,
  bindingness: row.bindingness,
  strategicValue: computeStrategicValue(
    row.bindingness,
    row.score,
    row.lever,
    referralPathwayAvailable,
  ),
  isCollapsedReferral: false,
});

export const selectDominantLever = (
  rows: SurvivabilityDisplayRow[],
  rules: RuleEvaluation,
  referralPathwayAvailable = false,
): StrategicLeverSelection | undefined => {
  const gapSelection = specializationGapLeverSelection(rules.specializationGap);
  if (gapSelection) return gapSelection;

  const individuals = rows
    .filter((row) => row.bindingness !== "structural")
    .map((row) => rowToCandidate(row, referralPathwayAvailable));

  const referralItems = individuals.filter((item) => item.lever === "referral");
  const nonReferralItems = individuals.filter((item) => item.lever !== "referral");

  let candidates: StrategicLeverSelection[] = [...nonReferralItems];

  if (referralPathwayAvailable && referralItems.length > 0) {
    const topInCluster = pickHighestTierInCluster(referralItems);
    const maxReferralValue = Math.max(...referralItems.map((item) => item.strategicValue));
    candidates.push({
      ...topInCluster,
      strategicValue: maxReferralValue,
      isCollapsedReferral: true,
    });
  } else {
    candidates.push(...referralItems.filter((item) => item.strategicValue > 0));
  }

  const viable = candidates.filter((item) => item.strategicValue > 0);
  if (!viable.length) return undefined;

  return viable.reduce((best, curr) =>
    compareStrategicLevers(curr, best) > 0 ? curr : best,
  );
};

export const isStructuralOnly = (
  rows: SurvivabilityDisplayRow[],
  referralPathwayAvailable: boolean,
): boolean => {
  const nonStructural = rows.filter((row) => row.bindingness !== "structural");
  if (!nonStructural.length) return true;
  return nonStructural.every(
    (row) =>
      computeStrategicValue(row.bindingness, row.score, row.lever, referralPathwayAvailable) === 0,
  );
};
