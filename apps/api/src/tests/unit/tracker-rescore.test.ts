import { describe, expect, it } from "vitest";
import type { JobRecord } from "../../types/job.js";
import type { RuleEvaluation } from "../../types/scoring.js";
import {
  crossesScoreThreshold,
  hadRescorePenaltySignals,
  isAppliedAiRole,
  isStrictRescoreCandidate,
  shouldPersistRescore,
} from "../../lib/trackerRescore.js";

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

const minimalJob = (over: Partial<JobRecord>): JobRecord =>
  ({
    id: "x",
    extracted: {
      company: "Co",
      title: "Software Engineer",
      stack: [],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: [],
      ...over.extracted,
    },
    rules: over.rules ?? baseRules(),
    score: over.score ?? {
      stackFit: 10,
      levelFit: 10,
      domainFit: 7,
      resumeStoryClarity: 10,
      functionalOverlap: 7,
      recruiterFriendliness: 10,
      careerValue: 7,
      total: 61,
    },
    recommendation: "selective_yes",
    salaryAsk: {},
    recommendedResume: "SWE",
    resumeRationale: [],
    topMatch: "x",
    mainRisk: over.mainRisk ?? "Risk",
    rationale: [],
    risks: over.risks ?? [],
    generated: {},
    tracker: {},
    status: over.status ?? "to_review",
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as JobRecord;

describe("trackerRescore", () => {
  it("detects applied-AI role shape", () => {
    expect(
      isAppliedAiRole(
        minimalJob({
          extracted: {
            company: "C",
            title: "Applied AI Engineer",
            stack: [],
            requiredSkills: [],
            preferredSkills: [],
            domainTags: [],
            responsibilities: ["RAG pipelines"],
            requirements: [],
            rawText: "LLM features",
          },
        }),
      ),
    ).toBe(true);
  });

  it("strict candidate requires band, AI, and penalty signal", () => {
    const aiFinance = minimalJob({
      extracted: {
        company: "C",
        title: "AI Engineer",
        stack: [],
        requiredSkills: [],
        preferredSkills: [],
        domainTags: [],
        responsibilities: ["LLM"],
        requirements: [],
      },
      rules: { ...baseRules(), financePenalty: true },
      score: {
        stackFit: 12,
        levelFit: 10,
        domainFit: 8,
        resumeStoryClarity: 10,
        functionalOverlap: 8,
        recruiterFriendliness: 10,
        careerValue: 8,
        total: 66,
      },
    });
    expect(isStrictRescoreCandidate(aiFinance)).toBe(true);

    const aiNoPenalty = minimalJob({
      extracted: {
        company: "C",
        title: "AI Engineer",
        stack: [],
        requiredSkills: [],
        preferredSkills: [],
        domainTags: [],
        responsibilities: ["LLM"],
        requirements: [],
      },
      rules: baseRules(),
      score: {
        stackFit: 12,
        levelFit: 10,
        domainFit: 8,
        resumeStoryClarity: 10,
        functionalOverlap: 8,
        recruiterFriendliness: 10,
        careerValue: 8,
        total: 66,
      },
    });
    expect(isStrictRescoreCandidate(aiNoPenalty)).toBe(false);
  });

  it("persists when delta ≥ 5", () => {
    expect(
      shouldPersistRescore({ oldTotal: 60, newTotal: 66, status: "to_review" }).apply,
    ).toBe(true);
  });

  it("persists when crossing 70", () => {
    expect(
      shouldPersistRescore({ oldTotal: 68, newTotal: 71, status: "to_review" }).reason,
    ).toBe("crosses_70");
  });

  it("persists when crossing 78", () => {
    expect(
      shouldPersistRescore({ oldTotal: 77, newTotal: 79, status: "to_review" }).reason,
    ).toBe("crosses_78");
  });

  it("skips small deltas below thresholds", () => {
    expect(
      shouldPersistRescore({ oldTotal: 62, newTotal: 64, status: "to_review" }).apply,
    ).toBe(false);
  });

  it("skips rejected roles", () => {
    expect(
      shouldPersistRescore({ oldTotal: 60, newTotal: 70, status: "rejected" }).apply,
    ).toBe(false);
  });

  it("hadRescorePenaltySignals detects python framing in risks", () => {
    expect(
      hadRescorePenaltySignals(baseRules(), {
        extracted: {
          company: "Z",
          title: "Eng",
          stack: [],
          requiredSkills: [],
          preferredSkills: [],
          domainTags: [],
          responsibilities: [],
          requirements: [],
        },
        mainRisk: "Python is primary while profile leads with TypeScript.",
        risks: [],
      }),
    ).toBe(true);
  });

  it("crossesScoreThreshold is symmetric around boundary", () => {
    expect(crossesScoreThreshold(69, 71, 70)).toBe(true);
    expect(crossesScoreThreshold(71, 69, 70)).toBe(true);
    expect(crossesScoreThreshold(72, 74, 70)).toBe(false);
  });
});
