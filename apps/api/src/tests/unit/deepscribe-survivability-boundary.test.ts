import { describe, expect, it } from "vitest";
import {
  COMPOSITE_SCORING,
  SURVIVABILITY_TUNING,
  SURVIVABILITY_WEIGHTS,
} from "../../config/capabilitySurvivabilityPolicy.js";
import {
  resolveCompositeRecommendation,
} from "../../lib/compositeScoreModel.js";
import { roundSurvivabilityScalar } from "../../lib/survivabilityScore.js";
import {
  loadCalibrationFixture,
  scoreCalibrationAnchor,
} from "../fixtures/calibrationAnchors.js";

describe("DeepScribe survivability boundary", () => {
  it("unrounded formula is 0.5066; persisted/compared value is 3dp-rounded and below named production thresholds", () => {
    const scored = scoreCalibrationAnchor("deepscribeSurvivabilityBoundary");
    const fixture = loadCalibrationFixture("deepscribeSurvivabilityBoundary") as {
      formulaAudit?: {
        unroundedWeightedAverage: number;
        afterThreeDecimalRounding: number;
      };
      anchorNote?: string;
    };
    const surv = scored.score.survivability!;
    const bd = scored.score.survivabilityBreakdown!;

    expect(scored.rules.productionBarCompetitivePool).toBe(true);
    expect(scored.rules.matureStructuredEmployer).not.toBe(true);

    const expectedUnrounded =
      bd.employerRecognizability * SURVIVABILITY_WEIGHTS.employerRecognizability +
      bd.credentialSignal * SURVIVABILITY_WEIGHTS.credentialSignal +
      bd.impactMetricQuality * SURVIVABILITY_WEIGHTS.impactMetricQuality +
      bd.resumeStoryCoherence * SURVIVABILITY_WEIGHTS.resumeStoryCoherence +
      bd.domainMatchForListing * SURVIVABILITY_WEIGHTS.domainMatchForListing +
      bd.poolFriendliness * SURVIVABILITY_WEIGHTS.poolFriendliness;

    expect(expectedUnrounded).toBeCloseTo(
      fixture.formulaAudit!.unroundedWeightedAverage,
      4,
    );
    expect(roundSurvivabilityScalar(expectedUnrounded)).toBe(
      fixture.formulaAudit!.afterThreeDecimalRounding,
    );
    expect(bd.weightedAverage).toBe(roundSurvivabilityScalar(expectedUnrounded));
    expect(surv).toBe(bd.weightedAverage);

    // Weak cold-apply odds = below the named production cutovers (not a bare 0.5).
    expect(surv).toBeLessThan(SURVIVABILITY_TUNING.goodOddsThreshold);
    expect(surv).toBeLessThan(COMPOSITE_SCORING.SURV_NEUTRAL);
    expect(surv).toBeGreaterThanOrEqual(SURVIVABILITY_TUNING.floor);

    // Stale ≤0.5 test was never production-aligned — live path already treated this as weak.
    expect(scored.score.capability).toBeGreaterThanOrEqual(
      SURVIVABILITY_TUNING.strongCapabilityThreshold,
    );
    expect(
      resolveCompositeRecommendation(scored.score.capability!, surv),
    ).toBe("referral_gated");

    expect(fixture.anchorNote).toMatch(/stale\/arbitrary placeholder/i);
    expect(fixture.anchorNote).toMatch(/already correct/i);

    expect(scored.score.scoreDisplay?.scoreBand).toBe("apply");
    expect(scored.score.scoreDisplay?.scoreBand).not.toBe("strong_apply");
  });

  it("roundSurvivabilityScalar uses 3 decimals (production hygiene)", () => {
    expect(SURVIVABILITY_TUNING.decimalPlaces).toBe(3);
    expect(roundSurvivabilityScalar(0.5066)).toBe(0.507);
    expect(roundSurvivabilityScalar(0.47209999999999996)).toBe(0.472);
    expect(roundSurvivabilityScalar(0.5666)).toBe(0.567);
    expect(roundSurvivabilityScalar(SURVIVABILITY_TUNING.goodOddsThreshold)).toBe(
      SURVIVABILITY_TUNING.goodOddsThreshold,
    );
    expect(roundSurvivabilityScalar(COMPOSITE_SCORING.SURV_NEUTRAL)).toBe(
      COMPOSITE_SCORING.SURV_NEUTRAL,
    );
  });

  it("spot-check: anchors away from the hair still sit on the correct side of named thresholds", () => {
    const cherry = scoreCalibrationAnchor("cherryHill");
    const civis = scoreCalibrationAnchor("civisCattleCall");
    const traba = scoreCalibrationAnchor("trabaAppliedAi");

    expect(cherry.score.survivability).toBeLessThan(SURVIVABILITY_TUNING.goodOddsThreshold);
    expect(cherry.score.survivability).toBeLessThan(COMPOSITE_SCORING.SURV_NEUTRAL);

    expect(civis.score.survivability).toBeLessThan(SURVIVABILITY_TUNING.goodOddsThreshold);
    expect(civis.score.survivability).toBeLessThan(COMPOSITE_SCORING.SURV_NEUTRAL);

    expect(traba.score.survivability).toBeGreaterThanOrEqual(
      SURVIVABILITY_TUNING.goodOddsThreshold,
    );
  });
});
