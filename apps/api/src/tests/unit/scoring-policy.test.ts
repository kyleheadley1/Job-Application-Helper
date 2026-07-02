import { describe, expect, it } from "vitest";
import {
  mapRecommendationFromScore,
  resolveRecommendation,
  hasHardGateNote,
} from "../../lib/scoringCaps.js";
import { resolveCompositeRecommendation } from "../../lib/compositeScoreModel.js";
import type { RuleEvaluation } from "../../types/scoring.js";
import { getTrackerColor, SCORE_CATEGORY_MAXES } from "../../config/scoringPolicy.js";
import { evaluateShortlist } from "../../lib/shortlist.js";
import type { JobRecord } from "../../types/job.js";

const cleanRules = (): RuleEvaluation => ({
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

describe("scoring policy behavior", () => {
  it("category maxes match LLM rubric (transparency dimensions)", () => {
    expect(SCORE_CATEGORY_MAXES).toEqual({
      stackFit: 20,
      levelFit: 20,
      domainFit: 10,
      resumeStoryClarity: 10,
      functionalOverlap: 15,
      recruiterFriendliness: 15,
      careerValue: 10,
    });
  });

  it("maps recommendations by composite final score bands", () => {
    expect(mapRecommendationFromScore(75)).toBe("apply_cold");
    expect(mapRecommendationFromScore(55)).toBe("referral_gated");
    expect(mapRecommendationFromScore(40)).toBe("stretch_signal");
    expect(mapRecommendationFromScore(25)).toBe("skip");
  });

  it("2x2 matrix separates capability from survivability", () => {
    expect(resolveCompositeRecommendation(75, 0.6)).toBe("apply_cold");
    expect(resolveCompositeRecommendation(75, 0.4)).toBe("referral_gated");
    expect(resolveCompositeRecommendation(60, 0.6)).toBe("stretch_signal");
    expect(resolveCompositeRecommendation(60, 0.4)).toBe("skip");
  });

  it("resolveRecommendation uses capability/survivability when provided", () => {
    expect(resolveRecommendation(32, cleanRules(), 8, 78, 0.4)).toBe("referral_gated");
    expect(resolveRecommendation(48, cleanRules(), 8, 78, 0.62)).toBe("apply_cold");
  });

  it("hasHardGateNote detects gate flags", () => {
    expect(hasHardGateNote({ ...cleanRules(), locationMismatch: true })).toBe(true);
    expect(hasHardGateNote(cleanRules())).toBe(false);
  });

  it("shortlists high-fit fresh to_review roles without hard gates", () => {
    const job: JobRecord = {
      id: "j1",
      extracted: { company: "Co", title: "Eng", stack: [], requiredSkills: [], preferredSkills: [], domainTags: [], responsibilities: [], requirements: [] },
      rules: cleanRules(),
      score: {
        stackFit: 16,
        levelFit: 16,
        domainFit: 8,
        resumeStoryClarity: 9,
        functionalOverlap: 14,
        recruiterFriendliness: 12,
        careerValue: 9,
        total: 84,
        scoreDisplay: { final: 84, hardGates: [] },
        survivabilityBreakdown: { poolFriendliness: 0.65 },
      },
      recommendation: "apply_cold",
      salaryAsk: {},
      recommendedResume: "SWE",
      resumeRationale: [],
      topMatch: "",
      mainRisk: "",
      rationale: [],
      risks: [],
      generated: {},
      tracker: {},
      status: "to_review",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(evaluateShortlist(job).onShortlist).toBe(true);
    expect(evaluateShortlist({ ...job, status: "rejected" }).onShortlist).toBe(false);
    expect(
      evaluateShortlist({
        ...job,
        score: {
          ...job.score,
          scoreDisplay: { final: 60, hardGates: [] },
          survivabilityBreakdown: { poolFriendliness: 0.4 },
        },
      }).onShortlist,
    ).toBe(false);
  });

  it("maps tracker colors by status + score", () => {
    expect(getTrackerColor("to_review", 55)).toBe("green");
    expect(getTrackerColor("to_review", 30)).toBe("yellow");
    expect(getTrackerColor("interviewing", 65)).toBe("blue");
    expect(getTrackerColor("rejected", 90)).toBe("red");
  });
});
