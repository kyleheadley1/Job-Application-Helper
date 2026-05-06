import { describe, expect, it } from "vitest";
import {
  mapRecommendationFromScore,
  resolveRecommendation,
  recommendationHardConstraints,
} from "../../agents/jobAgent/scoring.js";
import type { RuleEvaluation } from "../../types/scoring.js";
import { getTrackerColor, shouldShortlist } from "../../config/scoringPolicy.js";

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
  it("maps recommendations by score band", () => {
    expect(mapRecommendationFromScore(83)).toBe("yes");
    expect(mapRecommendationFromScore(80)).toBe("yes");
    expect(mapRecommendationFromScore(76)).toBe("selective_yes");
    expect(mapRecommendationFromScore(72)).toBe("selective_yes");
    expect(mapRecommendationFromScore(66)).toBe("selective_yes");
    expect(mapRecommendationFromScore(60)).toBe("no");
  });

  it("upgrades selective to yes at 78+ when no hard gates", () => {
    expect(resolveRecommendation(80, cleanRules())).toBe("yes");
    expect(resolveRecommendation(78, cleanRules())).toBe("yes");
    expect(resolveRecommendation(76, cleanRules())).toBe("selective_yes");
  });

  it("keeps sub-70 viable roles as selective_yes unless research-heavy", () => {
    expect(mapRecommendationFromScore(60)).toBe("no");
    expect(resolveRecommendation(60, cleanRules())).toBe("selective_yes");
    expect(resolveRecommendation(69, cleanRules())).toBe("selective_yes");
    expect(resolveRecommendation(69, { ...cleanRules(), researchHeavyAiRole: true })).toBe("no");
  });

  it("downgrades yes to selective_yes at 80+ when hard constraints exist", () => {
    expect(resolveRecommendation(83, { ...cleanRules(), locationMismatch: true })).toBe("selective_yes");
    expect(recommendationHardConstraints({ ...cleanRules(), locationMismatch: true })).toBe(true);
  });

  it("shortlists only for >=78 and non-terminal status", () => {
    expect(shouldShortlist(79, "to_review")).toBe(true);
    expect(shouldShortlist(90, "rejected")).toBe(false);
    expect(shouldShortlist(77, "to_review")).toBe(false);
  });

  it("maps tracker colors by status + score", () => {
    expect(getTrackerColor("to_review", 82)).toBe("green");
    expect(getTrackerColor("to_review", 60)).toBe("yellow");
    expect(getTrackerColor("applied", 85)).toBe("yellow");
    expect(getTrackerColor("interviewing", 65)).toBe("blue");
    expect(getTrackerColor("assessment", 75)).toBe("blue");
    expect(getTrackerColor("offer", 90)).toBe("blue");
    expect(getTrackerColor("rejected", 90)).toBe("red");
    expect(getTrackerColor("closed", 90)).toBe("red");
  });
});
