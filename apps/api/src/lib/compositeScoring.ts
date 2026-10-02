import { COMPOSITE_SCORING, RECOMMENDATION_LABELS } from "../config/capabilitySurvivabilityPolicy.js";
import {
  RECOMMENDATIONS,
  type BandHeadline,
  type Recommendation,
  type RuleEvaluation,
  type ScoreBand,
} from "../types/scoring.js";
import type { UserProfile } from "../types/userProfile.js";
import { computeDegreeGapDock } from "./degreeGap.js";
export type CompositeParts = {
  capability: number;
  survivability: number;
  survAdjustment: number;
  gapDock: number;
  contractDock: number;
  final: number;
};

export const computeSurvivabilityAdjustment = (survivability: number): number => {
  const delta = survivability - COMPOSITE_SCORING.SURV_NEUTRAL;
  const raw =
    delta < 0
      ? delta * COMPOSITE_SCORING.SURV_PENALTY_SCALE
      : delta * COMPOSITE_SCORING.SURV_BONUS_SCALE;
  return Math.round(
    Math.max(
      COMPOSITE_SCORING.SURV_ADJ_MIN,
      Math.min(COMPOSITE_SCORING.SURV_ADJ_MAX, raw),
    ),
  );
};

export const computeGapDock = (
  rules: RuleEvaluation,
  profile: UserProfile,
): number => (rules.specializationGap?.dock ?? 0) + computeDegreeGapDock(rules, profile);

export const computeFinalComposite = (params: {
  capability: number;
  survivability: number;
  gapDock: number;
  contractDock?: number;
}): CompositeParts => {
  const survAdjustment = computeSurvivabilityAdjustment(params.survivability);
  const contractDock = params.contractDock ?? 0;
  const final = Math.min(
    100,
    Math.max(0, params.capability + survAdjustment - params.gapDock - contractDock),
  );
  return {
    capability: params.capability,
    survivability: params.survivability,
    survAdjustment,
    gapDock: params.gapDock,
    contractDock,
    final,
  };
};

/** Derivation uses capability + survAdjustment − gapDock − contractDock. */
export const formatScoreDerivation = (parts: CompositeParts): string => {
  const adj =
    parts.survAdjustment === 0
      ? "(-0)"
      : parts.survAdjustment > 0
        ? `(+${parts.survAdjustment})`
        : `(${parts.survAdjustment})`;
  const dockLabel = parts.gapDock > 0 ? ` − ${parts.gapDock}` : "";
  const contractLabel = parts.contractDock > 0 ? ` − ${parts.contractDock}` : "";
  return `${parts.capability} + ${adj}${dockLabel}${contractLabel} = ${parts.final}`;
};

const LEGITIMATE_DERIVATION_RE = /^\d+ \+ \([+-]?\d+\)( − \d+)* = \d+$/;

export const derivationHasOnlyLegitimateTerms = (derivation: string): boolean => {
  if (!LEGITIMATE_DERIVATION_RE.test(derivation)) return false;
  if (/pool|domain|credential|recognizability/i.test(derivation)) return false;
  return true;
};

export const computeWorthTailoring = (
  final: number,
  scoreBand: ScoreBand = "apply",
): boolean => {
  if (scoreBand === "weak") return false;
  return final >= COMPOSITE_SCORING.TAILOR_CAPABILITY;
};

/** The recommendation is the score tier — nothing else moves it. Hard gates land in weak via the score cap. */
export const resolveScoreBand = (final: number, hardGate = false): ScoreBand => {
  if (hardGate) return "weak";
  if (final >= COMPOSITE_SCORING.STRONG_APPLY) return "strong_apply";
  if (final >= COMPOSITE_SCORING.APPLY_LOW) return "apply";
  if (final >= COMPOSITE_SCORING.STRETCH_LOW) return "stretch";
  return "weak";
};

export const recommendationForScore = (final: number, hardGate = false): Recommendation =>
  resolveScoreBand(final, hardGate);

export const resolveBandHeadline = (scoreBand: ScoreBand, _final?: number): BandHeadline =>
  RECOMMENDATION_LABELS[scoreBand];

/** Map any persisted value (including pre-tier legacy values) onto the score-tier scale. */
export const normalizeRecommendation = (raw: unknown, total?: number): Recommendation => {
  if (typeof total === "number" && Number.isFinite(total)) return recommendationForScore(total);
  if (typeof raw === "string" && (RECOMMENDATIONS as readonly string[]).includes(raw)) {
    return raw as Recommendation;
  }
  switch (raw) {
    case "apply_cold":
    case "yes":
    case "referral_gated":
    case "selective_yes":
      return "apply";
    case "stretch_signal":
      return "stretch";
    default:
      return "weak";
  }
};
