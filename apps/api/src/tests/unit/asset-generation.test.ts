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
    expect(g.tailoredBulletCandidates?.some((b) => /api|product|integration|full-stack/i.test(b))).toBe(true);
  });

  it("whyCompany references actual company and posting thread", () => {
    const job = makeJob({});
    const g = buildDeterministicGeneratedAssets(job, userProfile);
    expect(g.whyCompany).toContain("Acme");
    expect((g.whyCompany ?? "").toLowerCase()).toMatch(/ship internal|posting|role/);
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

  it("deterministic cover letter stays textbox-sized by default", () => {
    const g = buildDeterministicGeneratedAssets(makeJob({ recommendation: "yes" }), userProfile);
    const words = (g.coverLetter ?? "").trim().split(/\s+/).filter(Boolean).length;
    expect(words).toBeLessThanOrEqual(200);
    expect(words).toBeGreaterThanOrEqual(90);
  });

  it("deterministic cover letter is concise multi-paragraph textbox format", () => {
    const g = buildDeterministicGeneratedAssets(makeJob({ recommendation: "selective_yes" }), userProfile);
    const paras = (g.coverLetter ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    expect(paras.length).toBeGreaterThanOrEqual(2);
    expect(paras.length).toBeLessThanOrEqual(3);
    expect((g.coverLetter ?? "").toLowerCase()).not.toMatch(/in a recent project i|two relevant examples from my background are/);
  });

  it("selective_yes caveat language remains subordinate in final paragraph flow", () => {
    const g = buildDeterministicGeneratedAssets(
      makeJob({
        recommendation: "selective_yes",
        extracted: {
          company: "ScaleCo",
          title: "Junior Software Engineer",
          stack: ["TypeScript", "Node.js"],
          requiredSkills: ["full-stack ownership", "AI tooling"],
          preferredSkills: ["Go"],
          domainTags: [],
          responsibilities: ["Build full-stack product features and iterate with cross-functional teams"],
          requirements: ["Entry-level role with internet-scale systems exposure"],
          rawText:
            "Entry-level builder role with AI tooling and full-stack ownership. Go is preferred while scaling internet-scale systems.",
        },
      }),
      userProfile,
    );
    const paras = (g.coverLetter ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    expect(paras.length).toBeGreaterThanOrEqual(2);
    expect(paras.length).toBeLessThanOrEqual(3);
    const blob = (g.coverLetter ?? "").toLowerCase();
    const caveatHits = (blob.match(/\b(don['’]t|do not|lack|missing|without|no\b)\b/g) ?? []).length;
    expect(caveatHits).toBeLessThanOrEqual(1);
  });

  it("cover letters differ across role shapes and do not always reuse same angle", () => {
    const product = buildDeterministicGeneratedAssets(
      makeJob({
        extracted: {
          company: "ProductCo",
          title: "Full-Stack Engineer",
          stack: ["TypeScript", "React"],
          requiredSkills: ["Node.js", "APIs"],
          preferredSkills: [],
          domainTags: [],
          responsibilities: ["Ship full-stack product features and internal tooling"],
          requirements: ["Product collaboration", "Iterative delivery"],
          rawText: "Product role with internal tooling and full-stack shipping",
        },
        recommendedResume: "SWE",
      }),
      userProfile,
    );
    const impl = buildDeterministicGeneratedAssets(
      makeJob({
        extracted: {
          company: "DeployCo",
          title: "Solutions Engineer",
          stack: ["APIs"],
          requiredSkills: ["Integrations"],
          preferredSkills: [],
          domainTags: [],
          responsibilities: ["Lead customer integrations and implementation delivery"],
          requirements: ["Stakeholder communication"],
          rawText: "Implementation role focused on customer integrations",
        },
        recommendedResume: "SIE",
      }),
      userProfile,
    );
    expect(product.coverLetter).not.toEqual(impl.coverLetter);
    expect((impl.coverLetter ?? "").toLowerCase()).toMatch(/integration|implementation|delivery/);
  });

  it("recommendation bands produce more restrained forced-no cover letter", () => {
    const yes = buildDeterministicGeneratedAssets(makeJob({ recommendation: "yes" }), userProfile);
    const no = buildDeterministicGeneratedAssets(makeJob({ recommendation: "no" }), userProfile);
    expect((no.coverLetter ?? "").toLowerCase()).toMatch(/stretch|may be a stretch|ramping/);
    expect((yes.coverLetter ?? "").toLowerCase()).not.toMatch(/may be a stretch/);
  });

  it("cover letters keep caveat language bounded by recommendation band", () => {
    const caveatHits = (s: string) =>
      (s.match(/\bdon['’]t have\b/gi)?.length ?? 0) +
      (s.match(/\black\b/gi)?.length ?? 0) +
      (s.match(/\bmissing\b/gi)?.length ?? 0) +
      (s.match(/\bno bachelor'?s\b/gi)?.length ?? 0);
    const yes = buildDeterministicGeneratedAssets(makeJob({ recommendation: "yes" }), userProfile);
    const selective = buildDeterministicGeneratedAssets(
      makeJob({ recommendation: "selective_yes" }),
      userProfile,
    );
    const forcedNo = buildDeterministicGeneratedAssets(makeJob({ recommendation: "no" }), userProfile);
    expect(caveatHits(yes.coverLetter ?? "")).toBeLessThanOrEqual(1);
    expect(caveatHits(selective.coverLetter ?? "")).toBeLessThanOrEqual(2);
    expect((forcedNo.coverLetter ?? "").toLowerCase()).not.toMatch(/i should not apply|i am not qualified|reject me/);
  });

  it("selective_yes cover letter stays role-focused without foregrounding stack-gap caveats", () => {
    const job = makeJob({
      recommendation: "selective_yes",
      extracted: {
        company: "BuilderCo",
        title: "Junior Full-Stack Engineer",
        stack: ["TypeScript", "React", "Node.js"],
        requiredSkills: ["Full-stack product delivery", "Collaboration with PM/design"],
        preferredSkills: ["Go", "AI tooling"],
        domainTags: [],
        responsibilities: ["Own features end-to-end and iterate quickly with product/design"],
        requirements: ["1-3 years experience", "early-career growth mindset"],
        rawText:
          "Junior builder role emphasizing AI tooling acceleration, full-stack product ownership, collaboration, and scaling.",
      },
    });
    const g = buildDeterministicGeneratedAssets(job, userProfile);
    const cover = (g.coverLetter ?? "").toLowerCase();
    expect(cover).toMatch(/full-stack|product|collaborat|ai/);
    expect(cover).not.toMatch(/i don't have go|missing go|lack go/);
  });

  it("whyCompany stays specific and avoids generic praise filler", () => {
    const g = buildDeterministicGeneratedAssets(
      makeJob({
        extracted: {
          company: "SignalOps",
          title: "Product Engineer",
          stack: ["TypeScript", "Node.js"],
          requiredSkills: ["APIs", "internal tools"],
          preferredSkills: [],
          domainTags: [],
          responsibilities: ["Ship product-facing internal tooling for operations workflows"],
          requirements: ["Collaborate with cross-functional stakeholders"],
          rawText: "Internal operations tooling with API-heavy product work",
        },
      }),
      userProfile,
    );
    const why = (g.whyCompany ?? "").toLowerCase();
    expect(why).toContain("signalops");
    expect(why).toMatch(/role|priorit|fit|overlap|background/);
    expect(why).not.toMatch(/innovative|fast-paced|mission-driven/);
  });

  it("bullet candidates differ materially by resume type", () => {
    const swe = buildDeterministicGeneratedAssets(makeJob({ recommendedResume: "SWE" }), userProfile);
    const sie = buildDeterministicGeneratedAssets(makeJob({ recommendedResume: "SIE" }), userProfile);
    const early = buildDeterministicGeneratedAssets(
      makeJob({ recommendedResume: "EARLY_CAREER" }),
      userProfile,
    );
    const sweBlob = (swe.tailoredBulletCandidates ?? []).join(" ").toLowerCase();
    const sieBlob = (sie.tailoredBulletCandidates ?? []).join(" ").toLowerCase();
    const earlyBlob = (early.tailoredBulletCandidates ?? []).join(" ").toLowerCase();
    expect(sweBlob).toMatch(/api|product|internal tooling/);
    expect(sieBlob).toMatch(/integration|implementation|stakeholder/);
    expect(earlyBlob).toMatch(/fundamental|ramping|full-stack/);
  });
});
