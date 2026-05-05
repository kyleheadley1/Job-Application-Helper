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
  vagueEarlyStageAiCalibration: false,
  hardRuleNotes: [],
  pythonStackFlexibleWithJsTs: false,
  healthcareProductEngineering: false,
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

  it("never anchors below 120k on wide 150k+ posted bands for viable fits", () => {
    const ask = computeSalaryAsk({
      extracted: { ...baseJob(), salary: { min: 150_000, max: 260_000 } },
      score: scoreParts({ stackFit: 17, levelFit: 9, total: 72 }),
      recommendation: "selective_yes",
      rules: baseRules(),
    });
    expect(ask.number).toBeGreaterThanOrEqual(120_000);
  });

  it("uses 120k–135k band for entry-level applied-AI remote US when salary is not posted", () => {
    const ask = computeSalaryAsk({
      extracted: {
        company: "StealthCo",
        title: "AI Engineering Intern",
        stack: ["Python"],
        requiredSkills: [],
        preferredSkills: [],
        domainTags: [],
        responsibilities: ["Ship generative AI experiments."],
        requirements: [],
        yearsExperience: { min: 0, max: 2 },
        location: "Remote (US)",
        rawText: "Remote (US). Seed startup. LLM and generative AI. Entry friendly.",
      },
      score: scoreParts({ stackFit: 16, levelFit: 10, total: 72 }),
      recommendation: "selective_yes",
      rules: { ...baseRules(), earlyCareerFriendlyRole: true },
    });
    expect(ask.number).toBe(127_500);
    expect(ask.rangeMin).toBe(120_000);
    expect(ask.rangeMax).toBe(135_000);
  });
});
