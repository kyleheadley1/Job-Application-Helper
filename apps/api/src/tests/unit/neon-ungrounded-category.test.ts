import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import {
  countDifferentiatorTags,
  jobDescriptionBlob,
} from "../../lib/differentiatorCoverage.js";
import {
  calibrationSweResumeContexts,
  scoreCalibrationAnchor,
} from "../fixtures/calibrationAnchors.js";

describe("Neon — textually-ungrounded company-category inference", () => {
  it("does not none-cap stack/FO when the short React/TS bar is met", () => {
    const scored = scoreCalibrationAnchor("neonTextuallyUngrounded");
    const bd = scored.score.scoreDisplay?.capabilityBreakdown;
    // Pre-fix NONE_CAP was 22 regardless of match quality.
    expect(bd?.stackFit).toBeGreaterThan(22);
    expect(bd?.functionalOverlap).toBeGreaterThan(22);
    expect(scored.differentiatorCoverage.note).not.toMatch(/,\s*capped/i);
  });

  it("does not assert mature production-ownership / payment rigor / degree risk without duties text", () => {
    const scored = scoreCalibrationAnchor("neonTextuallyUngrounded");
    const rules = evaluateRules(scored.fixture.extracted, userProfile, {
      resumeContexts: calibrationSweResumeContexts(),
      activeResumeType: "SWE",
    });
    const notes = rules.notes.join(" | ");
    expect(notes).not.toMatch(/Mature production-ownership bar/i);
    expect(notes).not.toMatch(/production reliability, backend fundamentals, and operational maturity/i);
    expect(rules.explicitDegreeRisk).toBe(false);
    expect(notes).not.toMatch(/Degree gate at structured employer/i);
    expect(notes).not.toMatch(/Explicit CS degree requirement/i);
    // Pure React/TS duties with payments only in About/domainTags → no backend Key Risk note.
    expect(notes).not.toMatch(/backend\/API product work/i);
    expect(notes).not.toMatch(/payment- or API-heavy product work with production\/reliability/i);
  });

  it("StubHub still keeps platform/infra role-lane caps (unguarded differentiator absence ≠ drop lane caps)", () => {
    const scored = scoreCalibrationAnchor("stubHubCoreCompute");
    expect(scored.rules.platformInfraRole || scored.rules.roleLane === "platform_infra").toBe(true);
    expect(scored.score.scoreDisplay?.capabilityBreakdown?.stackFit).toBeLessThanOrEqual(18);
  });

  it("Kong does not infer platform/backend risks from company API-management chrome", () => {
    const scored = scoreCalibrationAnchor("kongAiEnablementUngrounded");
    const rules = evaluateRules(scored.fixture.extracted, userProfile, {
      resumeContexts: calibrationSweResumeContexts(),
      activeResumeType: "SWE",
    });
    const notes = rules.notes.join(" | ");

    expect(notes).not.toMatch(/backend\/API product work/i);
    expect(notes).not.toMatch(/platform engineering|pure platform engineering/i);
    expect(notes).not.toMatch(/Preferred Go|platform stack/i);
    expect(scored.score.scoreDisplay?.differentiatorCoverageNote).not.toMatch(/\bsse\b/i);
    expect(scored.score.scoreDisplay?.differentiatorCoverageNote).not.toMatch(/\bgo\b/i);

    const tags = countDifferentiatorTags(jobDescriptionBlob(scored.fixture.extracted));
    expect(tags.matchedTags).not.toContain("sse");
    expect(tags.matchedTags).not.toContain("go");
  });
});
