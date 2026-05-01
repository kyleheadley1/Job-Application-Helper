import { describe, expect, it } from "vitest";
import {
  applyAppliedAiStackFunctionalCalibration,
  applyAppliedAiDomainFloor,
  extractMaxTravelPercent,
  jdHasAppliedAiSystemsOverlap,
  polishRisksAndMain,
  profileHasAiToolingEvidence,
  sanitizeNarrativeSentence,
  travelRiskLine,
} from "../../lib/scoringOutputPolish.js";
import { userProfile } from "../../config/userProfile.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { RuleEvaluation } from "../../types/scoring.js";

const baseRules = (): RuleEvaluation => ({
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
  penaltyVector: {},
});

describe("scoringOutputPolish", () => {
  it("detects travel 25%+ and builds risk line", () => {
    expect(extractMaxTravelPercent("travel 25% - 50% for customer visits")).toBe(50);
    expect(travelRiskLine("expect 30% travel annually")).toBeDefined();
    expect(travelRiskLine("occasional travel under 20%")).toBeUndefined();
  });

  it("always surfaces JD travel ranges (including under 25%) as a practical risk line", () => {
    const jd = "Role requires travel 10–20% for quarterly onsite reviews.";
    expect(extractMaxTravelPercent(jd)).toBe(20);
    expect(travelRiskLine(jd)).toMatch(/Travel requirement \(10[-–]20%\).*may be a constraint/i);
  });

  it("raises domain floor when JD and profile show applied AI overlap", () => {
    const extracted: ExtractedJobData = {
      company: "Co",
      title: "AI Engineer",
      stack: ["Python"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: ["LLM and RAG systems"],
      requirements: [],
      rawText: "Build agents and retrieval pipelines for customer AI.",
    };
    const score = {
      stackFit: 20,
      levelFit: 10,
      domainFit: 4,
      resumeStoryClarity: 10,
      functionalOverlap: 8,
      recruiterFriendliness: 10,
      careerValue: 8,
      total: 70,
    };
    const next = applyAppliedAiDomainFloor({
      score,
      extracted,
      userProfile,
      rules: baseRules(),
    });
    expect(next.domainFit).toBeGreaterThanOrEqual(7);
    expect(next.total).toBeGreaterThanOrEqual(score.total);
  });

  it("does not raise domain when rules flag domain mismatch", () => {
    const rules = { ...baseRules(), domainMismatch: true };
    const extracted: ExtractedJobData = {
      company: "Co",
      title: "AI Engineer",
      stack: [],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: ["LLM work"],
      requirements: [],
      rawText: "LLM and RAG",
    };
    const score = {
      stackFit: 15,
      levelFit: 10,
      domainFit: 4,
      resumeStoryClarity: 10,
      functionalOverlap: 8,
      recruiterFriendliness: 10,
      careerValue: 8,
      total: 65,
    };
    const next = applyAppliedAiDomainFloor({ score, extracted, userProfile, rules });
    expect(next.domainFit).toBe(4);
  });

  it("prioritizes travel and stack over vague enterprise domain risk", () => {
    const extracted: ExtractedJobData = {
      company: "Co",
      title: "Engineer",
      stack: [],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: [],
      rawText: "Python primary. 25-40% travel.",
    };
    const { mainRisk, risks } = polishRisksAndMain({
      mainRisk: "Limited enterprise domain expertise vs Fortune 500 customers.",
      risks: ["Python is the primary language while profile leads with TypeScript.", "Role expects staff-level ownership of ML platform."],
      extracted,
      travelLine: travelRiskLine("python primary 25-40% travel to clients"),
      max: 2,
    });
    expect(mainRisk.toLowerCase()).not.toContain("enterprise domain");
    expect([mainRisk, ...risks].some((r) => /python|typescript|travel/i.test(r))).toBe(true);
  });

  it("profile AI tooling detection matches user profile", () => {
    expect(profileHasAiToolingEvidence(userProfile)).toBe(true);
    expect(jdHasAppliedAiSystemsOverlap("rag and llm workflows")).toBe(true);
  });

  it("raises stack and functional for applied-AI JDs with compensating API/LLM overlap", () => {
    const extracted: ExtractedJobData = {
      company: "Co",
      title: "AI Engineer",
      stack: ["Python", "TypeScript"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: ["RAG pipelines", "REST APIs", "customer-facing AI"],
      requirements: [],
      rawText:
        "Build LLM applications with retrieval, agents, and integrations. Iterate on production AI workflows end-to-end.",
    };
    const score = {
      stackFit: 14,
      levelFit: 10,
      domainFit: 8,
      resumeStoryClarity: 11,
      functionalOverlap: 7,
      recruiterFriendliness: 11,
      careerValue: 8,
      total: 69,
    };
    const next = applyAppliedAiStackFunctionalCalibration({
      score,
      extracted,
      userProfile,
      rules: baseRules(),
    });
    expect(next.stackFit).toBeGreaterThanOrEqual(16);
    expect(next.functionalOverlap).toBeGreaterThanOrEqual(8);
    expect(next.total).toBeGreaterThanOrEqual(score.total);
  });

  it("injects production-AI ownership stretch risk as third item when JD matches", () => {
    const extracted: ExtractedJobData = {
      company: "Co",
      title: "AI Engineer",
      stack: [],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: [],
      rawText:
        "Customer-facing production AI systems. LLM and RAG. 30% travel to clients.",
    };
    const { mainRisk, risks } = polishRisksAndMain({
      mainRisk: "Python is the primary language while profile leads with TypeScript.",
      risks: [],
      extracted,
      travelLine: travelRiskLine(extracted.rawText ?? ""),
      max: 3,
    });
    const all = [mainRisk, ...risks];
    expect(all).toHaveLength(3);
    expect(all.some((r) => /production ai ownership|potential mismatch/i.test(r))).toBe(true);
    expect(all.some((r) => /travel/i.test(r))).toBe(true);
  });

  it("sanitizeNarrativeSentence strips trailing commas and expands thin applied-AI fragments", () => {
    expect(sanitizeNarrativeSentence("Strong applied-AI product fit from LLM/RAG and API work,")).not.toMatch(/,$/);
    const expanded = sanitizeNarrativeSentence("Strong applied-AI fit from LLM/RAG work,");
    expect(expanded.length).toBeGreaterThan(55);
    expect(expanded).toMatch(/end-to-end|workflow experience|integration/i);
  });
});
