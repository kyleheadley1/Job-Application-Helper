import { describe, expect, it } from "vitest";
import { buildDeterministicGeneratedAssets } from "../../agents/jobAgent/assetGeneration.js";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { applyJdLanguageOutputBoundary } from "../../lib/jdLanguageOutputBoundary.js";
import {
  extractJdLanguageLabels,
  languagePresentInJd,
} from "../../lib/jdLanguagePresence.js";
import { analyzeStackMismatch } from "../../lib/stackMismatchAnalysis.js";
import { claimableStackFromContexts } from "../../lib/claimableStack.js";
import { polishRisksAndMain } from "../../lib/scoringOutputPolish.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import { textMentionsGoLanguage } from "../../lib/goLanguage.js";
import {
  calibrationSweResumeContexts,
  fixtureToJobRecord,
  loadCalibrationFixture,
  scoreCalibrationAnchor,
} from "../fixtures/calibrationAnchors.js";

const GO_PROSE_RE = /\b(go(lang)?)\b/i;

const assertNoGoAnywhere = (surfaces: string[]) => {
  for (const s of surfaces) {
    expect(s, `unexpected Go in: ${s}`).not.toMatch(GO_PROSE_RE);
  }
};

describe("rawText-grounded tech cites — Fleetio + Bubble regression", () => {
  const resumeContexts = calibrationSweResumeContexts();
  const claimable = claimableStackFromContexts(resumeContexts, "SWE");

  it("does not treat English 'to go' as the Go language", () => {
    expect(textMentionsGoLanguage("to go")).toBe(false);
    expect(textMentionsGoLanguage("Go")).toBe(true);
    expect(textMentionsGoLanguage("golang")).toBe(true);
  });

  describe("Bubble Scaling (hallucinated Go in extracted arrays, absent from rawText)", () => {
    const fixture = loadCalibrationFixture("bubbleSoftwareEngineer2Scaling");

    it("does not treat hallucinated extracted Go as JD-present", () => {
      expect(fixture.extracted.stack).toContain("Go");
      expect(fixture.extracted.requiredSkills).toContain("Go");
      expect(languagePresentInJd("Go", fixture.extracted)).toBe(false);
      expect([...extractJdLanguageLabels(fixture.extracted)]).not.toContain("Go");
      expect([...extractJdLanguageLabels(fixture.extracted)]).toContain("Rust");
    });

    it("stack mismatch cites Rust/Terraform/Redis but never Go", () => {
      const mismatch = analyzeStackMismatch(fixture.extracted, claimable);
      expect(mismatch.coreLanguageGap).toEqual(
        expect.arrayContaining(["Rust", "Terraform", "Redis"]),
      );
      expect(mismatch.coreLanguageGap).not.toContain("Go");
    });

    it("rules notes, Key Risks, Survivability Penalties, and asset surfaces never cite Go", () => {
      const scored = scoreCalibrationAnchor("bubbleSoftwareEngineer2Scaling");
      const bounded = applyJdLanguageOutputBoundary(fixture.extracted, scored.rules);
      expect(bounded.coreLanguageGap ?? []).not.toContain("Go");

      const polished = polishRisksAndMain({
        mainRisk: "Required core language gap: Rust, Go — not in claimable stack.",
        risks: ["Gap on Go versus JD emphasis."],
        extracted: fixture.extracted,
        userProfile,
        rules: bounded,
        max: 3,
      });

      const display = buildScoreDisplay({
        score: scored.score,
        rules: bounded,
        extracted: fixture.extracted,
        recommendation: scored.recommendation,
      });

      const job = {
        ...fixtureToJobRecord(fixture),
        rules: bounded,
        recommendation: scored.recommendation,
        mainRisk: polished.mainRisk,
        topMatch: "Scaling infrastructure",
      };
      const assets = buildDeterministicGeneratedAssets(job, userProfile);

      assertNoGoAnywhere([
        ...(bounded.notes ?? []),
        ...(bounded.hardRuleNotes ?? []),
        polished.mainRisk,
        ...polished.risks,
        ...(display?.survivabilityPenalties ?? []).map((p) => p.message),
        ...(display?.survivabilityRows ?? []).map((r) => r.penaltyName ?? r.label),
        assets.coverLetter ?? "",
        assets.whyCompany ?? "",
        ...(assets.talkingPoints ?? []),
      ]);
    });
  });

  describe("Fleetio Marketplace (hallucinated Go in extracted arrays, absent from rawText)", () => {
    const fixture = loadCalibrationFixture("fleetioMarketplace");

    it("does not treat hallucinated extracted Go as JD-present", () => {
      expect(fixture.extracted.stack).toContain("Go");
      expect(fixture.extracted.requiredSkills).toContain("Go");
      expect(languagePresentInJd("Go", fixture.extracted)).toBe(false);
      expect([...extractJdLanguageLabels(fixture.extracted)]).not.toContain("Go");
    });

    it("never cites Go even if rules are poisoned with a phantom Go gap", () => {
      const base = evaluateRules(fixture.extracted, userProfile, {
        resumeContexts,
        activeResumeType: "SWE",
      });
      const poisoned = {
        ...base,
        stackMismatch: true,
        coreLanguageGap: [...(base.coreLanguageGap ?? []), "Go"],
        notes: [
          ...(base.notes ?? []),
          "Required core language gap: Go — not in claimable stack.",
        ],
      };
      const bounded = applyJdLanguageOutputBoundary(fixture.extracted, poisoned);
      expect(bounded.coreLanguageGap ?? []).not.toContain("Go");
      expect(bounded.notes.every((n) => !GO_PROSE_RE.test(n))).toBe(true);

      const polished = polishRisksAndMain({
        mainRisk: "Required core language gap: Ruby on Rails, Go — not in claimable stack.",
        risks: ["No demonstrated Go experience."],
        extracted: fixture.extracted,
        userProfile,
        rules: bounded,
        max: 3,
      });
      const display = buildScoreDisplay({
        score: {
          stackFit: 13,
          levelFit: 15,
          domainFit: 7,
          resumeStoryClarity: 8,
          functionalOverlap: 12,
          recruiterFriendliness: 10,
          careerValue: 7,
          total: 0,
          capability: 55,
          survivability: 0.7,
        },
        rules: bounded,
        extracted: fixture.extracted,
        recommendation: "stretch_signal",
      });

      assertNoGoAnywhere([
        ...(bounded.notes ?? []),
        polished.mainRisk,
        ...polished.risks,
        ...(display?.survivabilityPenalties ?? []).map((p) => p.message),
      ]);
    });
  });
});
