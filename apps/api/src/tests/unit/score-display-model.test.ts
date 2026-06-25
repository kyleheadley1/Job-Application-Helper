import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { CAPABILITY_MAXES } from "../../config/capabilitySurvivabilityPolicy.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import {
  assertCapabilityBreakdownMatchesHeadline,
  assertSurvivabilityRowsMatchMultiplier,
  buildHardGatesList,
  buildScoreDisplay,
  buildSurvivabilityPenalties,
  buildSurvivabilityRows,
  computeCapabilityBreakdown,
} from "../../lib/scoreDisplayModel.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { ScoreBreakdown } from "../../types/scoring.js";

const BASE_JOB: ExtractedJobData = {
  company: "Acme Health",
  title: "Software Engineer",
  location: "Remote",
  remoteType: "remote",
  stack: ["TypeScript", "Node.js"],
  requiredSkills: ["TypeScript"],
  preferredSkills: [],
  domainTags: ["healthcare"],
  responsibilities: ["Build APIs"],
  requirements: ["BS in Computer Science or equivalent"],
  degreeRequirement: { level: "required", raw: "BS in CS" },
  rawText: "Software Engineer at structured healthcare company. BS required.",
};

const RAW_SCORE: ScoreBreakdown = {
  stackFit: 16,
  levelFit: 14,
  domainFit: 6,
  resumeStoryClarity: 6,
  functionalOverlap: 11,
  recruiterFriendliness: 10,
  careerValue: 7,
  total: 0,
};

const compositeFixture = () => {
  const rules = evaluateRules(BASE_JOB, userProfile, { activeResumeType: "SWE" });
  const clamped = applyScoringClampLayer({
    score: RAW_SCORE,
    extracted: BASE_JOB,
    rules,
  });
  const composite = computeCompositeScore({
    rawScore: clamped.score,
    rules: clamped.rules,
    extracted: BASE_JOB,
    profile: userProfile,
    resumeText: "TypeScript engineer at startup",
  });
  return { composite, rules: clamped.rules };
};

describe("scoreDisplayModel", () => {
  it("capability breakdown components sum to capability headline", () => {
    const { composite } = compositeFixture();
    const breakdown = computeCapabilityBreakdown(composite.score);
    expect(breakdown.stackFit).toBeLessThanOrEqual(CAPABILITY_MAXES.stackFit);
    expect(breakdown.levelFit).toBeLessThanOrEqual(CAPABILITY_MAXES.levelFit);
    expect(breakdown.functionalOverlap).toBeLessThanOrEqual(CAPABILITY_MAXES.functionalOverlap);
    assertCapabilityBreakdownMatchesHeadline(composite.score.capability ?? 0, breakdown);
    expect(
      breakdown.stackFit + breakdown.levelFit + breakdown.functionalOverlap,
    ).toBe(composite.score.capability);
  });

  it("survivability rows reproduce survivability multiplier within rounding", () => {
    const { composite, rules } = compositeFixture();
    const breakdown = composite.score.survivabilityBreakdown;
    expect(breakdown).toBeDefined();
    const rows = buildSurvivabilityRows(breakdown!, rules);
    expect(rows[0]!.score).toBeLessThanOrEqual(rows[rows.length - 1]!.score);
    assertSurvivabilityRowsMatchMultiplier(breakdown!, rows);
  });

  it("degree gate flag is a survivability penalty, not a hard gate", () => {
    const rules = {
      ...evaluateRules(BASE_JOB, userProfile, { activeResumeType: "SWE" }),
      explicitDegreeRisk: true,
      matureStructuredEmployer: true,
    };
    const clamped = applyScoringClampLayer({
      score: RAW_SCORE,
      extracted: BASE_JOB,
      rules,
    });
    const composite = computeCompositeScore({
      rawScore: clamped.score,
      rules: clamped.rules,
      extracted: BASE_JOB,
      profile: userProfile,
      resumeText: "TypeScript engineer at startup",
    });
    const display = buildScoreDisplay({
      score: composite.score,
      rules: clamped.rules,
      extracted: BASE_JOB,
      recommendation: composite.recommendation,
    });
    expect(display).toBeDefined();
    expect(display!.hardGates).toEqual([]);
    expect(
      display!.survivabilityPenalties.some((p) =>
        p.message.includes("Degree gate at structured employer"),
      ),
    ).toBe(true);
    expect(
      buildHardGatesList(clamped.rules, BASE_JOB, composite.recommendation),
    ).toEqual([]);
  });

  it("seniority overreach is a hard gate when it fires", () => {
    const job: ExtractedJobData = {
      ...BASE_JOB,
      title: "Staff Software Engineer",
      seniority: "Staff",
      requirements: ["10+ years experience"],
      rawText: "Staff engineer with 10+ years. Must be senior/staff level.",
    };
    const rules = evaluateRules(job, userProfile, { activeResumeType: "SWE" });
    expect(rules.seniorityOverreach).toBe(true);
    const composite = computeCompositeScore({
      rawScore: RAW_SCORE,
      rules,
      extracted: job,
      profile: userProfile,
    });
    expect(composite.recommendation).toBe("no");
    const display = buildScoreDisplay({
      score: composite.score,
      rules,
      extracted: job,
      recommendation: composite.recommendation,
      hardGateReasons: composite.hardGateReasons,
    });
    expect(display!.hardGates.length).toBeGreaterThan(0);
    expect(
      buildSurvivabilityPenalties(rules, job).some((p) => p.message.includes("Seniority overreach")),
    ).toBe(false);
  });

  it("buildScoreDisplay surfaces referral as secondary under band headline", () => {
    const { composite, rules } = compositeFixture();
    const display = buildScoreDisplay({
      score: composite.score,
      rules,
      extracted: BASE_JOB,
      recommendation: "referral_gated",
      referralPathwayAvailable: true,
      referralPathwayNotes: "Connection via Codesmith",
    });
    expect(display!.actionLine).toMatch(/tailored|Strong shot|Worth applying/i);
    expect(display!.referralSubtext).toMatch(/Codesmith/i);
    expect(display!.actionLine).not.toMatch(/Codesmith/i);
    expect(display!.scoreDerivation).toBeTruthy();
  });
});
