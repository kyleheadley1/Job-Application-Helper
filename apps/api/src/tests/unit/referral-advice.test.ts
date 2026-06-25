import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import {
  computeReferralAddressableShortfall,
  deriveReferralAdvice,
  resolveReferralUrgency,
} from "../../lib/referralAdvice.js";
import { detectReferralPathway } from "../../lib/referralPathway.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import {
  buildScoreDisplay,
  buildSurvivabilityPenalties,
} from "../../lib/scoreDisplayModel.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { ScoreBreakdown } from "../../types/scoring.js";
import type { SurvivabilityBreakdown } from "../../lib/survivabilityScore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

const IBM_JOB: ExtractedJobData = {
  company: "IBM",
  title: "Software Engineer",
  location: "Remote",
  remoteType: "remote",
  seniority: "mid",
  stack: ["Node.js", "TypeScript", "React"],
  requiredSkills: ["Node.js", "TypeScript"],
  preferredSkills: ["React"],
  domainTags: ["product"],
  degreeRequirement: {
    level: "required",
    raw: "Bachelor's degree in Computer Science required",
  },
  responsibilities: ["Build full-stack product features"],
  requirements: [
    "Bachelor's degree in Computer Science or related field required",
    "Strong Node.js and TypeScript experience",
  ],
  rawText: `
IBM — Software Engineer
Remote
Bachelor's degree in Computer Science or related field required.
Strong Node.js and TypeScript experience in production.
Internal referral from Alex Chen welcomed.
  `.trim(),
};

const IBM_RAW_SCORE: ScoreBreakdown = {
  stackFit: 17,
  levelFit: 15,
  domainFit: 7,
  resumeStoryClarity: 8,
  functionalOverlap: 14,
  recruiterFriendliness: 10,
  careerValue: 8,
  total: 0,
};

describe("IBM calibration — referral-blind scoring", () => {
  it("degree full weight; capability ~80; final below prior referral-softened band; strongly_advised referral", () => {
    const rules = evaluateRules(IBM_JOB, userProfile, { activeResumeType: "SWE" });
    expect(rules.explicitDegreeRisk).toBe(true);
    expect(rules.degreeHasEquivalencyClause).toBeFalsy();

    const clamped = applyScoringClampLayer({
      score: IBM_RAW_SCORE,
      extracted: IBM_JOB,
      rules,
    });

    const composite = computeCompositeScore({
      rawScore: clamped.score,
      rules: clamped.rules,
      extracted: IBM_JOB,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });

    const pathway = detectReferralPathway({
      profile: userProfile,
      extracted: IBM_JOB,
      resumeText: SWE_RESUME,
    });
    expect(pathway.referralPathwayAvailable).toBe(true);

    const display = buildScoreDisplay({
      score: composite.score,
      rules: clamped.rules,
      extracted: IBM_JOB,
      recommendation: composite.recommendation,
      referralPathwayAvailable: pathway.referralPathwayAvailable,
      referralPathwayNotes: pathway.referralPathwayNotes,
    });

    expect(display?.gapDock).toBeGreaterThanOrEqual(14);
    expect(display?.final).toBeLessThan(73);

    expect(display?.referralUrgency).toBe("strongly_advised");
    expect(display?.referralAdvice).toMatch(/substantially help/i);
    expect(display?.referralAdvice).toMatch(/Alex Chen/i);
    expect(display?.actionLine).not.toMatch(/referral/i);

    const penalties = buildSurvivabilityPenalties(clamped.rules, IBM_JOB);
    expect(penalties.every((p) => p.lever !== "referral")).toBe(true);
    expect(penalties.every((p) => !p.leverLabel.toLowerCase().includes("referral"))).toBe(true);

    const credentialRow = display!.survivabilityRows.find((r) => r.key === "credentialSignal");
    const degreePenalty = penalties.find((p) => p.message.match(/degree gate/i));
    expect(credentialRow?.lever).toBe("none_in_loop");
    expect(degreePenalty?.lever).toBe("none_in_loop");
    expect(credentialRow?.lever).toBe(degreePenalty?.lever);
  });
});

