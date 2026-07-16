import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import {
  COMPOSITE_SCORING,
  SURVIVABILITY_TUNING,
} from "../../config/capabilitySurvivabilityPolicy.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import { derivationHasOnlyLegitimateTerms } from "../../lib/compositeScoring.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { ScoreBreakdown } from "../../types/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

/** Ground truth: applied and rejected — high capability, weak cold-apply odds. */
const DEEPSCRIBE_JOB: ExtractedJobData = {
  company: "DeepScribe",
  title: "Software Engineer, Product",
  location: "Remote (US)",
  remoteType: "remote",
  salary: { min: 100_000, max: 185_000, currency: "USD" },
  stack: ["TypeScript", "React", "Node.js", "OpenAI", "Vector DB"],
  requiredSkills: ["TypeScript", "React", "Node.js"],
  preferredSkills: ["OpenAI API", "vector databases", "healthcare"],
  domainTags: ["healthcare", "AI", "clinical documentation"],
  responsibilities: [
    "Build product features for clinical documentation workflows",
    "Integrate LLM and vector search into provider-facing tools",
    "Ship full-stack TypeScript/React features with Node backends",
  ],
  requirements: [
    "Strong TypeScript and React experience",
    "Experience building production web applications",
    "Comfort with AI/LLM integrations",
  ],
  rawText: `
DeepScribe — Software Engineer, Product
Remote | $100,000 – $185,000
Posted 1 hour ago
Backed by Index Ventures. Well-funded healthcare AI startup.
Build provider-facing clinical documentation products with TypeScript, React, Node.js.
Integrate OpenAI and vector databases. HIPAA-aware healthcare domain.
Software Engineer, Product — broad product engineering role on a remote national team.
  `.trim(),
};

const DEEPSCRIBE_RAW_SCORE: ScoreBreakdown = {
  stackFit: 17,
  levelFit: 15,
  domainFit: 6,
  resumeStoryClarity: 7,
  functionalOverlap: 13,
  recruiterFriendliness: 11,
  careerValue: 8,
  total: 0,
};

describe("DeepScribe calibration anchor", () => {
  it("pool hurt flows only through survivability — no double dock; apply band, not slam-dunk", () => {
    const rules = evaluateRules(DEEPSCRIBE_JOB, userProfile);
    expect(rules.productionBarCompetitivePool).toBe(true);
    expect(rules.matureStructuredEmployer).not.toBe(true);

    const clamped = applyScoringClampLayer({
      score: DEEPSCRIBE_RAW_SCORE,
      extracted: DEEPSCRIBE_JOB,
      rules,
    });
    const composite = computeCompositeScore({
      rawScore: clamped.score,
      rules: clamped.rules,
      extracted: DEEPSCRIBE_JOB,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });

    const display = buildScoreDisplay({
      score: composite.score,
      rules: clamped.rules,
      extracted: DEEPSCRIBE_JOB,
      recommendation: composite.recommendation,
    });

    expect(composite.recommendation).not.toBe("apply_cold");
    expect(composite.score.capability).toBeGreaterThanOrEqual(75);
    expect(composite.score.capability).toBeLessThanOrEqual(84);
    // Weak cold-apply odds: below named production thresholds (never a bare 0.5).
    expect(composite.score.survivability).toBeLessThan(SURVIVABILITY_TUNING.goodOddsThreshold);
    expect(composite.score.survivability).toBeLessThan(COMPOSITE_SCORING.SURV_NEUTRAL);
    expect(composite.score.survivability).toBeGreaterThanOrEqual(SURVIVABILITY_TUNING.floor);
    expect(composite.score.total).toBeGreaterThanOrEqual(65);
    expect(composite.score.total).toBeLessThan(80);
    expect(composite.scoreBand).toBe("apply");
    expect(composite.scoreBand).not.toBe("strong_apply");
    expect(display?.bandHeadline).toBe("Yes");
    expect(display?.scoreDerivation).not.toMatch(/pool/i);
    expect(derivationHasOnlyLegitimateTerms(display!.scoreDerivation)).toBe(true);
  });
});
