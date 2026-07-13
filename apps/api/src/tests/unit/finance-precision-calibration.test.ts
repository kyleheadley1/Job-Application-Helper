import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { SCORING_CLAMP_POLICY } from "../../config/scoringClampPolicy.js";
import { userProfile } from "../../config/userProfile.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import {
  loadCalibrationFixture,
  scoreCalibrationAnchor,
} from "../fixtures/calibrationAnchors.js";

describe("finance/insurance penalty precision", () => {
  it("SaaS selling to finance/insurance does not get financePenalty (benefits + degree)", () => {
    const fixture = loadCalibrationFixture("saasSellsToFinance");
    const rules = evaluateRules(fixture.extracted, userProfile, { activeResumeType: "SWE" });
    expect(rules.financePenalty).toBe(false);

    const clamped = applyScoringClampLayer({
      score: { ...fixture.storedCategoryScores, total: 0 },
      extracted: fixture.extracted,
      rules,
    });
    expect(clamped.rules.financePenalty).toBe(false);
    expect(clamped.score.domainFit).toBe(fixture.storedCategoryScores.domainFit);
  });

  it("Heritage Bank institution fires financePenalty and caps domainFit", () => {
    const fixture = loadCalibrationFixture("heritageBankInstitution");
    const rules = evaluateRules(fixture.extracted, userProfile, { activeResumeType: "SWE" });
    expect(rules.financePenalty).toBe(true);

    const clamped = applyScoringClampLayer({
      score: { ...fixture.storedCategoryScores, total: 0 },
      extracted: fixture.extracted,
      rules,
    });
    expect(clamped.rules.financePenalty).toBe(true);
    expect(clamped.score.domainFit).toBeLessThanOrEqual(SCORING_CLAMP_POLICY.financeDomain.domainFitMax);
  });

  it("vendor underwriting language does not classify SaaS as a financial institution", () => {
    const rules = evaluateRules(
      {
        company: "ClaimsAI",
        title: "Software Engineer",
        location: "Remote",
        remoteType: "remote",
        stack: ["TypeScript"],
        requiredSkills: ["TypeScript"],
        preferredSkills: [],
        domainTags: ["ai", "saas"],
        responsibilities: ["Build AI tools that help insurance carriers with underwriting"],
        requirements: ["TypeScript"],
        rawText: `
ClaimsAI builds AI software for insurance carriers to improve underwriting workflows.
We sell software to life insurers and commercial banks. Series B SaaS.
        `.trim(),
      },
      userProfile,
      { activeResumeType: "SWE" },
    );
    expect(rules.financePenalty).toBe(false);
  });

  it("guards: Cherry Hill / Traba / Precisely unchanged on finance axis", () => {
    for (const key of ["cherryHill", "trabaAppliedAi", "preciselyAssociateSweFrontend"] as const) {
      const scored = scoreCalibrationAnchor(key);
      expect(scored.rules.financePenalty).toBe(false);
    }
  });
});
