import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { deterministicResumeSelection } from "../../agents/jobAgent/resumeSelector.js";
import { userProfile } from "../../config/userProfile.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import { scoreImpactMetricQuality } from "../../lib/survivabilityScore.js";
import {
  calibrationSweResumeContexts,
  fixtureToJobRecord,
  loadCalibrationFixture,
} from "../fixtures/calibrationAnchors.js";
import { recomputeStoredJobScore } from "../../lib/recomputeStoredJobScore.js";
import type { ResumeContext } from "../../types/resumeContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESUME_DIR = path.resolve(__dirname, "../../../data/resumes");

const earlyCareerContext = (): ResumeContext => ({
  type: "EARLY_CAREER",
  sourcePath: "early_career_resume.txt",
  sourceKind: "txt",
  loadedAt: new Date().toISOString(),
  rawText: fs.readFileSync(path.join(RESUME_DIR, "early_career_resume.txt"), "utf8"),
  metadata: {
    strongestThemes: [],
    projectEvidence: [],
    keywords: [],
    bestFitRoleShapes: ["early_career"],
    avoidUseCases: [],
    claimSupport: [],
  },
});

describe("resume survivability selection consistency", () => {
  it("confirms regex: ~30% (est.) is not a weak marker; 10+ internal is", () => {
    expect(scoreImpactMetricQuality("~30% (est.)")).toBe(0.52);
    expect(scoreImpactMetricQuality("by ~30% (est.).")).toBe(0.52);
    expect(scoreImpactMetricQuality("used by 10+ internal users")).toBe(0.32);
    expect(scoreImpactMetricQuality(earlyCareerContext().rawText)).toBe(0.52);
    expect(
      scoreImpactMetricQuality(fs.readFileSync(path.join(RESUME_DIR, "swe_resume.txt"), "utf8")),
    ).toBe(0.32);
  });

  it("same recommendedResume → identical impactMetricQuality on triage-style and recompute paths", () => {
    const fixture = loadCalibrationFixture("resumeSurvivabilitySelectionConsistency");
    const resumeContexts = {
      ...calibrationSweResumeContexts(),
      EARLY_CAREER: earlyCareerContext(),
    };

    const earlyText = resumeContexts.EARLY_CAREER!.rawText;
    const sweText = resumeContexts.SWE!.rawText;
    expect(scoreImpactMetricQuality(earlyText)).toBe(0.52);
    expect(scoreImpactMetricQuality(sweText)).toBe(0.32);

    for (const resumeType of ["EARLY_CAREER", "SWE"] as const) {
      const resumeText = resumeContexts[resumeType]!.rawText;
      const expectedImpact = resumeType === "EARLY_CAREER" ? 0.52 : 0.32;

      const rules = evaluateRules(fixture.extracted, userProfile, {
        resumeContexts,
        activeResumeType: resumeType,
      });
      const clamped = applyScoringClampLayer({
        score: { ...fixture.storedCategoryScores, total: 0 },
        extracted: fixture.extracted,
        rules,
      });
      const triageStyle = computeCompositeScore({
        rawScore: clamped.score,
        rules: clamped.rules,
        extracted: fixture.extracted,
        profile: userProfile,
        resumeText,
      });

      const job = fixtureToJobRecord(fixture);
      job.recommendedResume = resumeType;
      job.score = { ...fixture.storedCategoryScores, total: 0 };
      const recomputed = recomputeStoredJobScore({ job, resumeContexts });

      expect(triageStyle.score.survivabilityBreakdown?.impactMetricQuality).toBe(expectedImpact);
      expect(recomputed.score.survivabilityBreakdown?.impactMetricQuality).toBe(expectedImpact);
    }

    // Preview runs before scoring in orchestrator; it must not crash and must return a concrete type.
    const preview = deterministicResumeSelection(fixture.extracted, resumeContexts);
    expect(["SWE", "EARLY_CAREER", "SIE"]).toContain(preview.recommendedResume);
  });
});
