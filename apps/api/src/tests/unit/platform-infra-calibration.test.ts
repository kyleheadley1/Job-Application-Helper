import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { evaluateDifferentiatorCoverage } from "../../lib/differentiatorCoverage.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import {
  classifyPlatformInfraRole,
  classifyFrontendPrimaryRole,
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

describe("platform/infra role — StubHub Core Compute", () => {
  it("classifies StubHub Core Compute as platform/infra", () => {
    const job = loadCalibrationFixture("stubHubCoreCompute").extracted;
    expect(classifyPlatformInfraRole(job).detected).toBe(true);
    expect(classifyFrontendPrimaryRole(job).detected).toBe(false);
  });

  it("downgrades differentiator from strong; caps stackFit/functionalOverlap high-teens", () => {
    const fixture = loadCalibrationFixture("stubHubCoreCompute");
    const job = fixture.extracted;
    const coverage = evaluateDifferentiatorCoverage(job);
    expect(coverage.tier).not.toBe("strong");
    expect(coverage.note).toMatch(/platform\/infra/i);

    const rules = evaluateRules(job, userProfile, { activeResumeType: "SWE" });
    const clamped = applyScoringClampLayer({
      score: { ...fixture.storedCategoryScores, total: 0 },
      extracted: job,
      rules,
    });
    expect(clamped.rules.platformInfraRole).toBe(true);

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

    expect(composite.score.capabilityBreakdown?.stackFit ?? 99).toBeLessThanOrEqual(18);
    expect(composite.score.capabilityBreakdown?.functionalOverlap ?? 99).toBeLessThanOrEqual(18);
    expect(composite.score.capability).toBeLessThanOrEqual(65);
    expect(display?.differentiatorCoverageNote).toMatch(/platform\/infra|other engineers/i);
    expect(composite.score.roleFunctionCapNote).toMatch(/platform\/infra/i);
  });

  it("KEY GUARD: Cherry Hill / Traba stay strong and uncapped", () => {
    const cherry = scoreCalibrationAnchor("cherryHill");
    expect(classifyPlatformInfraRole(cherry.fixture.extracted).detected).toBe(false);
    expect(cherry.differentiatorCoverage.tier).toBe("strong");
    expect(cherry.score.capability).toBeGreaterThanOrEqual(84);

    const traba = scoreCalibrationAnchor("trabaAppliedAi");
    expect(classifyPlatformInfraRole(traba.fixture.extracted).detected).toBe(false);
    expect(traba.differentiatorCoverage.tier).toBe("strong");
  });

  it("does not classify product backend/fullstack that merely mentions AWS", () => {
    const productAws: ExtractedJobData = {
      company: "News Multimodal",
      title: "Software Engineer",
      stack: ["TypeScript", "React", "Node.js", "AWS"],
      responsibilities: [
        "Ship user-facing product features for readers",
        "Build full-stack TypeScript features with React and Node APIs",
      ],
      requirements: ["TypeScript", "React", "AWS S3 for media"],
      rawText:
        "Software Engineer. Ship user-facing product features for readers. Full-stack TypeScript/React/Node. AWS S3 for media.",
    };
    expect(classifyPlatformInfraRole(productAws).detected).toBe(false);
    expect(evaluateDifferentiatorCoverage(productAws).tier).toBe("strong");
  });
});
