import { describe, expect, it } from "vitest";
import { JobRecordSchema, TriageStageDebugSchema } from "../../agents/jobAgent/schemas.js";
import { sanitizeScoreBreakdown, sanitizeStoredJobRecord } from "../../lib/sanitizeStoredJob.js";
import type { JobRecord } from "../../types/job.js";
import type { ScoreBreakdown } from "../../types/scoring.js";

const baseScore = (): ScoreBreakdown => ({
  stackFit: 25,
  levelFit: 18,
  domainFit: 8,
  resumeStoryClarity: 15,
  functionalOverlap: 14,
  recruiterFriendliness: 12,
  careerValue: 9,
  total: 85,
});

describe("sanitizeScoreBreakdown", () => {
  it("clamps legacy category overflow and reconciles total", () => {
    const sanitized = sanitizeScoreBreakdown(baseScore());
    expect(sanitized.resumeStoryClarity).toBeLessThanOrEqual(10);
    expect(sanitized.total).toBeLessThanOrEqual(
      sanitized.stackFit +
        sanitized.levelFit +
        sanitized.domainFit +
        sanitized.resumeStoryClarity +
        sanitized.functionalOverlap +
        sanitized.recruiterFriendliness +
        sanitized.careerValue,
    );
    expect(JobRecordSchema.shape.score.safeParse(sanitized).success).toBe(true);
  });

  it("extracts nested certificationBoost from survivabilityBreakdown", () => {
    const sanitized = sanitizeScoreBreakdown({
      ...baseScore(),
      capability: 80,
      total: 80,
      survivabilityBreakdown: {
        credentialSignal: 0.5,
        certificationBoost: {
          certName: "AWS Developer – Associate",
          status: "lapsed",
          matchedSkills: ["S3"],
          overlapCount: 3,
          boost: 0.1,
          note: "boost",
        },
      } as unknown as Record<string, number>,
    });
    expect(sanitized.certificationBoost?.certName).toMatch(/AWS Developer/i);
    expect(sanitized.survivabilityBreakdown?.certificationBoost).toBeUndefined();
  });

  it("drops stale scoreDisplay missing referral fields", () => {
    const sanitized = sanitizeScoreBreakdown({
      ...baseScore(),
      capability: 80,
      total: 80,
      scoreDisplay: {
        capability: 80,
        capabilityBreakdown: { stackFit: 30, levelFit: 25, functionalOverlap: 25 },
        survivability: 0.55,
        final: 78,
        survAdjustment: -2,
        gapDock: 0,
        scoreDerivation: "80 + (-2) = 78",
        scoreBand: "apply",
        bandHeadline: "Yes",
        worthTailoring: true,
        survivabilityRows: [],
        hardGates: [],
        survivabilityPenalties: [],
        actionLine: "Apply",
      } as ScoreBreakdown["scoreDisplay"],
    });
    expect(sanitized.scoreDisplay).toBeUndefined();
  });
});

describe("sanitizeStoredJobRecord", () => {
  it("removes invalid specializationGap kind for schema parse", () => {
    const job = {
      id: "test-1",
      extracted: {
        company: "Acme",
        title: "Engineer",
        stack: [],
        requiredSkills: [],
        preferredSkills: [],
        domainTags: [],
        responsibilities: [],
        requirements: [],
      },
      rules: {
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
        specializationGap: {
          kind: "invalid_kind" as "backend_stack",
          name: "gap",
          evidence: "e",
          severity: "moderate",
          lever: "resume",
          dock: 5,
        },
      },
      score: sanitizeScoreBreakdown({ ...baseScore(), capability: 70, total: 70 }),
      recommendation: "apply_cold",
      salaryAsk: {},
      recommendedResume: "SWE",
      resumeRationale: [],
      topMatch: "match",
      mainRisk: "risk",
      rationale: [],
      risks: [],
      generated: {},
      tracker: {},
      status: "applied",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as JobRecord;

    const sanitized = sanitizeStoredJobRecord(job);
    expect(sanitized.rules.specializationGap).toBeUndefined();
    expect(JobRecordSchema.safeParse(sanitized).success).toBe(true);
  });

  it("accepts null debug errorCode fields from successful LLM stages", () => {
    const stage = {
      success: true,
      fallbackUsed: false,
      errorCode: null,
      errorType: null,
      errorMessage: null,
    };
    expect(TriageStageDebugSchema.safeParse(stage).success).toBe(true);
  });
});
