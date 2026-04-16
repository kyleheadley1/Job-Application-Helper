import { describe, expect, it } from "vitest";
import { getTrackerColor, scoringPolicy } from "../config/scoringPolicy.js";
describe("tracker logic", () => {
    it("maps status colors correctly", () => {
        expect(getTrackerColor("to_review", 82)).toBe("green");
        expect(getTrackerColor("interviewing", 70)).toBe("blue");
        expect(getTrackerColor("rejected", 90)).toBe("red");
    });
    it("shortlist rule requires high score and non-terminal status", () => {
        const qualifies = 80 >= scoringPolicy.shortlist.minScore && !scoringPolicy.shortlist.blockedStatuses.includes("to_review");
        const blocked = 90 >= scoringPolicy.shortlist.minScore && !scoringPolicy.shortlist.blockedStatuses.includes("rejected");
        expect(qualifies).toBe(true);
        expect(blocked).toBe(false);
    });
});
