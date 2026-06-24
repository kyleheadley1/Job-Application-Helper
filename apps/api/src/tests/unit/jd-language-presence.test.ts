import { describe, expect, it } from "vitest";
import {
  extractJdLanguageLabels,
  filterLanguagesToJdPresence,
  languagePresentInJd,
  suppressAbsentLanguageClaims,
} from "../../lib/jdLanguagePresence.js";
import { buildHardRuleFlags } from "../../lib/scoringClampLayer.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { RuleEvaluation } from "../../types/scoring.js";

const IAM_JOB: ExtractedJobData = {
  company: "Optimizely",
  title: "Identity Engineer",
  stack: ["SAML", "OAuth", "OIDC", "LDAP"],
  requiredSkills: ["SAML", "OAuth"],
  preferredSkills: [],
  domainTags: [],
  responsibilities: [],
  requirements: ["SAML and OIDC experience required"],
  rawText: "SAML OAuth OIDC LDAP Active Directory. No Go anywhere.",
};

describe("jdLanguagePresence", () => {
  it("extracts languages only from structured JD fields", () => {
    const labels = extractJdLanguageLabels(IAM_JOB);
    expect(labels.has("Go")).toBe(false);
    expect(labels.has("TypeScript")).toBe(false);
  });

  it("drops fabricated gap languages not present in the JD", () => {
    expect(filterLanguagesToJdPresence(["Go", "Scala"], IAM_JOB)).toEqual([]);
    expect(languagePresentInJd("Go", IAM_JOB)).toBe(false);
  });

  it("suppresses risk lines asserting missing languages absent from JD", () => {
    expect(
      suppressAbsentLanguageClaims("Missing Go production depth is a major gap.", IAM_JOB),
    ).toBe("");
    expect(
      suppressAbsentLanguageClaims("Core language mismatch — role backend (Go) is outside lane.", IAM_JOB),
    ).toBe("");
  });

  it("buildHardRuleFlags drops coreLanguageMismatch when cited languages fail JD validation", () => {
    const rules: RuleEvaluation = {
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
      notes: [],
    };
    const flags = buildHardRuleFlags(IAM_JOB, rules);
    expect(flags.some((f) => f.id === "coreLanguageMismatch")).toBe(false);
  });
});