describe("referral score isolation", () => {
  const scoreFixture = () => {
    const rules = evaluateRules(IBM_JOB, userProfile, { activeResumeType: "SWE" });
    const composite = computeCompositeScore({
      rawScore: IBM_RAW_SCORE,
      rules,
      extracted: IBM_JOB,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });
    return { rules, composite };
  };

  it("toggling referralPathwayAvailable does not change any score field", () => {
    const { rules, composite } = scoreFixture();

    const withoutPathway = buildScoreDisplay({
      score: composite.score,
      rules,
      extracted: IBM_JOB,
      recommendation: composite.recommendation,
      referralPathwayAvailable: false,
    });
    const withPathway = buildScoreDisplay({
      score: composite.score,
      rules,
      extracted: IBM_JOB,
      recommendation: composite.recommendation,
      referralPathwayAvailable: true,
      referralPathwayNotes: "Connection via Alex Chen",
    });

    for (const field of [
      "capability",
      "survivability",
      "final",
      "survAdjustment",
      "gapDock",
      "scoreBand",
      "bandHeadline",
    ] as const) {
      expect(withPathway![field]).toBe(withoutPathway![field]);
    }

    expect(withPathway!.referralAdvice).not.toBe(withoutPathway!.referralAdvice);
    expect(withPathway!.referralAdvice).toMatch(/Alex Chen/i);
  });
});

describe("referral urgency scaling", () => {
  it("low credential/recognizability → strongly_advised", () => {
    const breakdown: SurvivabilityBreakdown = {
      employerRecognizability: 0.28,
      credentialSignal: 0.32,
      impactMetricQuality: 0.55,
      resumeStoryCoherence: 0.55,
      domainMatchForListing: 0.55,
      poolFriendliness: 0.55,
      weightedAverage: 0.42,
      multiplier: 0.42,
    };
    const shortfall = computeReferralAddressableShortfall(breakdown);
    expect(shortfall).toBeGreaterThanOrEqual(0.1);
    expect(resolveReferralUrgency(shortfall)).toBe("strongly_advised");
  });

  it("high addressable factors → optional", () => {
    const breakdown: SurvivabilityBreakdown = {
      employerRecognizability: 0.85,
      credentialSignal: 0.9,
      impactMetricQuality: 0.55,
      resumeStoryCoherence: 0.55,
      domainMatchForListing: 0.55,
      poolFriendliness: 0.55,
      weightedAverage: 0.72,
      multiplier: 0.72,
    };
    const shortfall = computeReferralAddressableShortfall(breakdown);
    expect(shortfall).toBeLessThan(0.04);
    const advice = deriveReferralAdvice({ survivabilityBreakdown: breakdown });
    expect(advice.urgency).toBe("optional");
    expect(advice.advice).toMatch(/optional but never hurts/i);
  });
});

describe("pool-not-routable referral urgency", () => {
  it("pool-only shortfall does not produce strongly_advised", () => {
    const breakdown: SurvivabilityBreakdown = {
      employerRecognizability: 0.75,
      credentialSignal: 0.72,
      impactMetricQuality: 0.55,
      resumeStoryCoherence: 0.55,
      domainMatchForListing: 0.55,
      poolFriendliness: 0.2,
      weightedAverage: 0.58,
      multiplier: 0.58,
    };
    const shortfall = computeReferralAddressableShortfall(breakdown);
    expect(shortfall).toBeLessThan(0.04);
    expect(resolveReferralUrgency(shortfall)).toBe("optional");
  });
});

describe("referral always present", () => {
  it("referralAdvice renders on every job with urgency-appropriate prominence", () => {
    const { rules, composite } = (() => {
      const r = evaluateRules(IBM_JOB, userProfile, { activeResumeType: "SWE" });
      const c = computeCompositeScore({
        rawScore: IBM_RAW_SCORE,
        rules: r,
        extracted: IBM_JOB,
        profile: userProfile,
        resumeText: SWE_RESUME,
      });
      return { rules: r, composite: c };
    })();

    const display = buildScoreDisplay({
      score: composite.score,
      rules,
      extracted: IBM_JOB,
      recommendation: composite.recommendation,
    });

    expect(display?.referralAdvice).toBeTruthy();
    expect(display?.referralUrgency).toMatch(/strongly_advised|advised|optional/);
    expect(display?.actionLine).not.toMatch(/referral/i);
  });
});

describe("lever tag audit", () => {
  it("no penalty row uses referral lever", () => {
    const rules = evaluateRules(IBM_JOB, userProfile, { activeResumeType: "SWE" });
    const penalties = buildSurvivabilityPenalties(rules, IBM_JOB);
    for (const penalty of penalties) {
      expect(penalty.lever).not.toBe("referral");
      expect(penalty.leverLabel.toLowerCase()).not.toContain("referral");
    }
  });
});
