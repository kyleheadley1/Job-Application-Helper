import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { buildContractCaveat } from "../../lib/contractEmployment.js";
import {
  jdIsDegreePositive,
  profileHasPortfolio,
} from "../../lib/degreeEquivalency.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import { loadCalibrationFixture, scoreCalibrationAnchor } from "../fixtures/calibrationAnchors.js";
import type { ExtractedJobData } from "../../types/job.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

const ITHOS_FIXTURE = loadCalibrationFixture("ithosWellness");
const ITHOS_JOB = ITHOS_FIXTURE.extracted;

describe("Ithos Wellness degree-positive calibration", () => {
  it("detects degree-positive + early-career welcome and uplifts credential signal", () => {
    expect(jdIsDegreePositive(ITHOS_JOB)).toBe(true);
    expect(profileHasPortfolio(userProfile, SWE_RESUME)).toBe(true);

    const rules = evaluateRules(ITHOS_JOB, userProfile, { activeResumeType: "SWE" });
    expect(rules.jdDegreePositive).toBe(true);
    expect(rules.earlyCareerFriendlyRole).toBe(true);

    const clamped = applyScoringClampLayer({
      score: { ...ITHOS_FIXTURE.storedCategoryScores, total: 0 },
      extracted: ITHOS_JOB,
      rules,
    });

    const composite = computeCompositeScore({
      rawScore: clamped.score,
      rules: clamped.rules,
      extracted: ITHOS_JOB,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });

    const display = buildScoreDisplay({
      score: composite.score,
      rules: clamped.rules,
      extracted: ITHOS_JOB,
      recommendation: composite.recommendation,
    });

    const credentialRow = display?.survivabilityRows.find((r) => r.key === "credentialSignal");

    expect(composite.score.survivabilityBreakdown?.credentialSignal).toBeGreaterThanOrEqual(0.53);
    expect(composite.score.survivabilityBreakdown?.credentialSignal).toBeLessThanOrEqual(0.67);
    expect(credentialRow?.lever).toBe("portfolio");
    expect(credentialRow?.leverLabel).toMatch(/portfolio-first/i);
    expect(credentialRow?.bindingness).toBe("favorable");
    expect(display?.degreePositiveNote).toMatch(/Degree-positive JD/i);
    expect(display?.contractCaveat).toBe(buildContractCaveat(ITHOS_JOB));
    expect(display?.referralUrgency).toBe("optional");
    expect(display?.actionLine).toMatch(/Portfolio-first screen/i);
    expect(display?.final).toBeGreaterThanOrEqual(82);
    expect(display?.final).toBeLessThanOrEqual(84);
  });
});

describe("degree-positive regression guards", () => {
  it("IBM hard degree gate is not treated as degree-positive", () => {
    const ibm = loadCalibrationFixture("ibmDegreeGate").extracted;
    expect(jdIsDegreePositive(ibm)).toBe(false);
    const rules = evaluateRules(ibm, userProfile, { activeResumeType: "SWE" });
    expect(rules.explicitDegreeRisk).toBe(true);
    expect(rules.jdDegreePositive).toBeFalsy();
  });

  it("Pathpoint stays role-capped even with degree-positive language", () => {
    const pathpoint: ExtractedJobData = {
      company: "Pathpoint",
      title: "Technical Implementation Analyst",
      location: "Remote",
      remoteType: "remote",
      requirements: [
        "Practical experience matters more than a specific degree",
        "Early-career builders welcome if you can show the work",
        "Requirements documentation and QA test plans",
      ],
      responsibilities: [
        "Author requirements docs and QA test plans",
        "Validate REST API integrations during UAT",
      ],
      rawText:
        "Technical Implementation Analyst. Practical experience matters more than a specific degree. Early-career builders welcome if you can show the work. Requirements docs and QA test plans.",
    };
    const rules = evaluateRules(pathpoint, userProfile, { activeResumeType: "SWE" });
    expect(rules.jdDegreePositive).toBe(true);

    const raw = {
      stackFit: 18,
      levelFit: 16,
      domainFit: 8,
      resumeStoryClarity: 9,
      functionalOverlap: 13,
      recruiterFriendliness: 11,
      careerValue: 8,
      total: 0,
    };
    const clamped = applyScoringClampLayer({ score: raw, extracted: pathpoint, rules });
    expect(clamped.rules.adjacentRoleFunction).toBe(true);

    const composite = computeCompositeScore({
      rawScore: clamped.score,
      rules: clamped.rules,
      extracted: pathpoint,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });
    expect(composite.score.capability).toBeLessThanOrEqual(72);
    expect(composite.score.survivabilityBreakdown?.credentialSignal).toBeGreaterThanOrEqual(0.53);
  });
});

describe("calibration anchor stability", () => {
  it("Cherry Hill anchor unchanged", () => {
    const scored = scoreCalibrationAnchor("cherryHill");
    expect(scored.score.capability).toBeGreaterThanOrEqual(84);
    expect(scored.score.total).toBeGreaterThanOrEqual(82);
    expect(scored.score.total).toBeLessThanOrEqual(86);
  });

  it("Traba anchor unchanged", () => {
    const scored = scoreCalibrationAnchor("trabaAppliedAi");
    expect(scored.score.total).toBeGreaterThanOrEqual(70);
  });
});
