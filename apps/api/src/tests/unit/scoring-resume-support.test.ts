import { describe, expect, it } from "vitest";
import { applyResumeSupportAdjustments } from "../../agents/jobAgent/scoring.js";
import type { ResumeContextSet } from "../../types/resumeContext.js";
import type { RuleEvaluation, ScoreBreakdown } from "../../types/scoring.js";
import type { ExtractedJobData } from "../../types/job.js";

const baseScore: ScoreBreakdown = {
  stackFit: 18,
  levelFit: 10,
  domainFit: 7,
  resumeStoryClarity: 9,
  functionalOverlap: 6,
  recruiterFriendliness: 10,
  careerValue: 8,
  total: 68,
};

const extracted: ExtractedJobData = {
  company: "Acme",
  title: "Product Engineer",
  stack: ["TypeScript", "Node.js"],
  requiredSkills: ["APIs", "internal tools"],
  preferredSkills: [],
  domainTags: [],
  responsibilities: ["Ship product features and internal tools"],
  requirements: ["Cross-functional collaboration"],
};

const cleanRules: RuleEvaluation = {
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
  notes: [],
};

const resumeContexts: ResumeContextSet = {
  SWE: {
    type: "SWE",
    sourcePath: "x",
    sourceKind: "txt",
    loadedAt: new Date().toISOString(),
    rawText: "TypeScript Node API internal tools stakeholder collaboration",
    metadata: {
      strongestThemes: ["api-first product engineering", "internal tools"],
      projectEvidence: [],
      keywords: ["typescript", "node", "api", "internal", "tools", "stakeholder", "product"],
      bestFitRoleShapes: ["product_fullstack"],
      avoidUseCases: [],
      claimSupport: [{ claim: "TypeScript development", evidenceSnippets: ["Built TypeScript APIs"] }],
    },
  },
};

describe("resume support scoring adjustments", () => {
  it("applies bounded support adjustments only to resumeStoryClarity and functionalOverlap", () => {
    const adjusted = applyResumeSupportAdjustments({
      score: baseScore,
      extracted,
      rules: cleanRules,
      resumeContexts,
    });
    expect(adjusted.resumeStoryClarity - baseScore.resumeStoryClarity).toBeLessThanOrEqual(2);
    expect(adjusted.functionalOverlap - baseScore.functionalOverlap).toBeLessThanOrEqual(1);
    expect(adjusted.stackFit).toBe(baseScore.stackFit);
    expect(adjusted.levelFit).toBe(baseScore.levelFit);
  });

  it("skips resume adjustments when hard blockers dominate", () => {
    const adjusted = applyResumeSupportAdjustments({
      score: baseScore,
      extracted,
      rules: { ...cleanRules, explicitDegreeRisk: true, citizenshipMismatch: true },
      resumeContexts,
    });
    expect(adjusted).toEqual(baseScore);
  });
});
