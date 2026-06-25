import { describe, expect, it } from "vitest";
import { userProfile } from "../../config/userProfile.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { computeWorthTailoring, resolveScoreBand } from "../../lib/compositeScoring.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
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

const SLAM_DUNK_JOB: ExtractedJobData = {
  company: "Acme",
  title: "Full Stack Engineer",
  location: "Remote",
  remoteType: "remote",
  stack: ["TypeScript", "React", "Node.js"],
  requiredSkills: ["TypeScript", "React", "Node.js"],
  preferredSkills: [],
  domainTags: ["product"],
  responsibilities: ["Ship full-stack TypeScript features"],
  requirements: ["TypeScript and React experience"],
  rawText: "Full-stack TypeScript/React/Node role. Remote.",
};

/** High capability + clean survivability → rare strong_apply band. */
const SLAM_DUNK_SCORE: ScoreBreakdown = {
  stackFit: 18,
  levelFit: 17,
  domainFit: 8,
  resumeStoryClarity: 9,
  functionalOverlap: 14,
  recruiterFriendliness: 12,
  careerValue: 9,
  total: 0,
};

describe("slam-dunk calibration anchor", () => {
  it("high capability + clean survivability → strong_apply, worthTailoring", () => {
    const composite = computeCompositeScore({
      rawScore: SLAM_DUNK_SCORE,
      rules: cleanRules(),
      extracted: SLAM_DUNK_JOB,
      profile: userProfile,
      resumeText: "TypeScript React Node full-stack engineer",
    });

    expect(composite.score.capability).toBeGreaterThanOrEqual(85);
    expect(composite.score.total).toBeGreaterThanOrEqual(80);
    expect(composite.scoreBand).toBe("strong_apply");
    expect(computeWorthTailoring(composite.score.capability ?? 0, composite.scoreBand)).toBe(true);

    const display = buildScoreDisplay({
      score: composite.score,
      rules: cleanRules(),
      extracted: SLAM_DUNK_JOB,
      recommendation: composite.recommendation,
    });

    expect(display?.scoreBand).toBe("strong_apply");
    expect(display?.worthTailoring).toBe(true);
    expect(display?.actionLine).toMatch(/tailored resume|ballpark/i);
  });
});

describe("band thresholds", () => {
  it("pins cutoffs: 79→apply, 80→strong_apply, 57→skip, 58→apply", () => {
    expect(resolveScoreBand(79)).toBe("apply");
    expect(resolveScoreBand(80)).toBe("strong_apply");
    expect(resolveScoreBand(57)).toBe("skip");
    expect(resolveScoreBand(58)).toBe("apply");
  });
});

describe("tailor decoupling", () => {
  it("capability 72 / apply band → worthTailoring true; capability 55 / skip → false", () => {
    expect(computeWorthTailoring(72, "apply")).toBe(true);
    expect(computeWorthTailoring(55, "apply")).toBe(false);
    expect(computeWorthTailoring(72, "skip")).toBe(false);
    expect(resolveScoreBand(72)).toBe("apply");
  });
});
