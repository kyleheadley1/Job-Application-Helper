import { describe, expect, it } from "vitest";
import { recomputeStoredJobScore, storedCategoryScores } from "../../lib/recomputeStoredJobScore.js";
import { evaluateHardGates } from "../../lib/hardGates.js";
import type { ExtractedJobData, JobRecord } from "../../types/job.js";
import type { ScoreBreakdown } from "../../types/scoring.js";

const STORED_SCORE: ScoreBreakdown = {
  stackFit: 16,
  levelFit: 14,
  domainFit: 7,
  resumeStoryClarity: 8,
  functionalOverlap: 12,
  recruiterFriendliness: 7,
  careerValue: 6,
  total: 70,
};

const TRIA_JOB: ExtractedJobData = {
  company: "Tria Federal",
  title: "Software Engineer",
  location: "Remote",
  remoteType: "remote",
  stack: ["TypeScript", "Node.js", "Python", "AWS"],
  requiredSkills: ["TypeScript", "Python"],
  preferredSkills: ["AWS"],
  domainTags: ["federal"],
  citizenshipRequirement: "Must be a U.S. citizen due to the security clearance required for this position.",
  clearanceRequirement: {
    required: true,
    timing: "sponsorable",
    raw: "security clearance required for this position",
  },
  responsibilities: ["Build software for federal clients"],
  requirements: [
    "Must be a U.S. citizen due to the security clearance required for this position.",
    "Strong TypeScript and Python experience",
  ],
  rawText: `
Tria Federal — Software Engineer
Remote
Must be a U.S. citizen due to the security clearance required for this position.
Strong TypeScript and Python experience.
  `.trim(),
};

function minimalJob(extracted: ExtractedJobData, score: ScoreBreakdown): JobRecord {
  return {
    id: "test-id",
    extracted,
    rules: { notes: [], hardRuleNotes: [] },
    score,
    recommendation: "no",
    salaryAsk: {},
    recommendedResume: "SWE",
    resumeRationale: [],
    topMatch: "Match",
    mainRisk: "Risk",
    rationale: [],
    risks: [],
    generated: {},
    tracker: {
      priority: "low",
      recommendedAction: "Skip",
      statusOutcome: "no",
      shortlist: false,
      color: "gray",
    },
    status: "to_review",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("storedCategoryScores", () => {
  it("keeps only legacy LLM dimensions", () => {
    const raw = storedCategoryScores({
      ...STORED_SCORE,
      capability: 42,
      survivability: 0.55,
      scoreDisplay: { bandHeadline: "x" } as ScoreBreakdown["scoreDisplay"],
    });
    expect(raw).toEqual({ ...STORED_SCORE, total: 0 });
    expect(raw).not.toHaveProperty("capability");
    expect(raw).not.toHaveProperty("scoreDisplay");
  });
});

describe("recomputeStoredJobScore", () => {
  it("does not hard-gate sponsorable clearance for US citizen (Tria Federal)", () => {
    const job = minimalJob(TRIA_JOB, STORED_SCORE);
    const next = recomputeStoredJobScore({ job });

    const gate = evaluateHardGates(next.rules, TRIA_JOB);
    expect(gate.fired).toBe(false);
    expect(next.recommendation).not.toBe("no");
    expect(next.score.total).toBeGreaterThan(0);
    expect(next.score.scoreDisplay?.referralAdvice).toBeDefined();
  });

  it("rebuilds composite total from stored categories (not prior total)", () => {
    const job = minimalJob(TRIA_JOB, { ...STORED_SCORE, total: 99 });
    const next = recomputeStoredJobScore({ job });
    expect(next.score.total).not.toBe(99);
    expect(typeof next.score.capability).toBe("number");
    expect(typeof next.score.survivability).toBe("number");
  });
});
