import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { scoreDomainMatchForListing } from "../../lib/survivabilityScore.js";
import {
  loadCalibrationFixture,
  scoreCalibrationAnchor,
} from "../fixtures/calibrationAnchors.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

describe("healthcare product domain match", () => {
  it("Clinical Ink: healthcareProductEngineering with domainMatch above 0.32", () => {
    const fixture = loadCalibrationFixture("clinicalInkHealthcare");
    const rules = evaluateRules(fixture.extracted, userProfile, { activeResumeType: "SWE" });
    expect(rules.healthcareProductEngineering).toBe(true);
    expect(rules.domainMismatch).toBe(false);

    const domainMatch = scoreDomainMatchForListing(
      fixture.extracted,
      SWE_RESUME,
      rules,
      { ...fixture.storedCategoryScores, total: 0 },
    );
    expect(domainMatch).toBeGreaterThan(0.32);

    const scored = scoreCalibrationAnchor("clinicalInkHealthcare");
    expect(scored.score.survivabilityBreakdown?.domainMatchForListing ?? 0).toBeGreaterThan(0.32);
    expect(scored.score.total).toBeGreaterThanOrEqual(65);
  });

  it("Leap: HIPAA/EHR product SWE does not flatten domainMatch to 0.32", () => {
    const fixture = loadCalibrationFixture("leapHealthcareProduct");
    const rules = evaluateRules(fixture.extracted, userProfile, { activeResumeType: "SWE" });
    expect(rules.healthcareProductEngineering).toBe(true);
    expect(rules.domainMismatch).toBe(false);

    const domainMatch = scoreDomainMatchForListing(
      fixture.extracted,
      SWE_RESUME,
      rules,
      { ...fixture.storedCategoryScores, total: 0 },
    );
    expect(domainMatch).toBeGreaterThan(0.32);

    const scored = scoreCalibrationAnchor("leapHealthcareProduct");
    expect(scored.score.survivabilityBreakdown?.domainMatchForListing ?? 0).toBeGreaterThan(0.32);
  });

  it("medical billing remains a hard domain mismatch", () => {
    const rules = evaluateRules(
      {
        company: "BillingCo",
        title: "Medical Billing Specialist",
        location: "Remote",
        remoteType: "remote",
        stack: [],
        requiredSkills: [],
        preferredSkills: [],
        domainTags: ["healthcare"],
        responsibilities: ["Process medical billing claims"],
        requirements: ["medical billing experience"],
        rawText: "Medical billing and revenue cycle. HIPAA. Clinical coding.",
      },
      userProfile,
      { activeResumeType: "SWE" },
    );
    expect(rules.domainMismatch).toBe(true);
    expect(rules.healthcareProductEngineering).toBe(false);
    expect(
      scoreDomainMatchForListing(
        {
          company: "BillingCo",
          title: "Medical Billing Specialist",
          stack: [],
          requiredSkills: [],
          preferredSkills: [],
          domainTags: ["healthcare"],
          responsibilities: [],
          requirements: [],
          rawText: "Medical billing. HIPAA.",
        },
        SWE_RESUME,
        rules,
        {
          stackFit: 10,
          levelFit: 10,
          domainFit: 7,
          resumeStoryClarity: 7,
          functionalOverlap: 10,
          recruiterFriendliness: 10,
          careerValue: 7,
          total: 0,
        },
      ),
    ).toBe(0.18);
  });

  it("guards: Cherry Hill / Traba stay healthy", () => {
    for (const key of ["cherryHill", "trabaAppliedAi"] as const) {
      const scored = scoreCalibrationAnchor(key);
      expect(scored.score.total).toBeGreaterThanOrEqual(70);
    }
  });
});
