import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import {
  detectSpecializationGap,
} from "../../lib/capabilityGap.js";
import { computeCompositeScore, computeCapabilityBreakdown } from "../../lib/compositeScoreModel.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import { guardCompositeRecommendation } from "../../lib/recommendationGuard.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { ScoreBreakdown } from "../../types/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

const PALANTIR_JOB: ExtractedJobData = {
  company: "Palantir",
  title: "Web Design Engineer",
  location: "New York, NY",
  remoteType: "hybrid",
  seniority: "mid",
  stack: ["TypeScript", "React", "Figma", "CSS"],
  requiredSkills: ["TypeScript", "React", "Figma"],
  preferredSkills: ["Design systems"],
  domainTags: ["product"],
  responsibilities: [
    "Build pixel-perfect UI from Figma designs",
    "Partner with product design on visual design and interaction patterns",
    "Implement and extend the design system",
  ],
  requirements: [
    "Strong TypeScript and React experience",
    "Figma proficiency and a strong design portfolio required",
    "Visual design craft and wireframing ability",
  ],
  rawText: `
Palantir — Web Design Engineer
New York, NY
Get referrals — applications via referral are 3x more likely to get hired.
Unlock job analytics with Simplify+
Build pixel-perfect experiences from Figma. Strong design portfolio required.
TypeScript, React, design systems, visual design.
  `.trim(),
};

const PALANTIR_RAW_SCORE: ScoreBreakdown = {
  stackFit: 17,
  levelFit: 12,
  domainFit: 7,
  resumeStoryClarity: 8,
  functionalOverlap: 11,
  recruiterFriendliness: 9,
  careerValue: 7,
  total: 0,
};

describe("Palantir Web Design Engineer calibration", () => {
  it("central design/Figma gap docks final below Mathpix-class fits; not strong_apply", () => {
    const rules = evaluateRules(PALANTIR_JOB, userProfile, { activeResumeType: "SWE" });
    const clamped = applyScoringClampLayer({
      score: PALANTIR_RAW_SCORE,
      extracted: PALANTIR_JOB,
      rules,
    });

    const specializationGap = detectSpecializationGap(PALANTIR_JOB, clamped.score, SWE_RESUME);
    expect(specializationGap).toBeDefined();
    expect(specializationGap?.name).toMatch(/design\/figma/i);
    expect(specializationGap?.lever).toBe("portfolio");
    expect(specializationGap?.severity).toBe("central");
    expect(specializationGap?.dock).toBeGreaterThanOrEqual(12);

    const rawBreakdown = computeCapabilityBreakdown(clamped.score);
    expect(rawBreakdown.functionalOverlap).toBeGreaterThanOrEqual(24);

    const rulesWithGap = { ...clamped.rules, specializationGap, capabilityGap: undefined };
    const composite = computeCompositeScore({
      rawScore: clamped.score,
      rules: rulesWithGap,
      extracted: PALANTIR_JOB,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });

    expect(composite.score.capability).toBeGreaterThanOrEqual(68);
    expect(composite.score.total).toBeLessThan(65);
    expect(composite.scoreBand).not.toBe("strong_apply");
    expect(["apply", "skip"]).toContain(composite.scoreBand);
    expect(composite.recommendation).toBe("stretch_signal");

    const display = buildScoreDisplay({
      score: composite.score,
      rules: rulesWithGap,
      extracted: PALANTIR_JOB,
      recommendation: composite.recommendation,
      referralPathwayAvailable: false,
    });

    expect(display?.gapDock).toBeGreaterThanOrEqual(12);
    expect(display?.survivabilityPenalties.some((p) => p.message.match(/design\/figma/i))).toBe(
      true,
    );
    expect(display?.dominantLever?.penaltyName).toMatch(/design\/figma/i);
    expect(display?.dominantLever?.lever).toBe("portfolio");
    expect(display?.actionLine).toMatch(/design\/figma/i);
    expect(display?.actionLine).toMatch(/portfolio/i);
    expect(display?.actionLine).not.toMatch(/credential signal/i);
    expect(display?.actionLine).not.toMatch(/referral routes around/i);
    expect(display?.referralSubtext).toBeUndefined();
    expect(display?.scoreDerivation).toMatch(/− \d+/);

    const guarded = guardCompositeRecommendation({
      recommendation: composite.recommendation,
      capability: composite.score.capability ?? 0,
      survivability: composite.score.survivability ?? 0,
      rules: rulesWithGap,
      survivabilityPenalties: display?.survivabilityPenalties ?? [],
      referralPathwayAvailable: false,
    });
    expect(guarded).toBe("stretch_signal");
  });
});
