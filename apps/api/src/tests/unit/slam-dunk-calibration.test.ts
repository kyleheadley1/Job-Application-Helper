import { describe, expect, it } from "vitest";
import { userProfile } from "../../config/userProfile.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import {
  computeWorthTailoring,
  resolveBandHeadline,
  resolveScoreBand,
} from "../../lib/compositeScoring.js";
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
  requirements: ["TypeScript and React experience", "Node/Express backend APIs"],
  rawText: "Full-stack TypeScript/React/Node role with Express backend APIs, RAG/LLM workflows, and webhooks. Remote.",
};

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

/** Apply band with capability below tailor bar → If quick. */
const IF_QUICK_SCORE: ScoreBreakdown = {
  stackFit: 13,
  levelFit: 13,
  domainFit: 5,
  resumeStoryClarity: 6,
  functionalOverlap: 11,
  recruiterFriendliness: 8,
  careerValue: 6,
  total: 0,
};

describe("slam-dunk calibration anchor", () => {
  it("high capability + clean survivability → Strong yes", () => {
    const composite = computeCompositeScore({
      rawScore: SLAM_DUNK_SCORE,
      rules: cleanRules(),
      extracted: SLAM_DUNK_JOB,
      profile: userProfile,
      resumeText: "TypeScript React Node full-stack engineer",
    });

    expect(composite.score.capability).toBeGreaterThanOrEqual(85);
    expect(composite.score.total).toBeGreaterThanOrEqual(85);
    expect(composite.scoreBand).toBe("strong_apply");

    const display = buildScoreDisplay({
      score: composite.score,
      rules: cleanRules(),
      extracted: SLAM_DUNK_JOB,
      recommendation: composite.recommendation,
    });

    expect(display?.bandHeadline).toBe("Strong yes");
    expect(display?.worthTailoring).toBe(true);
  });
});

describe("if-quick apply-edge fixture", () => {
  it("apply band but capability < 70 → If quick, not Yes", () => {
    const composite = computeCompositeScore({
      rawScore: IF_QUICK_SCORE,
      rules: cleanRules(),
      extracted: SLAM_DUNK_JOB,
      profile: userProfile,
      resumeText: "Junior TypeScript developer",
    });

    expect(composite.score.capability).toBeLessThan(70);
    expect(composite.score.total).toBeGreaterThanOrEqual(58);
    expect(composite.scoreBand).toBe("apply");
    expect(computeWorthTailoring(composite.score.total, composite.scoreBand)).toBe(false);

    const display = buildScoreDisplay({
      score: composite.score,
      rules: cleanRules(),
      extracted: SLAM_DUNK_JOB,
      recommendation: composite.recommendation,
    });

    expect(display?.bandHeadline).toBe("If quick");
    expect(display?.worthTailoring).toBe(false);
  });
});

describe("band thresholds", () => {
  it("pins cutoffs: 84→apply, 85→strong_apply, 57→skip, 58→apply", () => {
    expect(resolveScoreBand(84)).toBe("apply");
    expect(resolveScoreBand(85)).toBe("strong_apply");
    expect(resolveScoreBand(57)).toBe("skip");
    expect(resolveScoreBand(58)).toBe("apply");
    expect(resolveBandHeadline("apply", 72)).toBe("Yes");
    expect(resolveBandHeadline("apply", 65)).toBe("If quick");
  });
});

describe("tailor decoupling", () => {
  it("final 72 / apply band → worthTailoring true; final 55 / skip → false", () => {
    expect(computeWorthTailoring(72, "apply")).toBe(true);
    expect(computeWorthTailoring(55, "apply")).toBe(false);
    expect(computeWorthTailoring(72, "skip")).toBe(false);
    expect(resolveScoreBand(72)).toBe("apply");
    expect(resolveBandHeadline("apply", 72)).toBe("Yes");
  });
});
