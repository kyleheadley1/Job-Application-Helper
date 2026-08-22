import { describe, expect, it } from "vitest";
import { userProfile } from "../../config/userProfile.js";
import { computeCapabilityBreakdown } from "../../lib/compositeScoreModel.js";
import { isFdeBuilderSoftwarePrimaryShape, fdeBuilderPrimaryRiskSummary } from "../../lib/fdeBuilderRole.js";
import { polishRisksAndMain } from "../../lib/scoringOutputPolish.js";
import { riskLineReferencesAbsentJdConcepts } from "../../lib/riskJdConceptGrounding.js";
import { recomputeStoredJobScore } from "../../lib/recomputeStoredJobScore.js";
import { analyzeStackMismatch } from "../../lib/stackMismatchAnalysis.js";
import { claimableStackFromContexts } from "../../lib/claimableStack.js";
import {
  calibrationSweResumeContexts,
  fixtureToJobRecord,
  loadCalibrationFixture,
} from "../fixtures/calibrationAnchors.js";

describe("BisectHosting Web Developer calibration", () => {
  const fixture = loadCalibrationFixture("bisectHostingWebDeveloper");
  const extracted = fixture.extracted;
  const claimable = claimableStackFromContexts(calibrationSweResumeContexts(), "SWE");

  it("detects PHP/Laravel as standalone required gap — not folded into React/Vue/Nuxt disjunctive line", () => {
    const stack = analyzeStackMismatch(extracted, claimable);
    expect(stack.stackMismatch).toBe(true);
    expect(stack.coreLanguageGap.some((g) => /php|laravel/i.test(g))).toBe(true);

    const scored = recomputeStoredJobScore({
      job: fixtureToJobRecord(fixture),
      resumeContexts: calibrationSweResumeContexts(),
    });
    expect(scored.rules.disjunctiveLanguageRequirementSatisfied).toBe(true);
    expect(scored.rules.stackMismatch).toBe(true);
    expect(scored.rules.coreLanguageGap?.some((g) => /php|laravel/i.test(g))).toBe(true);
  });

  it("does not trigger FDE builder-primary shape from growth engineering body copy", () => {
    expect(isFdeBuilderSoftwarePrimaryShape(extracted)).toBe(false);
    expect(
      riskLineReferencesAbsentJdConcepts(fdeBuilderPrimaryRiskSummary, extracted),
    ).toBe(true);
  });

  it("Key risks surface PHP/Laravel gap and omit absent FDE/SIE/GTM concepts", async () => {
    const scored = recomputeStoredJobScore({
      job: fixtureToJobRecord(fixture),
      resumeContexts: calibrationSweResumeContexts(),
    });

    const { buildKeyRisks } = await import("../../../../web/src/lib/resultSummary.ts");
    const job = {
      ...fixtureToJobRecord(fixture),
      rules: scored.rules,
      mainRisk: fdeBuilderPrimaryRiskSummary,
      risks: [
        "Required core language gap: PHP/Laravel — not in claimable stack.",
        "Limited PHP production depth versus Laravel backend bar.",
      ],
    };

    const polished = polishRisksAndMain({
      mainRisk: job.mainRisk,
      risks: job.risks,
      extracted,
      rules: scored.rules,
      userProfile,
      max: 5,
    });
    job.mainRisk = polished.mainRisk;
    job.risks = polished.risks;

    const keyRisks = buildKeyRisks(job, 5);
    const blob = keyRisks.join(" ").toLowerCase();
    expect(blob).toMatch(/php|laravel/);
    expect(blob).not.toMatch(/forward-deployed|forward deployed/);
    expect(blob).not.toMatch(/solutions-consulting|solutions consulting/);
    expect(blob).not.toMatch(/\bsie\b/);
    expect(blob).not.toMatch(/\bgrowth-engineering title\b/);
    expect(blob).not.toMatch(/\bgtm\b/);
  });

  it("stack fit is materially below full-match given missing required PHP/Laravel", () => {
    const scored = recomputeStoredJobScore({
      job: fixtureToJobRecord(fixture),
      resumeContexts: calibrationSweResumeContexts(),
    });
    const breakdown = computeCapabilityBreakdown(scored.score);
    expect(breakdown.stackFit).toBeLessThan(28);
    expect(scored.rules.stackMismatch).toBe(true);
  });
});
