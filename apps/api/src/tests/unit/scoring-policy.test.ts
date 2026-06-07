import { describe, expect, it } from "vitest";
import {
  mapRecommendationFromScore,
  resolveRecommendation,
  hasHardGateNote,
} from "../../lib/scoringCaps.js";
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
    expect(mapRecommendationFromScore(86)).toBe("yes");
    expect(mapRecommendationFromScore(80)).toBe("yes");
    expect(mapRecommendationFromScore(76)).toBe("selective_yes");
    expect(mapRecommendationFromScore(72)).toBe("selective_yes");
    expect(mapRecommendationFromScore(65)).toBe("no");
    expect(mapRecommendationFromScore(55)).toBe("no");
  });

  it("resolveRecommendation uses single table with gate nuance at 78–84", () => {
    expect(resolveRecommendation(85, cleanRules(), 8)).toBe("yes");
    expect(resolveRecommendation(80, cleanRules(), 8)).toBe("yes");
    expect(resolveRecommendation(80, { ...cleanRules(), locationMismatch: true }, 8)).toBe("selective_yes");
    expect(resolveRecommendation(76, cleanRules(), 8)).toBe("selective_yes");
  });

  it("60–69 stretch band needs careerValue >= 8", () => {
    expect(resolveRecommendation(65, cleanRules(), 7)).toBe("no");
    expect(resolveRecommendation(65, cleanRules(), 8)).toBe("selective_yes");
  });

  it("forces skip for credentialed fintech and Go data-infra gap", () => {
    expect(resolveRecommendation(88, { ...cleanRules(), credentialHeavyFintechAlgorithm: true }, 9)).toBe("no");
    expect(resolveRecommendation(72, { ...cleanRules(), goDistributedDataInfraCandidateGap: true }, 8)).toBe("no");
  });

  it("hasHardGateNote detects gate flags", () => {
    expect(hasHardGateNote({ ...cleanRules(), locationMismatch: true })).toBe(true);
    expect(hasHardGateNote(cleanRules())).toBe(false);
  });

  it("shortlists only for >=78 and non-terminal status", () => {
    expect(shouldShortlist(79, "to_review")).toBe(true);
    expect(shouldShortlist(90, "rejected")).toBe(false);
    expect(shouldShortlist(77, "to_review")).toBe(false);
  });

  it("maps tracker colors by status + score", () => {
    expect(getTrackerColor("to_review", 82)).toBe("green");
    expect(getTrackerColor("to_review", 60)).toBe("yellow");
    expect(getTrackerColor("interviewing", 65)).toBe("blue");
    expect(getTrackerColor("rejected", 90)).toBe("red");
  });
});
