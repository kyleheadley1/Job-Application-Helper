import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import {
  candidateSatisfiesDegreeEquivalency,
  jdHasDegreeEquivalencyClause,
  profileHasEquivalentWorkExperience,
} from "../../lib/degreeEquivalency.js";
import { DEGREE_DOCK_BY_TIER, resolveDegreeGapTier } from "../../lib/degreeGap.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import {
  buildScoreDisplay,
  buildSurvivabilityPenalties,
} from "../../lib/scoreDisplayModel.js";
import { loadCalibrationFixture } from "../fixtures/calibrationAnchors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

const FIXTURE = loadCalibrationFixture("preciselyAssociateSweFrontend");
const JOB = FIXTURE.extracted;
const DEGREE_RAW = JOB.degreeRequirement?.raw ?? "";

describe("Precisely equivalent-work-experience clause", () => {
  it("detects Precisely-style equivalency phrasings", () => {
    expect(jdHasDegreeEquivalencyClause(JOB.rawText ?? "", "required", DEGREE_RAW)).toBe(true);
    expect(
      jdHasDegreeEquivalencyClause(
        "Equivalent experience will be accepted in place of the degree requirement.",
        "required",
        "",
      ),
    ).toBe(true);
    expect(
      jdHasDegreeEquivalencyClause(
        "Work experience accepted in lieu of education.",
        "required",
        "",
      ),
    ).toBe(true);
  });

  it("satisfies equivalency via Codesmith + shipped work", () => {
    expect(profileHasEquivalentWorkExperience(userProfile, SWE_RESUME)).toBe(true);
    expect(
      candidateSatisfiesDegreeEquivalency(
        userProfile,
        JOB.rawText ?? "",
        "required",
        DEGREE_RAW,
        SWE_RESUME,
      ),
    ).toBe(true);
  });

  it("suppresses -14 degree gate and lifts credentialSignal into the 70s", () => {
    const rules = evaluateRules(JOB, userProfile, { activeResumeType: "SWE" });
    expect(rules.degreeHasEquivalencyClause).toBe(true);
    expect(rules.degreeEquivalencySatisfied).toBe(true);
    expect(rules.explicitDegreeRisk).toBe(false);
    expect(resolveDegreeGapTier(rules, userProfile)).toBe("none");

    const clamped = applyScoringClampLayer({
      score: { ...FIXTURE.storedCategoryScores, total: 0 },
      extracted: JOB,
      rules,
    });

    expect(
      clamped.rules.hardRuleFlags?.some((f) => f.id === "degreeGateStructuredEmployer"),
    ).toBe(false);

    const composite = computeCompositeScore({
      rawScore: clamped.score,
      rules: clamped.rules,
      extracted: JOB,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });

    const degreePenalty = buildSurvivabilityPenalties(clamped.rules, JOB, userProfile).find((p) =>
      /degree gate at structured employer/i.test(p.message),
    );
    expect(degreePenalty).toBeUndefined();

    const display = buildScoreDisplay({
      score: composite.score,
      rules: clamped.rules,
      extracted: JOB,
      recommendation: composite.recommendation,
    });

    expect(display?.gapDock ?? 0).toBeLessThan(DEGREE_DOCK_BY_TIER.high);
    expect(display?.gapDock ?? 0).toBeLessThanOrEqual(DEGREE_DOCK_BY_TIER.soft);
    expect(composite.score.survivabilityBreakdown?.credentialSignal ?? 0).toBeGreaterThanOrEqual(
      0.55,
    );

    const credentialRow = display?.survivabilityRows.find((r) => r.key === "credentialSignal");
    expect(credentialRow?.leverLabel).not.toMatch(/NONE — external route only/i);

    expect(display?.final ?? 0).toBeGreaterThanOrEqual(70);
    expect(display?.final ?? 0).toBeLessThanOrEqual(78);
  });

  it("does not treat IBM hard degree gate as equivalency", () => {
    const ibm = loadCalibrationFixture("ibmDegreeGate").extracted;
    expect(
      jdHasDegreeEquivalencyClause(
        ibm.rawText ?? "",
        ibm.degreeRequirement?.level,
        ibm.degreeRequirement?.raw ?? "",
      ),
    ).toBe(false);
    const rules = evaluateRules(ibm, userProfile, { activeResumeType: "SWE" });
    expect(rules.degreeHasEquivalencyClause).toBeFalsy();
    expect(rules.explicitDegreeRisk).toBe(true);
  });
});
