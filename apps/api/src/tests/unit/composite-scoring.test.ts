import { describe, expect, it } from "vitest";
import { COMPOSITE_SCORING } from "../../config/capabilitySurvivabilityPolicy.js";
import {
  computeFinalComposite,
  computeSurvivabilityAdjustment,
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

  it("Mathpix worked example: cap 70, surv 0.49, moderate dock ~5 → final ~65", () => {
    const adj = computeSurvivabilityAdjustment(0.49);
    expect(adj).toBe(0);
    const parts = computeFinalComposite({
      capability: 70,
      survivability: 0.49,
      gapDock: 5,
    });
    expect(parts.final).toBeGreaterThanOrEqual(63);
    expect(parts.final).toBeLessThanOrEqual(67);
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
