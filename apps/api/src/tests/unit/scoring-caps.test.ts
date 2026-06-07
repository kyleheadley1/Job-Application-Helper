import { describe, expect, it } from "vitest";
import {
  applyHardGateCaps,
  finalizeScore,
  hasHardGateNote,
  mapRecommendationFromScore,
  resolveRecommendation,
  sumScoreBreakdown,
} from "../../lib/scoringCaps.js";
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

describe("scoring caps and recommendations", () => {
  it("total equals min(sum, lowest hard-gate cap)", () => {
    const sum = sumScoreBreakdown(highScore());
    const capped = applyHardGateCaps(highScore(), { ...cleanRules(), seniorityOverreach: true });
    expect(sum).toBeGreaterThan(66);
    expect(capped.total).toBe(66);
    expect(capped.stackFit).toBe(highScore().stackFit);
  });

  it("explicit core language caps stackFit and total", () => {
    const capped = applyHardGateCaps(highScore(), {
      ...cleanRules(),
      explicitCoreLanguageMismatch: true,
    });
    expect(capped.stackFit).toBeLessThanOrEqual(11);
    expect(capped.total).toBeLessThanOrEqual(74);
  });

  it("finalizeScore clamps categories to new maxes", () => {
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
    expect(out.levelFit).toBe(20);
    expect(out.functionalOverlap).toBe(15);
    expect(out.total).toBe(100);
  });

  it("maps recommendations from capped total (single table)", () => {
    expect(mapRecommendationFromScore(86)).toBe("yes");
    expect(mapRecommendationFromScore(80)).toBe("yes");
    expect(mapRecommendationFromScore(72)).toBe("selective_yes");
    expect(mapRecommendationFromScore(65)).toBe("no");
  });

  it("resolveRecommendation applies gate nuance at 78–84", () => {
    expect(resolveRecommendation(82, cleanRules(), 8)).toBe("yes");
    expect(resolveRecommendation(82, { ...cleanRules(), locationMismatch: true }, 8)).toBe("selective_yes");
    expect(hasHardGateNote({ ...cleanRules(), locationMismatch: true })).toBe(true);
  });

  it("60–69 requires upside for selective_yes", () => {
    expect(resolveRecommendation(65, cleanRules(), 7)).toBe("no");
    expect(resolveRecommendation(65, cleanRules(), 8)).toBe("selective_yes");
  });

  it("credential-heavy and Go data-infra gap force no", () => {
    expect(resolveRecommendation(90, { ...cleanRules(), credentialHeavyFintechAlgorithm: true }, 9)).toBe("no");
    expect(resolveRecommendation(72, { ...cleanRules(), goDistributedDataInfraCandidateGap: true }, 8)).toBe("no");
  });
});
