import { describe, expect, it } from "vitest";
import { analyzeStackMismatch } from "../../lib/stackMismatchAnalysis.js";
import { claimableStackFromContexts } from "../../lib/claimableStack.js";
import { detectProductionInfraOwnershipGap } from "../../lib/namedCapabilityRiskPenalty.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import { STACK_MISMATCH_CAPS } from "../../config/scoringPolicy.js";
import {
  calibrationSweResumeContexts,
  fixtureToJobRecord,
  loadCalibrationFixture,
  scoreCalibrationAnchor,
} from "../fixtures/calibrationAnchors.js";

describe("Bubble Software Engineer 2, Scaling", () => {
  const fixture = loadCalibrationFixture("bubbleSoftwareEngineer2Scaling");
  const claimable = claimableStackFromContexts(calibrationSweResumeContexts(), "SWE");
  const resumeText = calibrationSweResumeContexts().SWE!.rawText;

  it("treats Rust/Terraform/Redis from JD stack as core stack gaps", () => {
    const mismatch = analyzeStackMismatch(fixture.extracted, claimable);
    expect(mismatch.stackMismatch).toBe(true);
    expect(mismatch.coreLanguageGap).toEqual(
      expect.arrayContaining(["Rust", "Terraform", "Redis"]),
    );
  });

  it("detects production-infra ownership gap for Scaling expectations", () => {
    const gap = detectProductionInfraOwnershipGap({
      job: fixture.extracted,
      resumeText,
      claimable,
    });
    expect(gap.active).toBe(true);
    expect(gap.riskNote).toMatch(/production-scale|observability|on-call/i);
    expect(gap.survivabilityDock).toBeGreaterThan(0);
  });

  it("Key Risks and Survivability Penalties agree — no None identified", () => {
    const scored = scoreCalibrationAnchor("bubbleSoftwareEngineer2Scaling");
    expect(scored.rules.productionInfraOwnershipGap).toBe(true);
    expect(scored.rules.stackMismatch).toBe(true);
    expect(
      scored.rules.notes.some((n) => /limited hands-on production-scale/i.test(n)),
    ).toBe(true);

    const display = buildScoreDisplay({
      score: scored.score,
      rules: scored.rules,
      extracted: fixture.extracted,
      recommendation: scored.recommendation,
    });
    expect(display).toBeTruthy();
    expect(display!.survivabilityPenalties.length).toBeGreaterThan(0);
    expect(
      display!.survivabilityPenalties.some((p) =>
        /production-scale|observability|on-call|Rust|Terraform|Redis|core stack/i.test(
          p.message,
        ),
      ),
    ).toBe(true);
    expect(
      display!.survivabilityRows.some((r) => r.key === "productionInfraOwnershipGap"),
    ).toBe(true);
  });

  it("clamps stackFit well below a lenient 17/20 when core stack is absent", () => {
    const scored = scoreCalibrationAnchor("bubbleSoftwareEngineer2Scaling");
    expect(scored.score.stackFit).toBeLessThanOrEqual(STACK_MISMATCH_CAPS.tier1StackFitMax);
    // Capability stack slice should not look like a near-full 30/35 after rescale.
    const display = buildScoreDisplay({
      score: scored.score,
      rules: scored.rules,
      extracted: fixture.extracted,
      recommendation: scored.recommendation,
    });
    const stackSlice = display?.capabilityBreakdown.stackFit ?? 0;
    expect(stackSlice).toBeLessThan(25);
  });
});
