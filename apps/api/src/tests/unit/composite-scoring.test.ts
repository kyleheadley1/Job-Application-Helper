import { describe, expect, it } from "vitest";
import { COMPOSITE_SCORING } from "../../config/capabilitySurvivabilityPolicy.js";
import {
  computeFinalComposite,
  computeSurvivabilityAdjustment,
  computeWorthTailoring,
  derivationHasOnlyLegitimateTerms,
  resolveBandHeadline,
  resolveScoreBand,
} from "../../lib/compositeScoring.js";

describe("additive composite scoring", () => {
  it("no-halving: capability 80 + average survivability + no gap ≈ 80", () => {
    const parts = computeFinalComposite({
      capability: 80,
      survivability: 0.5,
      gapDock: 0,
    });
    expect(parts.survAdjustment).toBe(0);
    expect(parts.final).toBeGreaterThanOrEqual(80 - COMPOSITE_SCORING.SURV_SWING);
    expect(parts.final).toBeLessThanOrEqual(80 + COMPOSITE_SCORING.SURV_SWING);
    expect(parts.final).toBeGreaterThan(70);
  });

  it("Mathpix worked example: cap 76, surv 0.49, gap dock 5 → final ~71", () => {
    const adj = computeSurvivabilityAdjustment(0.49);
    expect(adj).toBe(0);
    const parts = computeFinalComposite({
      capability: 76,
      survivability: 0.49,
      gapDock: 5,
    });
    expect(parts.final).toBeGreaterThanOrEqual(69);
    expect(parts.final).toBeLessThanOrEqual(72);
  });

  it("double-count regression: derivation has only capability, survAdjustment, gapDock", () => {
    const withGap = computeFinalComposite({ capability: 76, survivability: 0.49, gapDock: 5 });
    const noGap = computeFinalComposite({ capability: 80, survivability: 0.4, gapDock: 0 });
    for (const parts of [withGap, noGap]) {
      const derivation = `${parts.capability} + (${parts.survAdjustment})${parts.gapDock > 0 ? ` − ${parts.gapDock}` : ""} = ${parts.final}`;
      expect(derivationHasOnlyLegitimateTerms(derivation)).toBe(true);
      expect(derivation).not.toMatch(/pool|domain|credential|recognizability/i);
    }
    const illegitimate = "76 + (-0) − 5 − 11 (pool) = 60";
    expect(derivationHasOnlyLegitimateTerms(illegitimate)).toBe(false);
  });

  it("monotonicity: higher survivability never lowers final (fixed capability + gap)", () => {
    const low = computeFinalComposite({ capability: 70, survivability: 0.35, gapDock: 0 }).final;
    const mid = computeFinalComposite({ capability: 70, survivability: 0.5, gapDock: 0 }).final;
    const high = computeFinalComposite({ capability: 70, survivability: 0.65, gapDock: 0 }).final;
    expect(mid).toBeGreaterThanOrEqual(low);
    expect(high).toBeGreaterThanOrEqual(mid);
  });

  it("monotonicity: larger gapDock never raises final", () => {
    const none = computeFinalComposite({ capability: 75, survivability: 0.5, gapDock: 0 }).final;
    const moderate = computeFinalComposite({ capability: 75, survivability: 0.5, gapDock: 6 }).final;
    const central = computeFinalComposite({ capability: 75, survivability: 0.5, gapDock: 16 }).final;
    expect(moderate).toBeLessThan(none);
    expect(central).toBeLessThan(moderate);
  });

  it("survAdjustment is bounded to ±SURV_SWING", () => {
    expect(computeSurvivabilityAdjustment(0)).toBe(-COMPOSITE_SCORING.SURV_SWING);
    expect(computeSurvivabilityAdjustment(1)).toBe(COMPOSITE_SCORING.SURV_SWING);
    expect(computeSurvivabilityAdjustment(0.5)).toBe(0);
  });

  it("final clamps at 100 with no artificial 85 cap", () => {
    const parts = computeFinalComposite({
      capability: 95,
      survivability: 0.7,
      gapDock: 0,
    });
    expect(parts.final).toBe(100);
  });
});

describe("band headline label mapping", () => {
  it("80→Strong yes; cap-76/final-71→Yes; cap-65/apply-edge→If quick; 55→Skip", () => {
    expect(resolveScoreBand(80)).toBe("strong_apply");
    expect(resolveBandHeadline("strong_apply", true)).toBe("Strong yes");

    expect(resolveScoreBand(71)).toBe("apply");
    expect(computeWorthTailoring(76, "apply")).toBe(true);
    expect(resolveBandHeadline("apply", true)).toBe("Yes");

    expect(resolveScoreBand(62)).toBe("apply");
    expect(computeWorthTailoring(65, "apply")).toBe(false);
    expect(resolveBandHeadline("apply", false)).toBe("If quick");

    expect(resolveScoreBand(55)).toBe("skip");
    expect(resolveBandHeadline("skip", false)).toBe("Skip");
  });
});
