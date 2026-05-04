import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import type { ExtractedJobData } from "../../types/job.js";

const makeJob = (overrides: Partial<ExtractedJobData>): ExtractedJobData => ({
  company: "TestCo",
  title: "Software Engineer",
  stack: ["TypeScript", "Node.js"],
  requiredSkills: ["API development"],
  preferredSkills: [],
  domainTags: [],
  responsibilities: [],
  requirements: [],
  remoteType: "remote",
  ...overrides,
});

describe("rule engine", () => {
  it("flags explicit degree risks", () => {
    const rules = evaluateRules(
      makeJob({
        degreeRequirement: { level: "required", raw: "Bachelor's degree required" },
      }),
      userProfile,
    );
    expect(rules.explicitDegreeRisk).toBe(true);
  });

  it("flags senior title skepticism", () => {
    const rules = evaluateRules(makeJob({ title: "Senior Software Engineer", yearsExperience: { min: 5 } }), userProfile);
    expect(rules.seniorityOverreach).toBe(true);
  });

  it("flags finance/traditional strictness", () => {
    const rules = evaluateRules(
      makeJob({ company: "Heritage Bank", domainTags: ["finance"], requirements: ["banking systems experience"] }),
      userProfile,
    );
    expect(rules.financePenalty).toBe(true);
    expect(rules.traditionalCompanyPenalty).toBe(true);
  });

  it("does not infer finance/traditional/location penalties for enterprise applied-AI + NYC hybrid", () => {
    const rules = evaluateRules(
      makeJob({
        company: "Distyl AI",
        title: "AI Engineer",
        remoteType: "hybrid",
        location: "Hybrid — New York, NY",
        locationIsCommutable: false,
        rawText: `
Distyl builds customer AI systems for enterprises including Fortune 500 customers and insurance operations teams.
Stack: Python, LLMs, RAG, vector search, REST APIs, evaluations. Hybrid in New York, NY. 25-50% travel.
Series B startup. Not a bank.
        `.trim(),
      }),
      userProfile,
    );
    expect(rules.financePenalty).toBe(false);
    expect(rules.traditionalCompanyPenalty).toBe(false);
    expect(rules.locationMismatch).toBe(false);
  });

  it("flags onsite non-commutable mismatch", () => {
    const rules = evaluateRules(
      makeJob({ remoteType: "onsite", location: "Dallas, TX", locationIsCommutable: false }),
      userProfile,
    );
    expect(rules.locationMismatch).toBe(true);
  });

  it("applies strong new-grad pipeline penalty only with harsh employer or degree gate", () => {
    const soft = evaluateRules(makeJob({ requirements: ["This is a new grad rotational program"] }), userProfile);
    expect(soft.strictNewGradPipeline).toBe(false);
    expect(soft.earlyCareerFriendlyRole).toBe(true);
    expect(soft.newGradPenalty).toBe(false);

    const strict = evaluateRules(
      makeJob({
        company: "Heritage Bank",
        requirements: ["This is a new graduate rotational program"],
        degreeRequirement: { level: "required", raw: "Bachelor's required" },
      }),
      userProfile,
    );
    expect(strict.strictNewGradPipeline).toBe(true);
    expect(strict.newGradPenalty).toBe(true);
    expect(strict.earlyCareerFriendlyRole).toBe(false);
  });

  it("flags startup founding mismatch", () => {
    const rules = evaluateRules(makeJob({ title: "Founding Engineer", requirements: ["first engineer at startup"] }), userProfile);
    expect(rules.startupFounderMismatch).toBe(true);
  });

  it("flags vagueEarlyStageAiCalibration for thin entry-level AI startup JD", () => {
    const rules = evaluateRules(
      makeJob({
        company: "StealthCo",
        title: "AI Engineer Intern",
        yearsExperience: { min: 0, max: 2 },
        stack: ["Python"],
        responsibilities: ["Support AI initiatives.", "Ship small features."],
        requirements: [],
        rawText:
          "Remote (US). Seed startup. Generative AI product for SMBs. Great culture. Fast learners welcome.",
        location: "Remote (US)",
      }),
      userProfile,
    );
    expect(rules.vagueEarlyStageAiCalibration).toBe(true);
    expect(rules.notes.some((n) => /generic-posting inflation/i.test(n))).toBe(true);
  });

  it("sets fdeBuilderSoftwarePrimary for forward deployed title without external customer implementation core", () => {
    const rules = evaluateRules(
      makeJob({
        company: "Maple AI",
        title: "Forward Deployed Engineer",
        responsibilities: [
          "Ship internal sales tooling and AI workflows with TypeScript.",
          "Partner with sales and ops; hybrid NYC.",
        ],
        rawText: "Founding team. LLM and RAG valued.",
      }),
      userProfile,
    );
    expect(rules.fdeBuilderSoftwarePrimary).toBe(true);
    expect(rules.notes.some((n) => /forward-deployed/i.test(n))).toBe(true);
  });

  it("flags explicit core Java requirement at Spotify vs TypeScript-first profile", () => {
    const rules = evaluateRules(
      makeJob({
        company: "Spotify",
        title: "Backend Engineer, Artist-First AI Music Lab",
        stack: ["Java"],
        responsibilities: [
          "You have experience developing backend systems using Java.",
          "Ship LLM-powered features for creators.",
        ],
        rawText: "Applied AI and RAG for music discovery.",
      }),
      userProfile,
    );
    expect(rules.matureStructuredEmployer).toBe(true);
    expect(rules.explicitCoreLanguageMismatch).toBe(true);
    expect(rules.explicitCoreLanguage).toBe("java");
    expect(rules.hardRuleNotes?.some((n) => /explicit java/i.test(n))).toBe(true);
  });
});
