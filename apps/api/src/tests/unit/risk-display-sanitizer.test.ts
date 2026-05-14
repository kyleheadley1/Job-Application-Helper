import { describe, expect, it } from "vitest";
import {
  applyCharlieHealthProductCalibration,
  polishRisksAndMain,
} from "../../lib/scoringOutputPolish.js";
import { sanitizeVisibleRiskLine, stripEvaluatorJargon } from "../../lib/riskDisplaySanitizer.js";
import { userProfile } from "../../config/userProfile.js";
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
  fdeBuilderSoftwarePrimary: false,
  vagueEarlyStageAiCalibration: false,
  hardRuleNotes: [],
  pythonStackFlexibleWithJsTs: false,
  healthcareProductEngineering: false,
  notes: [],
  penaltyVector: {},
});

describe("riskDisplaySanitizer", () => {
  it("removes tech tokens absent from JD and profile", () => {
    const extracted: ExtractedJobData = {
      company: "Charlie Health",
      title: "Software Engineer",
      stack: ["React", "Python", "PostgreSQL"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: [],
      rawText: "React, Python, PostgreSQL, TypeScript, JavaScript.",
    };
    const line =
      "Limited production experience with Python and PostgreSQL (and Go) versus a TypeScript-first profile.";
    const out = sanitizeVisibleRiskLine(line, {
      extracted,
      userProfile,
      rules: baseRules(),
    });
    expect(out.toLowerCase()).not.toMatch(/\bgo\b/);
    expect(out.toLowerCase()).toContain("python");
  });

  it("rewrites Plaid-like evaluator jargon using the current company", () => {
    const raw =
      "Plaid-like mature fintech/API infrastructure employers may screen hard for production scale.";
    const cleaned = stripEvaluatorJargon(raw, "Charlie Health");
    expect(cleaned.toLowerCase()).not.toContain("plaid");
    expect(cleaned).toMatch(/charlie health/i);
  });

  it("polishRisksAndMain strips hallucinated stack tokens from output", () => {
    const extracted: ExtractedJobData = {
      company: "Acme",
      title: "Engineer",
      stack: ["Python", "PostgreSQL"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: [],
      rawText: "Python and PostgreSQL backend product work.",
    };
    const { mainRisk } = polishRisksAndMain({
      mainRisk: "Gap on Kubernetes and Go versus JD emphasis.",
      risks: [],
      extracted,
      userProfile,
      rules: baseRules(),
      max: 2,
    });
    expect(mainRisk.toLowerCase()).not.toContain("go");
    expect(mainRisk.toLowerCase()).not.toContain("kubernetes");
  });
});

describe("applyCharlieHealthProductCalibration", () => {
  it("nudges Charlie Health healthcare-product scores into the low/mid 80s band", () => {
    const extracted: ExtractedJobData = {
      company: "Charlie Health",
      title: "Software Engineer",
      stack: ["TypeScript", "React"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: [],
      rawText: "Healthcare product engineering with APIs.",
    };
    const rules: RuleEvaluation = {
      ...baseRules(),
      healthcareProductEngineering: true,
    };
    const score = {
      stackFit: 18,
      levelFit: 10,
      domainFit: 5,
      resumeStoryClarity: 13,
      functionalOverlap: 8,
      recruiterFriendliness: 9,
      careerValue: 7,
      total: 70,
    };
    const next = applyCharlieHealthProductCalibration({ score, extracted, rules, userProfile });
    expect(next.total).toBeGreaterThanOrEqual(82);
    expect(next.total).toBeLessThanOrEqual(85);
    expect(next.stackFit).toBeGreaterThanOrEqual(20);
    expect(next.stackFit).toBeLessThanOrEqual(22);
  });
});
