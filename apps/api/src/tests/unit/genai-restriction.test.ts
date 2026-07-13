import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import {
  GENAI_RESTRICTION_WARNING,
  jdProhibitsGenAI,
} from "../../lib/genAiRestriction.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import { loadCalibrationFixture } from "../fixtures/calibrationAnchors.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

describe("jdProhibitsGenAI detector", () => {
  it("NYT News Multimodal triggers applicant GenAI restriction", () => {
    const job = loadCalibrationFixture("nytNewsMultimodal").extracted;
    expect(jdProhibitsGenAI(job)).toBe(true);
    const rules = evaluateRules(job, userProfile, { activeResumeType: "SWE" });
    expect(rules.jdProhibitsGenAI).toBe(true);
  });

  it("NYT Content Data Products triggers applicant GenAI restriction", () => {
    const job = loadCalibrationFixture("nytContentDataProducts").extracted;
    expect(jdProhibitsGenAI(job)).toBe(true);
  });

  it("NYT AI Platforms & Products does NOT trigger (product-AI control)", () => {
    const job = loadCalibrationFixture("nytAiPlatformsProducts").extracted;
    expect(jdProhibitsGenAI(job)).toBe(false);
    const rules = evaluateRules(job, userProfile, { activeResumeType: "SWE" });
    expect(rules.jdProhibitsGenAI).toBeFalsy();
  });

  it("surfaces genAiRestrictionWarning on score display without changing score math", () => {
    const fixture = loadCalibrationFixture("nytNewsMultimodal");
    const rules = evaluateRules(fixture.extracted, userProfile, { activeResumeType: "SWE" });
    const clamped = applyScoringClampLayer({
      score: { ...fixture.storedCategoryScores, total: 0 },
      extracted: fixture.extracted,
      rules,
    });
    const composite = computeCompositeScore({
      rawScore: clamped.score,
      rules: clamped.rules,
      extracted: fixture.extracted,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });
    const display = buildScoreDisplay({
      score: composite.score,
      rules: clamped.rules,
      extracted: fixture.extracted,
      recommendation: composite.recommendation,
    });
    expect(display?.genAiRestrictionWarning).toBe(GENAI_RESTRICTION_WARNING);
  });
});
