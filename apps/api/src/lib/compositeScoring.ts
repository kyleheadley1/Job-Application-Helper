import { COMPOSITE_SCORING } from "../config/capabilitySurvivabilityPolicy.js";
import type { BandHeadline, RuleEvaluation, ScoreBand } from "../types/scoring.js";
import type { UserProfile } from "../types/userProfile.js";
import { computeDegreeGapDock } from "./degreeGap.js";

export type CompositeParts = {
  capability: number;
  survivability: number;
  survAdjustment: number;
  gapDock: number;
  final: number;
};

export const computeSurvivabilityAdjustment = (survivability: number): number => {
  const raw = Math.round(
    (survivability - COMPOSITE_SCORING.SURV_NEUTRAL) * COMPOSITE_SCORING.SURV_SWING * 2,
  );
  const clamped = Math.max(
    -COMPOSITE_SCORING.SURV_SWING,
    Math.min(COMPOSITE_SCORING.SURV_SWING, raw),
  );
  return clamped === 0 ? 0 : clamped;
};

export const computeGapDock = (
  rules: RuleEvaluation,
  profile: UserProfile,
): number => (rules.specializationGap?.dock ?? 0) + computeDegreeGapDock(rules, profile);

export const computeFinalComposite = (params: {
  capability: number;
  survivability: number;
  gapDock: number;
}): CompositeParts => {
  const survAdjustment = computeSurvivabilityAdjustment(params.survivability);
  const final = Math.min(
    100,
    Math.max(0, params.capability + survAdjustment - params.gapDock),
  );
  return {
    capability: params.capability,
    survivability: params.survivability,
    survAdjustment,
    gapDock: params.gapDock,
    final,
  };
};

/** Derivation uses exactly capability + survAdjustment − gapDock — no other deductions. */
export const formatScoreDerivation = (parts: CompositeParts): string => {
  const adj =
    parts.survAdjustment === 0
      ? "(-0)"
      : parts.survAdjustment > 0
        ? `(+${parts.survAdjustment})`
        : `(${parts.survAdjustment})`;
  const dockLabel = parts.gapDock > 0 ? ` − ${parts.gapDock}` : "";
  return `${parts.capability} + ${adj}${dockLabel} = ${parts.final}`;
};

const LEGITIMATE_DERIVATION_RE = /^\d+ \+ \([+-]?\d+\)( − \d+)? = \d+$/;

export const derivationHasOnlyLegitimateTerms = (derivation: string): boolean => {
  if (!LEGITIMATE_DERIVATION_RE.test(derivation)) return false;
  if (/pool|domain|credential|recognizability/i.test(derivation)) return false;
  return true;
};

export const computeWorthTailoring = (
  capability: number,
  scoreBand: ScoreBand = "apply",
): boolean => {
  if (scoreBand === "skip" || scoreBand === "no") return false;
  return capability >= COMPOSITE_SCORING.TAILOR_CAPABILITY;
};

export const resolveScoreBand = (final: number, hardGate = false): ScoreBand => {
  if (hardGate) return "no";
  if (final >= COMPOSITE_SCORING.STRONG_APPLY) return "strong_apply";
  if (final >= COMPOSITE_SCORING.APPLY_LOW) return "apply";
  return "skip";
};

export const resolveBandHeadline = (
  scoreBand: ScoreBand,
  worthTailoring: boolean,
): BandHeadline => {
  if (scoreBand === "no" || scoreBand === "skip") return "Skip";
  if (scoreBand === "strong_apply") return "Strong yes";
  if (worthTailoring) return "Yes";
  return "If quick";
};
