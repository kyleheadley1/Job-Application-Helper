import { describe, expect, it } from "vitest";
import {
  hourlyToAnnual,
  HOURS_PER_YEAR,
  parseSalaryFromText,
  resolvePostedSalary,
} from "../../lib/salaryConversion.js";
import { computeSalaryAsk } from "../../agents/jobAgent/salaryAsk.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { RuleEvaluation, ScoreBreakdown } from "../../types/scoring.js";

describe("salaryConversion", () => {
  it("converts hourly to annual using 2080 hours", () => {
    expect(HOURS_PER_YEAR).toBe(2080);
    expect(hourlyToAnnual(50)).toBe(104_000);
    expect(hourlyToAnnual(45)).toBe(93_600);
  });

  it("parses hourly range into annual min/max", () => {
    const parsed = parseSalaryFromText("Compensation: $45/hr - $55/hr. Remote US.");
    expect(parsed).toEqual({ min: 93_600, max: 114_400, currency: "USD" });
  });

  it("parses single hourly rate into annual point band", () => {
    const parsed = parseSalaryFromText("Pay is $50 per hour for this contract-to-hire role.");
    expect(parsed).toEqual({ min: 104_000, max: 104_000, currency: "USD" });
  });

  it("still parses yearly bands before hourly", () => {
    const parsed = parseSalaryFromText("$130,000 - $160,000 / yr plus bonus");
    expect(parsed?.min).toBe(130_000);
    expect(parsed?.max).toBe(160_000);
  });

  it("resolvePostedSalary falls back to hourly text in raw JD", () => {
    const job: ExtractedJobData = {
      company: "Co",
      title: "Engineer",
      stack: [],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: [],
      rawText: "Hourly rate: $40-$48/hour. Full-time onsite.",
    };
    expect(resolvePostedSalary(job)).toEqual({ min: 83_200, max: 99_840, currency: "USD" });
  });
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
  notes: [],
});

const scoreParts = (partial: Partial<ScoreBreakdown> & Pick<ScoreBreakdown, "stackFit" | "levelFit">): ScoreBreakdown => {
  const stackFit = partial.stackFit;
  const levelFit = partial.levelFit;
  const domainFit = partial.domainFit ?? 8;
  const resumeStoryClarity = partial.resumeStoryClarity ?? 8;
  const functionalOverlap = partial.functionalOverlap ?? 10;
  const recruiterFriendliness = partial.recruiterFriendliness ?? 11;
  const careerValue = partial.careerValue ?? 7;
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

describe("computeSalaryAsk hourly JD", () => {
  it("produces salary ask + range from hourly-only JD text", () => {
    const ask = computeSalaryAsk({
      extracted: {
        company: "AgencyCo",
        title: "Junior Developer",
        stack: [],
        requiredSkills: [],
        preferredSkills: [],
        domainTags: [],
        responsibilities: [],
        requirements: [],
        rawText: "Compensation: $45/hr - $55/hr. Remote.",
      },
      score: scoreParts({ stackFit: 14, levelFit: 16, total: 72 }),
      recommendation: "selective_yes",
      rules: baseRules(),
    });

    expect(ask.number).toBeGreaterThan(0);
    expect(ask.rangeMin).toBeGreaterThan(0);
    expect(ask.rangeMax).toBeGreaterThan(ask.number!);
    expect(ask.rangeMin!).toBeLessThanOrEqual(ask.number!);
    expect(ask.number).toBeGreaterThanOrEqual(93_600);
    expect(ask.number).toBeLessThanOrEqual(114_400);
  });
});
