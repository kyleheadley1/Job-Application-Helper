import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import {
  deriveReferralAdvice,
  hasRequiredStackLanguageMismatch,
} from "../../lib/referralAdvice.js";
import {
  calibrationSweResumeContexts,
  scoreCalibrationAnchor,
} from "../fixtures/calibrationAnchors.js";
import type { SurvivabilityBreakdown } from "../../lib/survivabilityScore.js";

/** Niche-employer-like survivability: mild shortfall → would be "optional" without a stack gap. */
const NICHE_SURV: SurvivabilityBreakdown = {
  employerRecognizability: 0.55,
  credentialSignal: 0.55,
  impactMetricQuality: 0.5,
  resumeStoryCoherence: 0.7,
  domainMatchForListing: 0.55,
  poolFriendliness: 0.85,
  weightedAverage: 0.6,
  multiplier: 0.6,
};

describe("referral verbiage — required stack/language mismatch escalation", () => {
  it("deriveReferralAdvice escalates only when requiredStackLanguageMismatch is set", () => {
    const calm = deriveReferralAdvice({ survivabilityBreakdown: NICHE_SURV });
    expect(calm.urgency).toBe("optional");
    expect(calm.advice).toMatch(/optional but never hurts/i);

    const escalated = deriveReferralAdvice({
      survivabilityBreakdown: NICHE_SURV,
      requiredStackLanguageMismatch: true,
    });
    expect(escalated.urgency).toBe("strongly_advised");
    expect(escalated.advice).toMatch(/required core-language \/ stack gap/i);
    expect(escalated.advice).toMatch(/substantially help/i);
  });

  it("paired anchors: Eulerity + NYT CDP both escalate despite different employer scale", () => {
    const eulerity = scoreCalibrationAnchor("eulerityJavaRequired");
    const nyt = scoreCalibrationAnchor("nytCdpRequiredLanguage");

    expect(hasRequiredStackLanguageMismatch(eulerity.rules)).toBe(true);
    expect(hasRequiredStackLanguageMismatch(nyt.rules)).toBe(true);
    expect(eulerity.rules.coreLanguageGap).toContain("Java");
    expect(nyt.rules.coreLanguageGap?.length).toBeGreaterThan(0);

    expect(eulerity.score.scoreDisplay?.referralUrgency).toBe("strongly_advised");
    expect(nyt.score.scoreDisplay?.referralUrgency).toBe("strongly_advised");
    expect(eulerity.score.scoreDisplay?.referralAdvice).toMatch(/substantially help/i);
    expect(nyt.score.scoreDisplay?.referralAdvice).toMatch(/substantially help/i);
    // Same severity tier — not the pre-fix Eulerity "optional but never hurts" tone.
    expect(eulerity.score.scoreDisplay?.referralAdvice).not.toMatch(/optional but never hurts/i);
    expect(nyt.score.scoreDisplay?.referralAdvice).not.toMatch(/optional but never hurts/i);
  });

  it("guards: Traba / Cherry Hill stay calm (no required stack mismatch)", () => {
    for (const key of ["trabaAppliedAi", "cherryHill"] as const) {
      const scored = scoreCalibrationAnchor(key);
      expect(hasRequiredStackLanguageMismatch(scored.rules)).toBe(false);
      expect(scored.score.scoreDisplay?.referralAdvice).not.toMatch(
        /required core-language \/ stack gap/i,
      );
    }
  });

  it("preferred-only Java does not escalate referral verbiage", () => {
    const scored = scoreCalibrationAnchor("preferredOnlyGapVerbiage");
    expect(hasRequiredStackLanguageMismatch(scored.rules)).toBe(false);
    expect(scored.rules.stackMismatch).toBe(false);
    expect(scored.score.scoreDisplay?.referralAdvice).not.toMatch(
      /required core-language \/ stack gap/i,
    );
    expect(scored.score.scoreDisplay?.referralUrgency).not.toBe("strongly_advised");
  });

  it("hasRequiredStackLanguageMismatch mirrors Key Risk stack flags", () => {
    const eulerity = scoreCalibrationAnchor("eulerityJavaRequired");
    expect(eulerity.rules.notes.some((n) => /Required core language gap: Java/i.test(n))).toBe(
      true,
    );
    expect(hasRequiredStackLanguageMismatch(eulerity.rules)).toBe(true);

    const preferred = evaluateRules(
      scoreCalibrationAnchor("preferredOnlyGapVerbiage").fixture.extracted,
      userProfile,
      { resumeContexts: calibrationSweResumeContexts(), activeResumeType: "SWE" },
    );
    expect(hasRequiredStackLanguageMismatch(preferred)).toBe(false);
  });
});
