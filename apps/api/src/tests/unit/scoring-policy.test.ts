import { describe, expect, it } from "vitest";
import { mapRecommendationFromScore } from "../../agents/jobAgent/scoring.js";
import { getTrackerColor, shouldShortlist } from "../../config/scoringPolicy.js";

describe("scoring policy behavior", () => {
  it("maps recommendations by score band", () => {
    expect(mapRecommendationFromScore(83)).toBe("yes");
    expect(mapRecommendationFromScore(74)).toBe("yes");
    expect(mapRecommendationFromScore(72)).toBe("selective_yes");
    expect(mapRecommendationFromScore(66)).toBe("selective_yes");
    expect(mapRecommendationFromScore(60)).toBe("no");
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
