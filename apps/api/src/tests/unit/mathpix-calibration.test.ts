import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { detectSpecializationGap } from "../../lib/capabilityGap.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { ScoreBreakdown } from "../../types/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

const MATHPIX_JOB: ExtractedJobData = {
  company: "Mathpix",
  title: "Backend Software Engineer",
  location: "Remote",
  remoteType: "remote",
  seniority: "mid",
  stack: ["Python", "Flask", "TypeScript", "React"],
  requiredSkills: ["Python", "Flask", "TypeScript"],
  preferredSkills: ["React"],
  domainTags: ["edtech", "product"],
  responsibilities: [
    "Build and maintain Python/Flask backend services",
    "Collaborate on TypeScript/React product features",
    "Design REST APIs for document and math workflows",
  ],
  requirements: [
    "Strong Python and Flask backend experience in production",
    "TypeScript familiarity for full-stack collaboration",
    "Experience shipping web APIs",
  ],
  rawText: `
Mathpix — Backend Software Engineer
Remote
Build production Python/Flask backends and collaborate on TypeScript/React features.
Strong Python and Flask required. Node.js experience is a plus but Python leads the backend.
  `.trim(),
};

/** Rescaled to ~70 capability backbone (strong TS/React fit, Python adjacent). */
const MATHPIX_CAPABILITY_SCORE: ScoreBreakdown = {
  stackFit: 16,
  levelFit: 14,
  domainFit: 6,
  resumeStoryClarity: 8,
  functionalOverlap: 10,
  recruiterFriendliness: 9,
  careerValue: 7,
  total: 0,
};

describe("Mathpix calibration anchor", () => {
  it("moderate Python gap docks lightly; final stays in 60s; headline names reframe lever", () => {
    const rules = evaluateRules(MATHPIX_JOB, userProfile, { activeResumeType: "SWE" });
    const specializationGap = detectSpecializationGap(
      MATHPIX_JOB,
      MATHPIX_CAPABILITY_SCORE,
      SWE_RESUME,
    );
    expect(specializationGap).toBeDefined();
    expect(specializationGap?.name).toMatch(/python/i);
    expect(specializationGap?.severity).toBe("moderate");
    expect(specializationGap?.lever).toBe("resume");
    expect(specializationGap?.dock).toBeGreaterThanOrEqual(4);
    expect(specializationGap?.dock).toBeLessThanOrEqual(8);

    const rulesWithGap = {
      ...rules,
      specializationGap,
      capabilityGap: { kind: "specialization" as const, reason: specializationGap!.name },
      // Moderate Python/Node gap is the dock — not a hard stack gate.
      stackMismatch: false,
      explicitCoreLanguageMismatch: false,
      coreLanguageGap: [],
    };

    const composite = computeCompositeScore({
      rawScore: MATHPIX_CAPABILITY_SCORE,
      rules: rulesWithGap,
      extracted: MATHPIX_JOB,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });

    expect(composite.score.capability).toBeGreaterThanOrEqual(68);
    expect(composite.score.capability).toBeLessThanOrEqual(74);
    expect(composite.score.survivability).toBeGreaterThanOrEqual(0.45);
    expect(composite.score.survivability).toBeLessThanOrEqual(0.55);
    expect(composite.score.total).toBeGreaterThanOrEqual(60);
    expect(composite.score.total).toBeLessThanOrEqual(70);
    expect(composite.score.total).toBeGreaterThan(40);
    expect(["apply_tailor", "apply"]).toContain(composite.scoreBand);

    const display = buildScoreDisplay({
      score: composite.score,
      rules: rulesWithGap,
      extracted: MATHPIX_JOB,
      recommendation: composite.recommendation,
      referralPathwayAvailable: false,
    });

    expect(display?.gapDock).toBeGreaterThanOrEqual(4);
    expect(display?.gapDock).toBeLessThanOrEqual(8);
    expect(display?.survAdjustment).toBeGreaterThanOrEqual(-2);
    expect(display?.survAdjustment).toBeLessThanOrEqual(2);
    expect(display?.dominantLever?.penaltyName).toMatch(/python/i);
    expect(display?.dominantLever?.lever).toBe("resume");
    expect(display?.actionLine).toMatch(/python|flask/i);
    expect(display?.actionLine).toMatch(/node|reframe|resume/i);
    expect(display?.actionLine).not.toMatch(/impact metric quality/i);
    expect(display?.scoreDerivation).toMatch(/= \d+/);
  });
});
