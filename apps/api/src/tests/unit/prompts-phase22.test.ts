import { describe, expect, it } from "vitest";
import {
  ASSET_EVIDENCE_DIVERSITY,
  buildCoverLetterGuidance,
  buildCoverLetterAssetUserPrompt,
  buildTalkingPointsAssetUserPrompt,
  buildTailoredBulletsAssetUserPrompt,
  buildScoringPrompt,
  buildWhyCompanyAssetUserPrompt,
  coverLetterAssetSystemPrompt,
  talkingPointsAssetSystemPrompt,
  tailoredBulletsAssetSystemPrompt,
  whyCompanyAssetSystemPrompt,
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
    expect(p).toContain("Tone band: no");
  });

  it("cover-letter guidance selects different archetypes by resume type", () => {
    const sie = buildCoverLetterGuidance(minimalJob({ recommendedResume: "SIE" }), userProfile);
    const swe = buildCoverLetterGuidance(
      minimalJob({
        recommendedResume: "SWE",
        extracted: {
          company: "ProductCo",
          title: "Full-Stack Engineer",
          stack: ["TypeScript", "Node.js"],
          requiredSkills: ["API design"],
          preferredSkills: [],
          domainTags: [],
          responsibilities: ["Ship product features and internal tools"],
          requirements: ["Cross-functional collaboration"],
        },
      }),
      userProfile,
    );
    expect(sie.archetype).toBe("implementation");
    expect(swe.archetype).toBe("product");
  });

  it("cover letter prompt includes explicit textbox length contract", () => {
    const p = buildCoverLetterAssetUserPrompt({
      job: minimalJob({ recommendedResume: "SWE" }),
      userProfile,
    });
    expect(p).toContain("Cover-letter guidance:");
    expect(p).toContain('"priorities"');
    expect(coverLetterAssetSystemPrompt).toContain("130–200 words");
    expect(coverLetterAssetSystemPrompt).toContain("2–3 short paragraphs");
    expect(coverLetterAssetSystemPrompt).toContain("Avoid heavy project-dump framing");
    expect(coverLetterAssetSystemPrompt).toContain("selective_yes");
  });

  it("whyCompany contract emphasizes specificity and rejects generic praise", () => {
    expect(whyCompanyAssetSystemPrompt).toContain("specific role/company hook");
    expect(whyCompanyAssetSystemPrompt).toContain("Do not use generic praise");
  });

  it("talking points prompt requires conversation-usable and one why-me point", () => {
    expect(talkingPointsAssetSystemPrompt).toContain("actually say out loud");
    expect(talkingPointsAssetSystemPrompt).toContain('"why me for this role"');
    const p = buildTalkingPointsAssetUserPrompt({ job: minimalJob({}), userProfile });
    expect(p).toContain("Shared generation guidance:");
  });

  it("tailored bullets prompt enforces resume-type-aware differences", () => {
    expect(tailoredBulletsAssetSystemPrompt).toContain("Resume-type-aware");
    const p = buildTailoredBulletsAssetUserPrompt({ job: minimalJob({ recommendedResume: "SIE" }), userProfile });
    expect(p).toContain("Shared generation guidance:");
  });

  it("generation prompts include only selected resume grounding context", () => {
    const p = buildWhyCompanyAssetUserPrompt({
      job: minimalJob({ recommendedResume: "SIE" }),
      userProfile,
      selectedResumeContext: {
        type: "SIE",
        sourcePath: "apps/api/data/resumes/sie_resume.txt",
        sourceKind: "txt",
        loadedAt: "2026-01-01T00:00:00.000Z",
        rawText: "Implementation and integrations",
        metadata: {
          strongestThemes: ["implementation delivery"],
          projectEvidence: [],
          keywords: ["implementation"],
          bestFitRoleShapes: ["implementation"],
          avoidUseCases: [],
          claimSupport: [{ claim: "Implementation delivery", evidenceSnippets: ["Led integration rollout"] }],
        },
      },
    });
    expect(p).toContain("Selected resume context (ONLY grounding resume to use):");
    expect(p).toContain('"type": "SIE"');
  });
});
