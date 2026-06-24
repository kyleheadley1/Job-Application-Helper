import { describe, expect, it } from "vitest";
import {
  mapRecommendationFromScore,
  resolveRecommendation,
  hasHardGateNote,
} from "../../lib/scoringCaps.js";
import { resolveCompositeRecommendation } from "../../lib/compositeScoreModel.js";
import type { RuleEvaluation } from "../../types/scoring.js";
import { getTrackerColor, shouldShortlist, SCORE_CATEGORY_MAXES } from "../../config/scoringPolicy.js";

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

  it("shortlists for composite finals >= 50 on to_review", () => {
    expect(shouldShortlist(55, "to_review")).toBe(true);
    expect(shouldShortlist(90, "rejected")).toBe(false);
    expect(shouldShortlist(40, "to_review")).toBe(false);
  });

  it("maps tracker colors by status + score", () => {
    expect(getTrackerColor("to_review", 55)).toBe("green");
    expect(getTrackerColor("to_review", 30)).toBe("yellow");
    expect(getTrackerColor("interviewing", 65)).toBe("blue");
    expect(getTrackerColor("rejected", 90)).toBe("red");
  });
});
