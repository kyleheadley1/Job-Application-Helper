import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import {
  evaluateDifferentiatorCoverage,
  jobDescriptionBlob,
  countDifferentiatorTags,
} from "../../lib/differentiatorCoverage.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import {
  classifyFrontendPrimaryRole,
  classifyRoleFunction,
} from "../../lib/roleFunctionClassifier.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import {
  loadCalibrationFixture,
  scoreCalibrationAnchor,
} from "../fixtures/calibrationAnchors.js";
import type { ExtractedJobData } from "../../types/job.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

describe("frontend-primary role — backend edge benched", () => {
  it("diagnosis: API-consumption tokens alone register as strong on naive matcher", () => {
    const naive: ExtractedJobData = {
      company: "Precisely",
      title: "Associate Software Engineer, Frontend",
      stack: ["React", "TypeScript", "REST API", "backend"],
      requirements: ["API integration with backend REST APIs"],
      responsibilities: ["Build UI components", "Integrate with backend REST APIs"],
      rawText:
        "Associate Software Engineer, Frontend. Build UI. API integration with backend REST APIs.",
    };
    // Without frontendPrimary filter, token presence would yield strong.
    const unfiltered = countDifferentiatorTags(jobDescriptionBlob(naive), {
      frontendPrimaryRole: false,
    });
    expect(unfiltered.matchedTags).toEqual(
      expect.arrayContaining(["rest api", "backend", "api"]),
    );
    expect(unfiltered.count).toBeGreaterThanOrEqual(3);

    expect(classifyFrontendPrimaryRole(naive).detected).toBe(true);
    const filtered = evaluateDifferentiatorCoverage(naive);
    expect(filtered.tier).not.toBe("strong");
    expect(filtered.note).toMatch(/backend\/API edge benched/i);
  });

  it("Precisely: FRONTEND-PRIMARY; capability ~75-76; equivalency intact; apply band", () => {
    const fixture = loadCalibrationFixture("preciselyAssociateSweFrontend");
    const job = fixture.extracted;

    expect(classifyFrontendPrimaryRole(job).detected).toBe(true);
    expect(classifyRoleFunction(job).detected).toBe(false);

    const coverage = evaluateDifferentiatorCoverage(job);
    expect(coverage.tier).not.toBe("strong");
    expect(coverage.note).toMatch(/backend\/API edge benched/i);
    expect(coverage.matchedTags).not.toEqual(
      expect.arrayContaining(["rest api", "backend", "api"]),
    );

    const rules = evaluateRules(job, userProfile, { activeResumeType: "SWE" });
    expect(rules.degreeHasEquivalencyClause).toBe(true);
    expect(rules.degreeEquivalencySatisfied).toBe(true);
    expect(rules.explicitDegreeRisk).toBe(false);

    const clamped = applyScoringClampLayer({
      score: { ...fixture.storedCategoryScores, total: 0 },
      extracted: job,
      rules,
    });
    expect(clamped.rules.frontendPrimaryRole).toBe(true);
    expect(
      clamped.rules.hardRuleFlags?.some((f) => f.id === "degreeGateStructuredEmployer"),
    ).toBe(false);

    const composite = computeCompositeScore({
      rawScore: clamped.score,
      rules: clamped.rules,
      extracted: job,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });
    const display = buildScoreDisplay({
      score: composite.score,
      rules: clamped.rules,
      extracted: job,
      recommendation: composite.recommendation,
    });

    expect(composite.score.capability).toBeGreaterThanOrEqual(74);
    expect(composite.score.capability).toBeLessThanOrEqual(77);
    expect(composite.score.survivabilityBreakdown?.credentialSignal ?? 0).toBeGreaterThanOrEqual(
      0.7,
    );
    expect(display?.final ?? 0).toBeGreaterThanOrEqual(74);
    expect(display?.final ?? 0).toBeLessThanOrEqual(78);
    expect(display?.scoreBand).toBe("apply");
    expect(display?.differentiatorCoverageNote).toMatch(/backend\/API edge benched/i);
    expect(composite.score.roleFunctionCapNote).toMatch(/frontend-primary/i);
  });

  it("Fubo + Picnic: frontend-primary cap; differentiator not strong", () => {
    const fubo = loadCalibrationFixture("fuboFrontend").extracted;
    expect(classifyFrontendPrimaryRole(fubo).detected).toBe(true);
    expect(evaluateDifferentiatorCoverage(fubo).tier).not.toBe("strong");

    const picnic = loadCalibrationFixture("picnicFrontend").extracted;
    expect(classifyFrontendPrimaryRole(picnic).detected).toBe(true);
    const picnicCoverage = evaluateDifferentiatorCoverage(picnic);
    expect(picnicCoverage.tier).not.toBe("strong");
    expect(picnicCoverage.note).toMatch(/backend\/API edge benched/i);
  });

  it("KEY GUARD: Cherry Hill / Traba full-stack stay strong + uncapped", () => {
    const cherry = scoreCalibrationAnchor("cherryHill");
    expect(classifyFrontendPrimaryRole(cherry.fixture.extracted).detected).toBe(false);
    expect(cherry.differentiatorCoverage.tier).toBe("strong");
    expect(cherry.score.capability).toBeGreaterThanOrEqual(84);

    const traba = scoreCalibrationAnchor("trabaAppliedAi");
    expect(classifyFrontendPrimaryRole(traba.fixture.extracted).detected).toBe(false);
    expect(traba.differentiatorCoverage.tier).toBe("strong");
    expect(traba.score.capability).toBeGreaterThanOrEqual(80);
  });

  it("Pathpoint adjacent-role cap remains independent of frontend-primary", () => {
    const pathpoint: ExtractedJobData = {
      company: "Pathpoint",
      title: "Technical Implementation Analyst",
      location: "Remote",
      remoteType: "remote",
      stack: ["REST API", "Salesforce"],
      responsibilities: [
        "Author requirements docs and QA test plans",
        "Validate REST API integrations during UAT",
      ],
      requirements: ["Requirements documentation and QA test plans"],
      rawText:
        "Technical Implementation Analyst. Requirements docs, QA test plans. Validate REST API integrations during UAT.",
    };
    expect(classifyRoleFunction(pathpoint).detected).toBe(true);
    expect(classifyFrontendPrimaryRole(pathpoint).detected).toBe(false);
  });
});
