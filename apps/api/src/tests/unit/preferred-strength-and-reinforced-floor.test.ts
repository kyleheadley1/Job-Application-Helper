import { describe, expect, it } from "vitest";
import { userProfile } from "../../config/userProfile.js";
import {
  attachReinforcedExperienceFloor,
  detectReinforcedExperienceFloor,
  estimateCandidateProfessionalYears,
  reinforcedFloorLevelFitDock,
} from "../../lib/reinforcedExperienceFloor.js";
import {
  candidateHasCicdExperience,
  resolveJdTechStrength,
  rewritePreferredStrengthRiskLine,
} from "../../lib/riskPreferredStrength.js";
import { sanitizeVisibleRiskLine } from "../../lib/riskDisplaySanitizer.js";
import { recomputeStoredJobScore } from "../../lib/recomputeStoredJobScore.js";
import {
  calibrationSweResumeContexts,
  loadCalibrationFixture,
  fixtureToJobRecord,
} from "../fixtures/calibrationAnchors.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { RuleEvaluation } from "../../types/scoring.js";

const baseRules = (): RuleEvaluation => ({
  explicitDegreeRisk: false,
  traditionalCompanyPenalty: false,
  financePenalty: false,
  strictNewGradPipeline: false,
  earlyCareerFriendlyRole: false,
  newGradPenalty: false,
  seniorityOverreach: false,
  locationMismatch: false,
  visaMismatch: false,
  citizenshipMismatch: false,
  clearanceMismatch: false,
  stackMismatch: false,
  domainMismatch: false,
  startupFounderMismatch: false,
  hardRuleNotes: [],
  notes: [],
  penaltyVector: {},
});

describe("preferred-strength Key Risk sanitization (NYT Reflections)", () => {
  const fixture = loadCalibrationFixture("nytReflectionsSupportedFeatureOwnership");
  const extracted = fixture.extracted;
  const resumeRawText = calibrationSweResumeContexts().SWE!.rawText;

  it("tags Kubernetes and CI/CD as Preferred-only from the JD", () => {
    expect(resolveJdTechStrength(extracted, "kubernetes")).toBe("PREFERRED");
    expect(resolveJdTechStrength(extracted, "cicd")).toBe("PREFERRED");
    expect(resolveJdTechStrength(extracted, "oncall")).toBe("REQUIRED");
  });

  it("detects claimable CI/CD on the SWE resume", () => {
    expect(candidateHasCicdExperience({ userProfile, resumeRawText })).toBe(true);
  });

  it("drops Significant DevOps/K8s/CI/CD stretch when those items are Preferred-only", () => {
    const line =
      "Significant DevOps/on-call and container-orchestration responsibilities (CI/CD, Kubernetes) could be a stretch";
    const out = sanitizeVisibleRiskLine(line, {
      extracted,
      userProfile,
      rules: baseRules(),
      resumeRawText,
    });
    expect(out.toLowerCase()).not.toMatch(/significant/);
    expect(out.toLowerCase()).not.toMatch(/could be a stretch/);
    // Must not claim hard K8s/CI/CD stretch; soft preferred wording OK.
    if (out.trim()) {
      expect(out.toLowerCase()).toMatch(/preferred|nice-to-have/);
      expect(out.toLowerCase()).not.toMatch(/weaker/);
    }
  });

  it("rewrites weaker infra/SRE claims when CI/CD is demonstrated", () => {
    const out = rewritePreferredStrengthRiskLine(
      "Weaker infra/SRE background versus production expectations.",
      { extracted, userProfile, resumeRawText },
    );
    expect(out.toLowerCase()).not.toMatch(/weaker\s+infra/);
    if (out.trim()) {
      expect(out.toLowerCase()).toMatch(/kubernetes|preferred|nice-to-have/);
    }
  });
});

describe("reinforced experience floor", () => {
  it("fires for NYT Reflections (8 independent 2+ years lines)", () => {
    const fixture = loadCalibrationFixture("nytReflectionsSupportedFeatureOwnership");
    const floor = detectReinforcedExperienceFloor(fixture.extracted);
    expect(floor.active).toBe(true);
    expect(floor.reinforcingLineCount).toBeGreaterThanOrEqual(4);
    expect(floor.thresholdYears).toBe(2);
    expect(floor.riskNote).toMatch(/restated across/i);
  });

  it("does not fire for a single boilerplate 2+ years line", () => {
    const job: ExtractedJobData = {
      company: "Cherry Technologies",
      title: "Software Engineer",
      stack: ["TypeScript"],
      requiredSkills: ["TypeScript"],
      preferredSkills: [],
      domainTags: [],
      responsibilities: ["Build product features"],
      requirements: ["2+ years of software engineering experience"],
      yearsExperience: { raw: "2+ years", min: 2 },
      rawText:
        "Cherry Technologies\nSoftware Engineer\nRequirements\n2+ years of software engineering experience\nTypeScript and React",
    };
    const floor = detectReinforcedExperienceFloor(job);
    expect(floor.active).toBe(false);
    expect(floor.reinforcingLineCount).toBeLessThan(4);
  });

  it("scales Level-fit dock by repetition and years below the bar", () => {
    const soft = reinforcedFloorLevelFitDock({
      floor: { active: true, thresholdYears: 2, reinforcingLineCount: 4 },
      candidateYears: 1.75,
    });
    const hard = reinforcedFloorLevelFitDock({
      floor: { active: true, thresholdYears: 2, reinforcingLineCount: 8 },
      candidateYears: 1.5,
    });
    expect(hard).toBeGreaterThan(soft);
    expect(hard).toBeGreaterThanOrEqual(2);
  });

  it("attaches reinforcedLineCount during extraction sanitize path", () => {
    const fixture = loadCalibrationFixture("nytReflectionsSupportedFeatureOwnership");
    const attached = attachReinforcedExperienceFloor({
      ...fixture.extracted,
      yearsExperience: { raw: "2+ years", min: 2 },
    });
    expect(attached.yearsExperience?.reinforcedLineCount).toBeGreaterThanOrEqual(4);
  });

  it("NYT Reflections scoring: reinforced floor Key Risk + Level-fit dock; no Preferred DevOps stretch", () => {
    const fixture = loadCalibrationFixture("nytReflectionsSupportedFeatureOwnership");
    const scored = recomputeStoredJobScore({
      job: fixtureToJobRecord(fixture),
      resumeContexts: calibrationSweResumeContexts(),
    });
    expect(scored.rules.reinforcedExperienceFloor).toBe(true);
    expect(scored.rules.titleResponsibilityMismatch).toBe(false);
    expect(
      scored.rules.notes.some((n) => /experience bar is restated across/i.test(n)),
    ).toBe(true);
    // Level fit should be docked below the stored 15 for reinforced floor.
    expect(scored.score.levelFit).toBeLessThan(15);
    expect(estimateCandidateProfessionalYears({ profile: userProfile })).toBe(1.75);
  });
});
