import { describe, expect, it } from "vitest";
import {
  clampScoreToCategoryMaxes,
  finalizeScore,
  hasHardGateNote,
  mapRecommendationFromScore,
  resolveRecommendation,
  sumScoreBreakdown,
} from "../../lib/scoringCaps.js";
import { computeCompositeScore, resolveCompositeRecommendation } from "../../lib/compositeScoreModel.js";
import { userProfile } from "../../config/userProfile.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { RuleEvaluation, ScoreBreakdown } from "../../types/scoring.js";

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

const makeJob = (): ExtractedJobData => ({
  company: "TestCo",
  title: "Software Engineer",
  stack: ["TypeScript"],
  requiredSkills: [],
  preferredSkills: [],
  domainTags: [],
  responsibilities: [],
  requirements: [],
  remoteType: "remote",
});

const highScore = (): ScoreBreakdown => ({
  stackFit: 18,
  levelFit: 17,
  domainFit: 9,
  resumeStoryClarity: 9,
  functionalOverlap: 14,
  recruiterFriendliness: 13,
  careerValue: 9,
  total: 0,
});

describe("scoring caps and composite model", () => {
  it("clampScoreToCategoryMaxes fits legacy breakdowns into rubric caps", () => {
    const legacy = clampScoreToCategoryMaxes({
      stackFit: 22,
      levelFit: 14,
      domainFit: 8,
      resumeStoryClarity: 14,
      functionalOverlap: 9,
      recruiterFriendliness: 12,
      careerValue: 8,
      total: 87,
    });
    expect(legacy.stackFit).toBe(20);
    expect(legacy.resumeStoryClarity).toBe(10);
  });

  it("hard gate fires before composite scoring", () => {
    const composite = computeCompositeScore({
      rawScore: highScore(),
      rules: { ...cleanRules(), seniorityOverreach: true },
      extracted: makeJob(),
      profile: userProfile,
    });
    expect(composite.recommendation).toBe("no");
    expect(composite.score.total).toBe(25);
  });

  it("composite final = round(capability × survivability)", () => {
    const composite = computeCompositeScore({
      rawScore: highScore(),
      rules: cleanRules(),
      extracted: makeJob(),
      profile: userProfile,
    });
    expect(composite.score.capability).toBeGreaterThan(0);
    expect(composite.score.survivability).toBeGreaterThanOrEqual(0.3);
    expect(composite.score.total).toBe(
      Math.round((composite.score.capability ?? 0) * (composite.score.survivability ?? 0)),
    );
  });

  it("finalizeScore without context clamps categories only", () => {
    const out = finalizeScore(
      {
        stackFit: 99,
        levelFit: 99,
        domainFit: 99,
        resumeStoryClarity: 99,
        functionalOverlap: 99,
        recruiterFriendliness: 99,
        careerValue: 99,
        total: 0,
      },
      cleanRules(),
    );
    expect(out.stackFit).toBe(20);
    expect(out.functionalOverlap).toBe(15);
    expect(out.total).toBe(sumScoreBreakdown(out));
  });

  it("maps recommendations from composite final score heuristics", () => {
    expect(mapRecommendationFromScore(75)).toBe("apply_cold");
    expect(mapRecommendationFromScore(55)).toBe("referral_gated");
    expect(mapRecommendationFromScore(40)).toBe("stretch_signal");
    expect(mapRecommendationFromScore(25)).toBe("skip");
  });

  it("2x2 matrix resolves referral_gated for strong capability + low survivability", () => {
    expect(resolveCompositeRecommendation(78, 0.4)).toBe("referral_gated");
    expect(resolveCompositeRecommendation(78, 0.6)).toBe("apply_cold");
    expect(resolveRecommendation(32, cleanRules(), 8, 78, 0.4)).toBe("referral_gated");
  });

  it("hasHardGateNote detects gate flags", () => {
    expect(hasHardGateNote({ ...cleanRules(), locationMismatch: true })).toBe(true);
    expect(hasHardGateNote(cleanRules())).toBe(false);
  });
});
