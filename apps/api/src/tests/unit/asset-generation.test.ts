import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import {
  AssetGenerationSkippedError,
  buildDeterministicGeneratedAssets,
  generateJobAssets,
} from "../../agents/jobAgent/assetGeneration.js";
import { userProfile } from "../../config/userProfile.js";
import type { JobRecord } from "../../types/job.js";
import type { Recommendation } from "../../types/scoring.js";
import type { ResumeType } from "../../types/resume.js";

const emptyRules = {
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
  notes: [] as string[],
};

const scoreOk = {
  stackFit: 10,
  levelFit: 10,
  domainFit: 7,
  resumeStoryClarity: 10,
  functionalOverlap: 7,
  recruiterFriendliness: 10,
  careerValue: 7,
  total: 61,
};

const makeJob = (overrides: Partial<JobRecord> & { recommendation?: Recommendation; recommendedResume?: ResumeType }): JobRecord => ({
  id: randomUUID(),
  extracted: {
    company: "Acme",
    title: "Software Engineer",
    stack: ["TypeScript"],
    requiredSkills: ["Node.js"],
    preferredSkills: [],
    domainTags: [],
    responsibilities: ["Ship internal tools for operations teams."],
    requirements: ["2+ years experience"],
    rawText: "Acme — Software Engineer. Build TypeScript APIs. Remote NYC.",
  },
  rules: { ...emptyRules },
  score: { ...scoreOk },
  recommendation: overrides.recommendation ?? "selective_yes",
  salaryAsk: {},
  recommendedResume: overrides.recommendedResume ?? "SWE",
  resumeRationale: ["Heuristic"],
  topMatch: "Backend-leaning product engineering",
  mainRisk: "Recruiter screen realism",
  rationale: [],
  risks: [],
  generated: {},
  tracker: {},
  status: "to_review",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("asset generation orchestrator", () => {
  it("skips when recommendation is no and force is false", async () => {
    const job = makeJob({ recommendation: "no" });
    const r = await generateJobAssets({ job, userProfile, force: false });
    expect(r.skipped).toBe(true);
    expect(r.generated).toEqual({});
  });

  it("does not skip when recommendation is no but force is true", async () => {
    const job = makeJob({ recommendation: "no" });
    const r = await generateJobAssets({ job, userProfile, force: true });
    expect(r.skipped).toBeFalsy();
    expect(r.generated.coverLetter?.length).toBeGreaterThan(20);
  });

  it("throws AssetGenerationSkippedError from service contract path (message)", () => {
    expect(new AssetGenerationSkippedError("x").code).toBe("ASSET_GENERATION_SKIPPED");
  });

  it("deterministic pack avoids invented tenure and uses profile-only tech", () => {
    const job = makeJob({ recommendation: "selective_yes" });
    const g = buildDeterministicGeneratedAssets(job, userProfile);
    const blob = JSON.stringify(g).toLowerCase();
    expect(blob).not.toMatch(/\b1\d\+ years\b/);
    expect(blob).not.toContain("google");
    expect(g.tailoredBulletCandidates?.some((b) => /typescript|node|react/i.test(b))).toBe(true);
  });

  it("whyCompany references actual company and posting thread", () => {
    const job = makeJob({});
    const g = buildDeterministicGeneratedAssets(job, userProfile);
    expect(g.whyCompany).toContain("Acme");
    expect(g.whyCompany.toLowerCase()).toMatch(/ship internal|posting|role/);
  });

  it("avoidClaiming warns on visa and degree gates from rules", () => {
    const job = makeJob({
      rules: {
        ...emptyRules,
        explicitDegreeRisk: true,
        visaMismatch: true,
      },
    });
    const g = buildDeterministicGeneratedAssets(job, userProfile);
    const ac = (g.avoidClaiming ?? []).join(" ").toLowerCase();
    expect(ac).toMatch(/degree|bachelor/);
    expect(ac).toMatch(/visa|sponsorship/);
  });

  it("resume types shift deterministic talking-point emphasis", () => {
    const swe = buildDeterministicGeneratedAssets(makeJob({ recommendedResume: "SWE" }), userProfile);
    const sie = buildDeterministicGeneratedAssets(makeJob({ recommendedResume: "SIE" }), userProfile);
    const early = buildDeterministicGeneratedAssets(makeJob({ recommendedResume: "EARLY_CAREER" }), userProfile);
    const sweBlob = (swe.talkingPoints ?? []).join(" ").toLowerCase();
    const sieBlob = (sie.talkingPoints ?? []).join(" ").toLowerCase();
    const earlyBlob = (early.talkingPoints ?? []).join(" ").toLowerCase();
    expect(sweBlob).toMatch(/api|full-stack|shipped/);
    expect(sieBlob).toMatch(/integration|onboarding|implementation/);
    expect(earlyBlob).toMatch(/early-career|training-backed|feedback/);
  });

  it("EARLY_CAREER deterministic tone avoids senior posturing", () => {
    const g = buildDeterministicGeneratedAssets(makeJob({ recommendedResume: "EARLY_CAREER" }), userProfile);
    const tp = (g.talkingPoints ?? []).join(" ").toLowerCase();
    expect(tp).not.toMatch(/\bstaff engineer\b|\b10\+ years\b/);
  });
});
