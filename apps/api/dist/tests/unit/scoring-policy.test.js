import { describe, expect, it } from "vitest";
import { mapRecommendationFromScore } from "../../agents/jobAgent/scoring.js";
import { shouldShortlist } from "../../config/scoringPolicy.js";
describe("scoring policy behavior", () => {
    it("maps recommendations by score band", () => {
        expect(mapRecommendationFromScore(83)).toBe("yes");
        expect(mapRecommendationFromScore(74)).toBe("selective_yes");
        expect(mapRecommendationFromScore(66)).toBe("selective_yes");
        expect(mapRecommendationFromScore(60)).toBe("no");
    });
    it("shortlists only for >=78 and non-terminal status", () => {
        expect(shouldShortlist(79, "to_review")).toBe(true);
        expect(shouldShortlist(90, "rejected")).toBe(false);
        expect(shouldShortlist(77, "to_review")).toBe(false);
    });
});
