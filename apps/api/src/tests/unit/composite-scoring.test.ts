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
  it("no penalty at neutral survivability (0.60)", () => {
    expect(computeSurvivabilityAdjustment(0.6)).toBe(0);
    const parts = computeFinalComposite({
      capability: 80,
      survivability: 0.6,
      gapDock: 0,
    });
    expect(parts.survAdjustment).toBe(0);
    expect(parts.final).toBe(80);
  });

  it("steep penalty below neutral: cap 87 + surv 0.47 → final ~82", () => {
    const adj = computeSurvivabilityAdjustment(0.47);
    expect(adj).toBe(-5);
    const parts = computeFinalComposite({
      capability: 87,
      survivability: 0.47,
      gapDock: 0,
    });
    expect(parts.final).toBe(82);
    expect(`${parts.capability} + (${parts.survAdjustment}) = ${parts.final}`).toBe(
      "87 + (-5) = 82",
    );
  });

  it("Mathpix worked example: cap 76, surv 0.49, gap dock 5 → final ~66", () => {
    const adj = computeSurvivabilityAdjustment(0.49);
    expect(adj).toBe(-4);
    const parts = computeFinalComposite({
      capability: 76,
      survivability: 0.49,
      gapDock: 5,
    });
    expect(parts.final).toBe(67);
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
    const mid = computeFinalComposite({ capability: 70, survivability: 0.6, gapDock: 0 }).final;
    const high = computeFinalComposite({ capability: 70, survivability: 0.75, gapDock: 0 }).final;
    expect(mid).toBeGreaterThanOrEqual(low);
    expect(high).toBeGreaterThanOrEqual(mid);
  });

  it("monotonicity: larger gapDock never raises final", () => {
    const none = computeFinalComposite({ capability: 75, survivability: 0.6, gapDock: 0 }).final;
    const moderate = computeFinalComposite({ capability: 75, survivability: 0.6, gapDock: 6 }).final;
    const central = computeFinalComposite({ capability: 75, survivability: 0.6, gapDock: 16 }).final;
    expect(moderate).toBeLessThan(none);
    expect(central).toBeLessThan(moderate);
  });

  it("survAdjustment is bounded to ADJ_MIN/ADJ_MAX", () => {
    expect(computeSurvivabilityAdjustment(0)).toBe(COMPOSITE_SCORING.SURV_ADJ_MIN);
    expect(computeSurvivabilityAdjustment(1)).toBe(6);
    expect(computeSurvivabilityAdjustment(0.6)).toBe(0);
    expect(computeSurvivabilityAdjustment(0.1)).toBe(COMPOSITE_SCORING.SURV_ADJ_MIN);
  });

  it("final clamps at 100", () => {
    const parts = computeFinalComposite({
      capability: 96,
      survivability: 0.9,
      gapDock: 0,
    });
    expect(parts.final).toBe(100);
  });
});

describe("band headline label mapping", () => {
  it("85+→Strong yes; 82→Yes; apply-edge→If quick; 55→Skip", () => {
    expect(resolveScoreBand(85)).toBe("strong_apply");
    expect(resolveBandHeadline("strong_apply", 87)).toBe("Strong yes");

    expect(resolveScoreBand(82)).toBe("apply");
    expect(computeWorthTailoring(82, "apply")).toBe(true);
    expect(resolveBandHeadline("apply", 82)).toBe("Yes");

    expect(resolveScoreBand(62)).toBe("apply");
    expect(computeWorthTailoring(65, "apply")).toBe(false);
    expect(resolveBandHeadline("apply", 65)).toBe("If quick");

    expect(resolveScoreBand(55)).toBe("skip");
    expect(resolveBandHeadline("skip", 55)).toBe("Skip");
  });
});
