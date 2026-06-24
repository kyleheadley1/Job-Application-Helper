import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { deriveClaimableStackFromText } from "../../lib/claimableStack.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import {
  evaluateDisjunctiveLanguageRequirement,
  extractDisjunctiveLanguageSpans,
} from "../../lib/disjunctiveLanguageRequirement.js";
import { detectReferralPathway } from "../../lib/referralPathway.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { ResumeContextSet } from "../../types/resumeContext.js";
import type { ScoreBreakdown } from "../../types/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

const mockResumeContexts = (): ResumeContextSet => ({
  SWE: {
    type: "SWE",
    sourcePath: "swe_resume.txt",
    sourceKind: "txt",
    loadedAt: new Date().toISOString(),
    rawText: SWE_RESUME,
    metadata: {
      strongestThemes: [],
      projectEvidence: [],
      keywords: [],
      bestFitRoleShapes: ["product_fullstack"],
      avoidUseCases: [],
      claimSupport: [],
    },
  },
});

/** Ground truth: strong stack match but BS hard-required — referral_gated, not skip. */
const ALEDADE_JOB: ExtractedJobData = {
  company: "Aledade",
  title: "Software Engineer I",
  location: "Remote",
  remoteType: "remote",
  seniority: "entry",
  stack: ["Node.js", "TypeScript", "Python"],
  requiredSkills: ["Node.js", "Python"],
  preferredSkills: [],
  domainTags: ["healthcare"],
  degreeRequirement: {
    level: "required",
    raw: "Bachelor's degree (BS/BTech) in Computer Science or related field required",
  },
  responsibilities: [
    "Build healthcare technology products for primary care practices",
    "Ship full-stack features with modern web technologies",
  ],
  requirements: [
    "Bachelor's degree (BS/BTech) required",
    "Expertise in at least 1 server-side web technology (e.g. Node.js, Java, Python, Scala, C#, C++, Go, JVM)",
    "1+ years of software engineering experience or equivalent",
  ],
  rawText: `
Aledade — Software Engineer I
Remote | Entry level | Healthcare technology
Bachelor's degree (BS/BTech) required.
Expertise in at least 1 server-side web technology (e.g. Node.js, Java, Python, Scala, C#, C++, Go, JVM).
We build tools for primary care and value-based care.
  `.trim(),
};

const ALEDADE_RAW_SCORE: ScoreBreakdown = {
  stackFit: 17,
  levelFit: 14,
  domainFit: 6,
  resumeStoryClarity: 7,
  functionalOverlap: 13,
  recruiterFriendliness: 9,
  careerValue: 7,
  total: 0,
};

describe("disjunctive language requirements", () => {
  it("detects Aledade-style at-least-one server-side list and matches Node/Python resume", () => {
    const claimable = deriveClaimableStackFromText(SWE_RESUME);
    const spans = extractDisjunctiveLanguageSpans(ALEDADE_JOB.rawText ?? "");
    expect(spans.length).toBeGreaterThan(0);

    const disjunctive = evaluateDisjunctiveLanguageRequirement(ALEDADE_JOB, claimable);
    expect(disjunctive.satisfied).toBe(true);
    expect(disjunctive.acceptedLabels).toEqual(
      expect.arrayContaining(["Node.js", "Python"]),
    );
  });
});

describe("Aledade calibration anchor", () => {
  it("no false core-language gate; stack match; referral_gated with pathway display-only", () => {
    const rules = evaluateRules(ALEDADE_JOB, userProfile, {
      resumeContexts: mockResumeContexts(),
    });

    expect(rules.explicitCoreLanguageMismatch).toBe(false);
    expect(rules.disjunctiveLanguageRequirementSatisfied).toBe(true);
    expect(rules.stackMismatch).toBe(false);
    expect(rules.coreLanguageGap).toEqual([]);
    expect(rules.explicitDegreeRisk).toBe(true);

    const scoreWithoutPathway = computeCompositeScore({
      rawScore: ALEDADE_RAW_SCORE,
      rules,
      extracted: ALEDADE_JOB,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });

    const pathway = detectReferralPathway({
      profile: userProfile,
      extracted: ALEDADE_JOB,
      resumeText: SWE_RESUME,
    });
    expect(pathway.referralPathwayAvailable).toBe(true);
    expect(pathway.referralPathwayNotes).toContain("Codesmith");

    const clamped = applyScoringClampLayer({
      score: ALEDADE_RAW_SCORE,
      extracted: ALEDADE_JOB,
      rules,
    });
    expect(clamped.score.stackFit).toBeGreaterThanOrEqual(16);

    const composite = computeCompositeScore({
      rawScore: clamped.score,
      rules: clamped.rules,
      extracted: ALEDADE_JOB,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });

    expect(composite.recommendation).toBe("referral_gated");
    expect(composite.recommendation).not.toBe("skip");
    expect(composite.score.capability).toBeGreaterThanOrEqual(75);
    expect(composite.score.capability).toBeLessThanOrEqual(82);

    expect(composite.score.total).toBe(scoreWithoutPathway.score.total);
    expect(composite.score.capability).toBe(scoreWithoutPathway.score.capability);
    expect(composite.score.survivability).toBe(scoreWithoutPathway.score.survivability);
  });
});
