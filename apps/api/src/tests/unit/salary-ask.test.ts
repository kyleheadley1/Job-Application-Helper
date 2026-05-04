import { describe, expect, it } from "vitest";
import { computeSalaryAsk } from "../../agents/jobAgent/salaryAsk.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { RuleEvaluation, ScoreBreakdown } from "../../types/scoring.js";

const baseJob = (): ExtractedJobData => ({
  company: "Co",
  title: "Engineer",
  stack: [],
  requiredSkills: [],
  preferredSkills: [],
  domainTags: [],
  responsibilities: [],
  requirements: [],
  salary: { min: 150_000, max: 250_000 },
});

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
  matureStructuredEmployer: false,
  explicitCoreLanguageMismatch: false,
  notes: [],
});

const scoreParts = (partial: Partial<ScoreBreakdown> & Pick<ScoreBreakdown, "stackFit" | "levelFit">): ScoreBreakdown => {
  const stackFit = partial.stackFit;
  const levelFit = partial.levelFit;
  const domainFit = partial.domainFit ?? 8;
  const resumeStoryClarity = partial.resumeStoryClarity ?? 11;
  const functionalOverlap = partial.functionalOverlap ?? 8;
  const recruiterFriendliness = partial.recruiterFriendliness ?? 11;
  const careerValue = partial.careerValue ?? 8;
  const total =
    partial.total ??
    stackFit + levelFit + domainFit + resumeStoryClarity + functionalOverlap + recruiterFriendliness + careerValue;
  return {
    stackFit,
    levelFit,
    domainFit,
    resumeStoryClarity,
    functionalOverlap,
    recruiterFriendliness,
    careerValue,
    total,
  };
};

describe("computeSalaryAsk", () => {
  it("uses upper-mid band for strong-but-imperfect stack/level on wide postings", () => {
    const ask = computeSalaryAsk({
      extracted: baseJob(),
      score: scoreParts({ stackFit: 17, levelFit: 9, total: 76 }),
      recommendation: "yes",
      rules: baseRules(),
    });
    expect(ask.number).toBe(188_000);
  });

  it("caps at 190k when ask would cross 200k without elite fit", () => {
    const ask = computeSalaryAsk({
      extracted: baseJob(),
      score: scoreParts({ stackFit: 19, levelFit: 11, total: 80 }),
      recommendation: "yes",
      rules: baseRules(),
    });
    expect(ask.number).toBe(190_000);
  });

  it("allows 200k+ when total, level, and stack are elite and no stack mismatch", () => {
    const ask = computeSalaryAsk({
      extracted: baseJob(),
      score: scoreParts({ stackFit: 22, levelFit: 10, total: 85 }),
      recommendation: "yes",
      rules: baseRules(),
    });
    expect(ask.number).toBeGreaterThanOrEqual(200_000);
  });

  it("caps salary ask for mature employer explicit core-language mismatch on wide bands", () => {
    const ask = computeSalaryAsk({
      extracted: baseJob(),
      score: scoreParts({ stackFit: 13, levelFit: 9, total: 73 }),
      recommendation: "selective_yes",
      rules: {
        ...baseRules(),
        matureStructuredEmployer: true,
        explicitCoreLanguageMismatch: true,
      },
    });
    expect(ask.number).toBeLessThanOrEqual(175_000);
    expect(ask.number).toBeGreaterThanOrEqual(150_000);
  });
});
