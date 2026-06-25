import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import {
  applyJdLanguageOutputBoundary,
  outputCitesAbsentLanguage,
} from "../../lib/jdLanguageOutputBoundary.js";
import { extractJdLanguageLabels } from "../../lib/jdLanguagePresence.js";
import { applyScoringClampLayer, buildHardRuleFlags } from "../../lib/scoringClampLayer.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { RuleEvaluation, ScoreBreakdown } from "../../types/scoring.js";

const OPTIMIZELY_JOB: ExtractedJobData = {
  company: "Optimizely",
  title: "Software Engineer II — Identity Platform",
  location: "Remote",
  remoteType: "remote",
  stack: ["SAML", "OAuth", "OIDC", "REST", "GraphQL", "LDAP", "Active Directory", "Kubernetes", "Docker"],
  requiredSkills: ["SAML", "OAuth", "OIDC", "LDAP"],
  preferredSkills: ["GraphQL", "Kubernetes"],
  domainTags: ["identity", "IAM"],
  responsibilities: [
    "Build enterprise identity integrations using SAML, OAuth, and OIDC",
    "Integrate LDAP and Active Directory for customer SSO",
  ],
  requirements: [
    "Bachelor's or master's degree or related experience required",
    "Production experience with SAML, OAuth, and OIDC",
    "LDAP / Active Directory integration experience",
  ],
  rawText:
    "Optimizely IAM platform. SAML OAuth OIDC LDAP Active Directory. Kubernetes Docker. No Go in this JD.",
};

const GO_FREE_IAM_JOB = OPTIMIZELY_JOB;

const BASE_SCORE: ScoreBreakdown = {
  stackFit: 14,
  levelFit: 12,
  domainFit: 5,
  resumeStoryClarity: 6,
  functionalOverlap: 7,
  recruiterFriendliness: 8,
  careerValue: 6,
  total: 0,
};

const GO_ABSENT_RE = /\b(go(lang)?|missing go|lacks go)\b/i;

const contaminatedRules = (): RuleEvaluation => ({
  explicitDegreeRisk: false,
  traditionalCompanyPenalty: false,
  financePenalty: false,
  strictNewGradPipeline: false,
  earlyCareerFriendlyRole: false,
  newGradPenalty: false,
  seniorityOverreach: false,
  locationMismatch: false,
  visaMismatch: false,
  citizenshipMismatch: false,
  clearanceMismatch: false,
  stackMismatch: true,
  coreLanguageGap: ["Go"],
  domainMismatch: false,
  startupFounderMismatch: false,
  notes: ["Required core language gap: Go — not in claimable stack."],
  hardRuleNotes: ["Required core stack gap (Go) — major recruiter-screen risk."],
});

describe("jdLanguagePresence output boundary", () => {
  it("extracts no Go from Optimizely structured JD", () => {
    expect(extractJdLanguageLabels(OPTIMIZELY_JOB).has("Go")).toBe(false);
  });

  it("suppresses coreLanguageMismatch at boundary when Go is absent from JD", () => {
    const rules = contaminatedRules();
    const flags = buildHardRuleFlags(GO_FREE_IAM_JOB, rules);
    expect(flags.some((f) => f.id === "coreLanguageMismatch")).toBe(false);

    const clamped = applyScoringClampLayer({
      score: BASE_SCORE,
      extracted: GO_FREE_IAM_JOB,
      rules,
    });
    expect(clamped.rules.hardRuleFlags?.some((f) => f.id === "coreLanguageMismatch")).toBe(
      false,
    );
    expect(outputCitesAbsentLanguage(GO_FREE_IAM_JOB, clamped.rules)).toBe(false);
    expect(clamped.rules.notes.join(" ")).not.toMatch(GO_ABSENT_RE);
    expect(clamped.rules.hardRuleNotes?.join(" ") ?? "").not.toMatch(GO_ABSENT_RE);
  });

  it("clamp + boundary regression: fabricated Go in coreLanguageGap never survives final output", () => {
    const clamped = applyScoringClampLayer({
      score: BASE_SCORE,
      extracted: GO_FREE_IAM_JOB,
      rules: contaminatedRules(),
    });

    const finalRules = applyJdLanguageOutputBoundary(GO_FREE_IAM_JOB, {
      ...clamped.rules,
      notes: [
        ...clamped.rules.notes,
        "Core language mismatch — role backend (Go) is outside TS/Node claimable lane.",
      ],
      hardRuleFlags: [
        ...(clamped.rules.hardRuleFlags ?? []),
        {
          id: "coreLanguageMismatch",
          citedLanguages: ["Go"],
          message: "Core language mismatch — role backend (Go) is outside TS/Node claimable lane.",
        },
      ],
    });

    expect(finalRules.hardRuleFlags?.some((f) => f.id === "coreLanguageMismatch")).toBe(false);
    expect(finalRules.notes.some((n) => GO_ABSENT_RE.test(n))).toBe(false);
    expect(finalRules.hardRuleNotes?.some((n) => GO_ABSENT_RE.test(n)) ?? false).toBe(false);
    expect(outputCitesAbsentLanguage(GO_FREE_IAM_JOB, finalRules)).toBe(false);
  });

  it("Optimizely evaluateRules + clamp produces no Go language-mismatch output", () => {
    const rules = evaluateRules(OPTIMIZELY_JOB, userProfile, { activeResumeType: "SWE" });
    const clamped = applyScoringClampLayer({
      score: BASE_SCORE,
      extracted: OPTIMIZELY_JOB,
      rules,
    });

    expect(extractJdLanguageLabels(OPTIMIZELY_JOB).has("Go")).toBe(false);
    expect(outputCitesAbsentLanguage(OPTIMIZELY_JOB, clamped.rules)).toBe(false);
    for (const flag of clamped.rules.hardRuleFlags ?? []) {
      expect(flag.citedLanguages ?? []).not.toContain("Go");
      expect(flag.message).not.toMatch(GO_ABSENT_RE);
    }
  });

  it("allows coreLanguageMismatch when cited language is actually in the JD", () => {
    const phpJob: ExtractedJobData = {
      ...GO_FREE_IAM_JOB,
      stack: ["PHP", "Laravel"],
      requiredSkills: ["PHP"],
      requirements: ["Strong PHP required"],
    };
    const rules: RuleEvaluation = {
      ...contaminatedRules(),
      coreLanguageGap: ["PHP"],
      notes: ["Required core language gap: PHP — not in claimable stack."],
    };
    const clamped = applyScoringClampLayer({
      score: BASE_SCORE,
      extracted: phpJob,
      rules,
    });
    expect(clamped.rules.hardRuleFlags?.some((f) => f.id === "coreLanguageMismatch")).toBe(true);
    expect(clamped.rules.hardRuleFlags?.find((f) => f.id === "coreLanguageMismatch")?.citedLanguages).toEqual(
      ["PHP"],
    );
  });
});
