import { describe, expect, it } from "vitest";
import { hasRequiredStackLanguageMismatch } from "../../lib/referralAdvice.js";
import { selectDominantLever } from "../../lib/strategicLever.js";
import {
  loadCalibrationFixture,
  scoreCalibrationAnchor,
} from "../fixtures/calibrationAnchors.js";

/**
 * Guards three text paths (Key Risks notes / referralAdvice / deriveActionLine)
 * against silent divergence — the Eulerity Skip headline named "employer
 * recognizability" while Key Risks + referral already named the Java gap.
 */
describe("headline-reason vs key-risk consistency", () => {
  it("reproduces the pre-fix dominant-lever failure mode on Eulerity", () => {
    const scored = scoreCalibrationAnchor("headlineReasonKeyRiskConsistency");
    const rows = scored.score.scoreDisplay?.survivabilityRows ?? [];
    const dominant = selectDominantLever(rows, scored.rules);

    expect(hasRequiredStackLanguageMismatch(scored.rules)).toBe(true);
    expect(scored.rules.coreLanguageGap).toContain("Java");
    // Without the actionLine override, skip band would have named recognizability.
    expect(dominant?.penaltyName?.toLowerCase()).toMatch(/recognizability/);
    expect(scored.score.scoreDisplay?.scoreBand).toBe("skip");
  });

  it("Key Risks, referral advice, and skip headline all name the Java gap", () => {
    const scored = scoreCalibrationAnchor("headlineReasonKeyRiskConsistency");
    const display = scored.score.scoreDisplay!;

    const keyRiskNote = scored.rules.notes.find((n) =>
      /Required core language gap:\s*Java/i.test(n),
    );
    expect(keyRiskNote).toBeTruthy();

    expect(display.referralUrgency).toBe("strongly_advised");
    expect(display.referralAdvice).toMatch(/required core-language \/ stack gap/i);

    expect(display.actionLine).toMatch(/Not worth the effort/i);
    expect(display.actionLine).toMatch(/required core-language gap \(Java\)/i);
    expect(display.actionLine).not.toMatch(/recognizability/i);
  });

  it("documents screenshot score snapshots without claiming Item G caused them", () => {
    const fixture = loadCalibrationFixture("headlineReasonKeyRiskConsistency") as {
      screenshotSnapshots?: {
        preFixApplyBand: { impliedRawCategories: { stackFit: number; levelFit: number } };
        postReferralFixSkipBand: { impliedRawCategories: { stackFit: number; levelFit: number } };
      };
      anchorNote?: string;
    };
    const snaps = fixture.screenshotSnapshots;
    expect(snaps?.preFixApplyBand.impliedRawCategories).toEqual({
      stackFit: 10,
      levelFit: 19,
    });
    expect(snaps?.postReferralFixSkipBand.impliedRawCategories).toEqual({
      stackFit: 9,
      levelFit: 18,
    });
    expect(fixture.anchorNote).toMatch(/unexplained by those commits/i);
  });

  it("paired verbiage anchors stay consistent (Eulerity + NYT CDP)", () => {
    for (const key of ["eulerityJavaRequired", "nytCdpRequiredLanguage"] as const) {
      const scored = scoreCalibrationAnchor(key);
      expect(hasRequiredStackLanguageMismatch(scored.rules)).toBe(true);
      const line = scored.score.scoreDisplay?.actionLine ?? "";
      if (scored.score.scoreDisplay?.scoreBand === "skip") {
        expect(line).toMatch(/required core-language/i);
        expect(line).not.toMatch(/recognizability/i);
      }
    }
  });

  it("roleLane is product_backend — Item G caps do not explain stack/level docks", () => {
    const scored = scoreCalibrationAnchor("headlineReasonKeyRiskConsistency");
    expect(scored.rules.roleLane).toBe("product_backend");
    expect(scored.rules.adjacentRoleFunction).toBe(false);
    expect(scored.rules.frontendPrimaryRole).toBe(false);
    expect(scored.rules.platformInfraRole).toBe(false);
  });
});
