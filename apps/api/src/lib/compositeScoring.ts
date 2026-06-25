import { COMPOSITE_SCORING } from "../config/capabilitySurvivabilityPolicy.js";
import type { RuleEvaluation, ScoreBand, SpecializationGap } from "../types/scoring.js";

export type CompositeParts = {
  capability: number;
  survivability: number;
  survAdjustment: number;
  gapDock: number;
  poolDock: number;
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

export const computeCompetitivePoolDock = (
  rules: RuleEvaluation,
  survivability: number,
): number => {
  if (!rules.productionBarCompetitivePool) return 0;
  if (survivability >= COMPOSITE_SCORING.COMPETITIVE_POOL_SURV_CEILING) return 0;
  return Math.round(
    Math.max(
      0,
      (COMPOSITE_SCORING.COMPETITIVE_POOL_SURV_CEILING - survivability) *
        COMPOSITE_SCORING.COMPETITIVE_POOL_DOCK_SCALE,
    ),
  );
};

export const computeGapDock = (gap: SpecializationGap | undefined): number =>
  gap?.dock ?? 0;

export const computeFinalComposite = (params: {
  capability: number;
  survivability: number;
  gapDock: number;
  poolDock?: number;
}): CompositeParts => {
  const survAdjustment = computeSurvivabilityAdjustment(params.survivability);
  const poolDock = params.poolDock ?? 0;
  const final = Math.min(
    100,
    Math.max(0, params.capability + survAdjustment - params.gapDock - poolDock),
  );
  return {
    capability: params.capability,
    survivability: params.survivability,
    survAdjustment,
    gapDock: params.gapDock,
    poolDock,
    final,
  };
};

export const formatScoreDerivation = (parts: CompositeParts): string => {
  const adj =
    parts.survAdjustment === 0
      ? "(-0)"
      : parts.survAdjustment > 0
        ? `(+${parts.survAdjustment})`
        : `(${parts.survAdjustment})`;
  const dockTerms = [
    parts.gapDock > 0 ? `− ${parts.gapDock}` : null,
    parts.poolDock > 0 ? `− ${parts.poolDock} (pool)` : null,
  ].filter(Boolean);
  const dockLabel = dockTerms.length ? ` ${dockTerms.join(" ")}` : "";
  return `${parts.capability} + ${adj}${dockLabel} = ${parts.final}`;
};

export const resolveScoreBand = (final: number, hardGate = false): ScoreBand => {
  if (hardGate) return "no";
  if (final >= COMPOSITE_SCORING.APPLY_HIGH) return "apply_tailor";
  if (final >= COMPOSITE_SCORING.APPLY_LOW) return "apply";
  return "skip";
};
