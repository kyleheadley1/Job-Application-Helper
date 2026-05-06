import { describe, expect, it } from "vitest";
import { canConfirmApplied } from "../../services/jobs/jobs.service.js";
import type { ScoreBreakdown } from "../../types/scoring.js";

const scoreTotal = (total: number): ScoreBreakdown =>
  ({
    stackFit: 0,
    levelFit: 0,
    domainFit: 0,
    resumeStoryClarity: 0,
    functionalOverlap: 0,
    recruiterFriendliness: 0,
    careerValue: 0,
    total,
  }) satisfies ScoreBreakdown;

describe("canConfirmApplied", () => {
  it("allows confirm for non-no recommendations", () => {
    expect(canConfirmApplied({ recommendation: "yes", score: scoreTotal(10) })).toBe(true);
    expect(canConfirmApplied({ recommendation: "selective_yes", score: scoreTotal(10) })).toBe(true);
  });

  it("allows confirm for recommendation no at low and high scores", () => {
    expect(canConfirmApplied({ recommendation: "no", score: scoreTotal(51) })).toBe(true);
    expect(canConfirmApplied({ recommendation: "no", score: scoreTotal(50) })).toBe(true);
    expect(canConfirmApplied({ recommendation: "no", score: scoreTotal(32) })).toBe(true);
  });
});
