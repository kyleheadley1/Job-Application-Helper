import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { claimableStackFromContexts } from "../../lib/claimableStack.js";
import { extractTitleRegionFromTitle } from "../../lib/geoScope.js";
import {
  classifyJdLines,
  sanitizeExtractedTags,
  termIsPreferredOrNarrativeOnly,
} from "../../lib/jdTagProvenance.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import { analyzeStackMismatch } from "../../lib/stackMismatchAnalysis.js";
import {
  calibrationSweResumeContexts,
  loadCalibrationFixture,
  scoreCalibrationAnchor,
} from "../fixtures/calibrationAnchors.js";

/**
 * Required-vs-preferred extraction must be general (rawText section headers),
 * not one-off job patches. Covers Fleetio, BisectHosting, and Cherry Technologies.
 */
describe("required-vs-preferred extraction — Fleetio + BisectHosting + Cherry", () => {
  const claimable = claimableStackFromContexts(calibrationSweResumeContexts(), "SWE");

  describe("section header classification (general)", () => {
    it("recognizes What You Need and Nice-to-Haves: subtitle headers", () => {
      const lines = classifyJdLines(
        [
          "What You Need",
          "Strong TypeScript and React fundamentals",
          "Nice-to-Haves: Familiarity with our stack",
          "Kotlin",
        ].join("\n"),
      );
      expect(
        lines.some((l) => /TypeScript/.test(l.line) && l.strength === "REQUIRED"),
      ).toBe(true);
      expect(lines.some((l) => /^Kotlin$/i.test(l.line.trim()) && l.strength === "PREFERRED")).toBe(
        true,
      );
    });
  });

  describe("Fleetio Marketplace — chip/preferred Figma not required", () => {
    const raw = loadCalibrationFixture("fleetioMarketplace");
    const sanitized = sanitizeExtractedTags(raw.extracted);

    it("does not keep Figma in requiredSkills after provenance sanitize", () => {
      expect(raw.extracted.requiredSkills).toContain("Figma");
      expect(sanitized.requiredSkills).not.toContain("Figma");
    });

    it("does not emit Figma as a core language/stack gap", () => {
      const mismatch = analyzeStackMismatch(sanitized, claimable);
      expect(mismatch.coreLanguageGap.join(" ")).not.toMatch(/figma/i);
    });
  });

  describe("BisectHosting — required PHP Laravel still gaps; preferred-only must not invent gaps", () => {
    const fixture = loadCalibrationFixture("bisectHostingWebDeveloper");

    it("still treats required PHP Laravel as a core gap", () => {
      const mismatch = analyzeStackMismatch(fixture.extracted, claimable);
      expect(mismatch.stackMismatch).toBe(true);
      expect(mismatch.coreLanguageGap.join(" ")).toMatch(/php|laravel/i);
    });

    it("does not invent FDE / solutions-consulting risk bleed", () => {
      const scored = scoreCalibrationAnchor("bisectHostingWebDeveloper");
      const blob = [...(scored.rules.notes ?? []), ...(scored.rules.hardRuleNotes ?? [])].join(
        "\n",
      );
      expect(blob).not.toMatch(/forward[-\s]?deployed|solutions[-\s]?consulting/i);
    });
  });

  describe("Cherry Technologies Mid-Level — Kotlin Nice-to-Have only", () => {
    const raw = loadCalibrationFixture("cherryTechnologiesMidLevel");
    const sanitized = sanitizeExtractedTags(raw.extracted);

    it("classifies Kotlin as preferred-only from Nice-to-Haves section", () => {
      expect(termIsPreferredOrNarrativeOnly("Kotlin", sanitized)).toBe(true);
      expect(sanitized.requiredSkills).not.toContain("Kotlin");
      expect(
        sanitized.preferredSkills.some((s) => /kotlin/i.test(s)) ||
          sanitized.stack.some((s) => /kotlin/i.test(s)),
      ).toBe(true);
    });

    it("does not emit Kotlin required core-language gap or role-backend Kotlin claim", () => {
      const mismatch = analyzeStackMismatch(sanitized, claimable);
      expect(mismatch.coreLanguageGap).not.toContain("Kotlin");
      expect(mismatch.coreLanguageGap.join(" ")).not.toMatch(/kotlin/i);

      const scored = scoreCalibrationAnchor("cherryTechnologiesMidLevel");
      const notes = [...(scored.rules.notes ?? []), ...(scored.rules.hardRuleNotes ?? [])].join(
        "\n",
      );
      expect(notes).not.toMatch(/kotlin/i);
      expect(notes).not.toMatch(/role backend\s*\(.*kotlin/i);

      const display = buildScoreDisplay({
        score: scored.score,
        rules: scored.rules,
        extracted: sanitized,
        recommendation: scored.recommendation,
      });
      const penalties = (display?.survivabilityPenalties ?? []).map((p) => p.message).join("\n");
      expect(penalties).not.toMatch(/kotlin/i);
      expect(penalties).not.toMatch(/role backend/i);
    });

    it("does not fire finance/trading/insurance placement boilerplate", () => {
      const scored = scoreCalibrationAnchor("cherryTechnologiesMidLevel");
      expect(
        scored.rules.hardRuleFlags?.some((f) => f.id === "financePenalty"),
      ).toBe(false);
      const display = buildScoreDisplay({
        score: scored.score,
        rules: scored.rules,
        extracted: sanitized,
        recommendation: scored.recommendation,
      });
      const penalties = (display?.survivabilityPenalties ?? []).map((p) => p.message).join("\n");
      expect(penalties).not.toMatch(
        /Finance\/trading\/insurance placement|staffing into financial institution/i,
      );
    });

    it("does not fire Mid vs Remote-in-USA eligibility misfire", () => {
      expect(extractTitleRegionFromTitle("Mid-Level Software Engineer")).toBeNull();
      const rules = evaluateRules(sanitized, userProfile, {
        resumeContexts: calibrationSweResumeContexts(),
        activeResumeType: "SWE",
      });
      expect(rules.eligibilityFlag).toBeUndefined();
      expect(rules.eligibilityFlag?.reason ?? "").not.toMatch(/Title scopes to Mid/i);
    });

    it("does not collapse to skip solely from fabricated Kotlin core gap", () => {
      const scored = scoreCalibrationAnchor("cherryTechnologiesMidLevel");
      expect(scored.rules.stackMismatch).toBe(false);
      expect(scored.rules.coreLanguageGap ?? []).not.toContain("Kotlin");
      // Score should not be crushed into the fabricated-gap skip band (~40).
      expect(scored.score.total).toBeGreaterThan(50);
    });
  });
});
