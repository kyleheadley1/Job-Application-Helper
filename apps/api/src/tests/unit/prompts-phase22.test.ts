import { describe, expect, it } from "vitest";
import {
  ASSET_EVIDENCE_DIVERSITY,
  buildCoverLetterAssetUserPrompt,
  buildScoringPrompt,
  buildWhyCompanyAssetUserPrompt,
} from "../../agents/jobAgent/prompts.js";
import type { JobRecord } from "../../types/job.js";
import { userProfile } from "../../config/userProfile.js";
import { scoringPolicy } from "../../config/scoringPolicy.js";

const minimalJob = (overrides: Partial<JobRecord>): JobRecord =>
  ({
    id: "x",
    extracted: {
      company: "DeployCo",
      title: "Solutions Engineer",
      stack: ["APIs"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: ["Integrations"],
      requirements: [],
    },
    rules: {
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
      stackMismatch: false,
      domainMismatch: false,
      startupFounderMismatch: false,
      notes: [],
    },
    score: {
      stackFit: 10,
      levelFit: 10,
      domainFit: 7,
      resumeStoryClarity: 10,
      functionalOverlap: 7,
      recruiterFriendliness: 10,
      careerValue: 7,
      total: 61,
    },
    recommendation: "selective_yes",
    salaryAsk: {},
    recommendedResume: "SIE",
    resumeRationale: [],
    topMatch: "Fit",
    mainRisk: "Risk",
    rationale: [],
    risks: [],
    generated: {},
    tracker: {},
    status: "to_review",
    createdAt: "2020-01-01",
    updatedAt: "2020-01-01",
    ...overrides,
  }) as JobRecord;

describe("Phase 2.2 prompts", () => {
  it("scoring prompt does not ask for asset-only emphasize/avoidClaiming keys", () => {
    const text = buildScoringPrompt({
      extracted: minimalJob({}).extracted,
      rules: minimalJob({}).rules,
      userProfile,
      scoringPolicy,
    });
    expect(text.toLowerCase()).not.toContain("emphasize");
    expect(text.toLowerCase()).not.toContain("avoidclaiming");
    expect(text).toContain('"score"');
    expect(text).toContain('"topMatch"');
  });

  it("cover letter user prompt includes evidence diversity block", () => {
    const job = minimalJob({ recommendedResume: "SWE" });
    const p = buildCoverLetterAssetUserPrompt({ job, userProfile });
    expect(p).toContain(ASSET_EVIDENCE_DIVERSITY.slice(0, 40));
  });

  it("whyCompany user prompt adds SIE scanability instructions only for SIE", () => {
    const sie = buildWhyCompanyAssetUserPrompt({ job: minimalJob({ recommendedResume: "SIE" }), userProfile });
    expect(sie).toContain("SIE / implementation-forward");
    const swe = buildWhyCompanyAssetUserPrompt({
      job: minimalJob({ recommendedResume: "SWE" }),
      userProfile,
    });
    expect(swe).not.toContain("SIE / implementation-forward");
  });

  it("cover letter prompt for recommendation no adds candid stretch tone", () => {
    const p = buildCoverLetterAssetUserPrompt({
      job: minimalJob({ recommendation: "no" }),
      userProfile,
    });
    expect(p.toLowerCase()).toMatch(/stretch|poor fit/);
  });
});
