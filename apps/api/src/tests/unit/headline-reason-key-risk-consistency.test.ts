import { describe, expect, it } from "vitest";
import { hasRequiredStackLanguageMismatch } from "../../lib/requiredStackMismatch.js";
import { selectDominantLever } from "../../lib/strategicLever.js";
import {
  loadCalibrationFixture,
  scoreCalibrationAnchor,
} from "../fixtures/calibrationAnchors.js";

/**
 * Guards two text paths (Key Risks notes / deriveActionLine) against silent
 * divergence — the Eulerity weak headline named "employer recognizability"
 * while Key Risks already named the Java gap.
 */
describe("headline-reason vs key-risk consistency", () => {
  it("reproduces the pre-fix dominant-lever failure mode on Eulerity", () => {
    const scored = scoreCalibrationAnchor("headlineReasonKeyRiskConsistency");
    const rows = scored.score.scoreDisplay?.survivabilityRows ?? [];
    const dominant = selectDominantLever(rows, scored.rules);

    expect(hasRequiredStackLanguageMismatch(scored.rules)).toBe(true);
    expect(scored.rules.coreLanguageGap).toContain("Java");
    // Without the actionLine override, the weak/stretch line would have named recognizability.
    expect(dominant?.penaltyName?.toLowerCase()).toMatch(/recognizability/);
    expect(["weak", "stretch"]).toContain(scored.score.scoreDisplay?.scoreBand);
  });

  it("Key Risks and the weak/stretch headline both name the Java gap", () => {
    const scored = scoreCalibrationAnchor("headlineReasonKeyRiskConsistency");
    const display = scored.score.scoreDisplay!;

    const keyRiskNote = scored.rules.notes.find((n) =>
      /Required core language gap:\s*Java/i.test(n),
    );
    expect(keyRiskNote).toBeTruthy();

    expect(display.actionLine).toMatch(/^(Weak|Apply but weak \(stretch\)) — /);
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
      const display = scored.score.scoreDisplay;
      if (display?.hardGates.length) {
        expect(line).toMatch(/^Weak — hard gate: /);
      } else if (display?.scoreBand === "weak" || display?.scoreBand === "stretch") {
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
