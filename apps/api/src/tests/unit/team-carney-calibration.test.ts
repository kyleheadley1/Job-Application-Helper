import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { DEGREE_DOCK_BY_TIER } from "../../lib/degreeGap.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import {
  buildScoreDisplay,
  buildSurvivabilityPenalties,
} from "../../lib/scoreDisplayModel.js";
import type { ScoreBreakdown } from "../../types/scoring.js";
import { TEAM_CARNEY_JOB } from "./degree-equivalency.test.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

/** Stored category scores approximating a strong product fit before degree mishandling. */
const TEAM_CARNEY_RAW: ScoreBreakdown = {
  stackFit: 18,
  levelFit: 16,
  domainFit: 8,
  resumeStoryClarity: 9,
  functionalOverlap: 15,
  recruiterFriendliness: 11,
  careerValue: 8,
  total: 0,
};

describe("Team Carney degree equivalency calibration", () => {
  it("does not apply structured-employer degree penalty when equivalency is satisfied", () => {
    const rules = evaluateRules(TEAM_CARNEY_JOB, userProfile, { activeResumeType: "SWE" });
    expect(rules.degreeEquivalencySatisfied).toBe(true);
    expect(rules.explicitDegreeRisk).toBe(false);

    const clamped = applyScoringClampLayer({
      score: TEAM_CARNEY_RAW,
      extracted: TEAM_CARNEY_JOB,
      rules,
    });

    expect(
      clamped.rules.hardRuleFlags?.some((f) => f.id === "degreeGateStructuredEmployer"),
    ).toBe(false);

    const composite = computeCompositeScore({
      rawScore: clamped.score,
      rules: clamped.rules,
      extracted: TEAM_CARNEY_JOB,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });

    const degreePenalty = buildSurvivabilityPenalties(clamped.rules, TEAM_CARNEY_JOB).find((p) =>
      /degree gate at structured employer/i.test(p.message),
    );
    expect(degreePenalty).toBeUndefined();

    const display = buildScoreDisplay({
      score: composite.score,
      rules: clamped.rules,
      extracted: TEAM_CARNEY_JOB,
      recommendation: composite.recommendation,
    });

    expect(display?.gapDock ?? 0).toBeLessThan(DEGREE_DOCK_BY_TIER.high);
    expect(display?.survAdjustment ?? 0).toBeGreaterThan(-12);
    expect(display?.final ?? 0).toBeGreaterThanOrEqual(76);
    expect(display?.final ?? 0).toBeLessThanOrEqual(82);
  });
});
