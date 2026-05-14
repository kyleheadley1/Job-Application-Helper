import { describe, expect, it } from "vitest";
import {
  applyAssociateEntryBackendPlatformCalibration,
  applyAppliedAiStackFunctionalCalibration,
  applyBackendApiInfraCalibration,
  applyAppliedAiDomainFloor,
  applyCredentialHeavyFintechAlgorithmCalibration,
  applyGoDistributedDataInfraCalibration,
  applyFoundingEngineerStretchCalibration,
  applyFintechGoPrimaryCalibration,
  applyFdeBuilderScoreCalibration,
  applyNytCareerValueCalibration,
  applyProductionCompetitiveHiringBarCalibration,
  applyResearchHeavyAiCalibration,
  applyVagueEarlyStageAiCalibration,
  appendCredentialedAccountingSystemsGuidance,
  appendGoDistributedDataInfraStretchGuidance,
  appendLotteryTicketGuidance,
  extractMaxTravelPercent,
  jdHasAppliedAiSystemsOverlap,
  jdIsStructurallyVague,
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
  fdeBuilderSoftwarePrimary: false,
  vagueEarlyStageAiCalibration: false,
  hardRuleNotes: [],
  pythonStackFlexibleWithJsTs: false,
  healthcareProductEngineering: false,
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

  it("skips applied-AI stack inflation when fdeBuilderSoftwarePrimary is set", () => {
    const extracted: ExtractedJobData = {
      company: "Maple AI",
      title: "Forward Deployed Engineer",
      stack: ["TypeScript", "Python"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: ["LLM and RAG workflows", "REST APIs", "internal tooling"],
      requirements: [],
      rawText: "Applied AI and retrieval for sales workflows.",
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
      rules: { ...baseRules(), fdeBuilderSoftwarePrimary: true },
    });
    expect(next).toEqual(score);
  });

  it("detects structurally vague applied-AI JDs", () => {
    const extracted: ExtractedJobData = {
      company: "StealthCo",
      title: "AI Engineer Intern",
      stack: ["Python"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: ["Support AI initiatives.", "Ship small features."],
      requirements: [],
      rawText: "Remote US seed startup. Generative AI. Fast learners.",
    };
    expect(jdHasAppliedAiSystemsOverlap(extracted.rawText ?? "")).toBe(true);
    expect(jdIsStructurallyVague(extracted)).toBe(true);
  });

  it("applyVagueEarlyStageAiCalibration trims inflated scores", () => {
    const inflated = {
      stackFit: 22,
      levelFit: 12,
      domainFit: 9,
      resumeStoryClarity: 14,
      functionalOverlap: 9,
      recruiterFriendliness: 13,
      careerValue: 9,
      total: 88,
    };
    const next = applyVagueEarlyStageAiCalibration({
      score: inflated,
      extracted: {
        company: "X",
        title: "AI",
        stack: [],
        requiredSkills: [],
        preferredSkills: [],
        domainTags: [],
        responsibilities: [],
        requirements: [],
      },
      rules: { ...baseRules(), vagueEarlyStageAiCalibration: true, stackMismatch: true },
    });
    expect(next.total).toBeLessThanOrEqual(84);
    expect(next.recruiterFriendliness).toBeLessThanOrEqual(10);
  });

  it("keeps backend/API roles with infra tooling in a non-collapsed stack band", () => {
    const extracted: ExtractedJobData = {
      company: "Plaid",
      title: "Backend Engineer",
      stack: ["Go", "Kubernetes", "Docker", "AWS", "Postgres"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: ["fintech"],
      responsibilities: [
        "Build backend systems and APIs for product features.",
        "Work with PM/design to solve customer problems.",
        "Test and debug reliable production systems.",
      ],
      requirements: [],
      rawText: "Ownership and collaboration across product teams.",
    };
    const score = {
      stackFit: 7,
      levelFit: 9,
      domainFit: 5,
      resumeStoryClarity: 12,
      functionalOverlap: 6,
      recruiterFriendliness: 11,
      careerValue: 10,
      total: 60,
    };
    const next = applyBackendApiInfraCalibration({
      score,
      extracted,
      rules: { ...baseRules(), backendProductApiRole: true, infraCoreRole: false },
    });
    expect(next.stackFit).toBeGreaterThanOrEqual(14);
    expect(next.functionalOverlap).toBeGreaterThanOrEqual(8);
    expect(next.levelFit).toBeGreaterThanOrEqual(12);
    expect(next.domainFit).toBeGreaterThanOrEqual(6);
  });

  it("applyFdeBuilderScoreCalibration caps inflated totals around the mid-80s", () => {
    const inflated = {
      stackFit: 22,
      levelFit: 14,
      domainFit: 9,
      resumeStoryClarity: 15,
      functionalOverlap: 10,
      recruiterFriendliness: 14,
      careerValue: 10,
      total: 94,
    };
    const next = applyFdeBuilderScoreCalibration({
      score: inflated,
      rules: { ...baseRules(), fdeBuilderSoftwarePrimary: true },
    });
    expect(next.total).toBeLessThanOrEqual(86);
    expect(next.stackFit).toBeLessThanOrEqual(20);
    expect(next.recruiterFriendliness).toBeLessThanOrEqual(12);
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

  it("keeps associate/entry backend-platform roles in an accessible band", () => {
    const extracted: ExtractedJobData = {
      company: "New York Times",
      title: "Core Software Engineer Associate",
      stack: ["TypeScript", "Node.js"],
      requiredSkills: [],
      preferredSkills: ["Go", "GraphQL", "Docker/Kubernetes", "Cloud deployments"],
      domainTags: [],
      responsibilities: ["Build backend services for publishing systems."],
      requirements: ["Familiarity with relational databases and backend systems."],
      rawText:
        "Associate role. Basic qualifications emphasize familiarity with backend systems, relational databases, and testing. Preferred: Go, GraphQL, cloud, Docker/Kubernetes.",
    };
    const next = applyAssociateEntryBackendPlatformCalibration({
      score: {
        stackFit: 14,
        levelFit: 11,
        domainFit: 7,
        resumeStoryClarity: 13,
        functionalOverlap: 7,
        recruiterFriendliness: 9,
        careerValue: 8,
        total: 69,
      },
      extracted,
      rules: baseRules(),
    });
    expect(next.levelFit).toBeGreaterThanOrEqual(13);
    expect(next.stackFit).toBeGreaterThanOrEqual(16);
    expect(next.total).toBeGreaterThanOrEqual(79);
    expect(next.total).toBeLessThanOrEqual(82);
  });

  it("boosts career/domain for NYT publishing-content roles", () => {
    const extracted: ExtractedJobData = {
      company: "New York Times",
      title: "Backend Engineer",
      stack: [],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: ["Build publishing and content platform services."],
      requirements: [],
      rawText: "Editorial tooling and content platform systems in NYC.",
    };
    const next = applyNytCareerValueCalibration({
      score: {
        stackFit: 16,
        levelFit: 13,
        domainFit: 6,
        resumeStoryClarity: 14,
        functionalOverlap: 8,
        recruiterFriendliness: 10,
        careerValue: 7,
        total: 74,
      },
      extracted,
      rules: baseRules(),
    });
    expect(next.careerValue).toBeGreaterThanOrEqual(9);
    expect(next.domainFit).toBeGreaterThanOrEqual(8);
  });

  it("pulls research-heavy AI roles into 55-60 with career value preserved", () => {
    const next = applyResearchHeavyAiCalibration({
      score: {
        stackFit: 17,
        levelFit: 11,
        domainFit: 8,
        resumeStoryClarity: 13,
        functionalOverlap: 9,
        recruiterFriendliness: 10,
        careerValue: 9,
        total: 77,
      },
      rules: { ...baseRules(), researchHeavyAiRole: true },
    });
    expect(next.total).toBeGreaterThanOrEqual(55);
    expect(next.total).toBeLessThanOrEqual(60);
    expect(next.stackFit).toBeLessThanOrEqual(11);
    expect(next.resumeStoryClarity).toBeLessThanOrEqual(9);
    expect(next.functionalOverlap).toBeLessThanOrEqual(6);
    expect(next.recruiterFriendliness).toBeLessThanOrEqual(6);
    expect(next.careerValue).toBeGreaterThanOrEqual(9);
  });

  it("calibrates fintech go-primary backend stretch into mid/upper 60s", () => {
    const extracted: ExtractedJobData = {
      company: "Imprint",
      title: "Software Engineer",
      stack: ["Go", "MySQL", "DynamoDB", "Microservices"],
      requiredSkills: ["Go is our primary backend language", "on-call ownership"],
      preferredSkills: [],
      domainTags: ["fintech", "payments"],
      responsibilities: ["Build microservices and provider integrations."],
      requirements: [],
      rawText:
        "Fintech payments backend role. Go is our primary backend language. Microservices, on-call, production troubleshooting, external provider integrations.",
    };
    const next = applyFintechGoPrimaryCalibration({
      score: {
        stackFit: 18,
        levelFit: 11,
        domainFit: 7,
        resumeStoryClarity: 14,
        functionalOverlap: 9,
        recruiterFriendliness: 10,
        careerValue: 9,
        total: 78,
      },
      extracted,
      rules: { ...baseRules(), fintechGoPrimaryStretch: true },
    });
    expect(next.total).toBeGreaterThanOrEqual(66);
    expect(next.total).toBeLessThanOrEqual(70);
    expect(next.stackFit).toBeGreaterThanOrEqual(14);
    expect(next.stackFit).toBeLessThanOrEqual(15);
    expect(next.resumeStoryClarity).toBeGreaterThanOrEqual(11);
    expect(next.resumeStoryClarity).toBeLessThanOrEqual(12);
    expect(next.domainFit).toBeGreaterThanOrEqual(4);
    expect(next.domainFit).toBeLessThanOrEqual(5);
    expect(next.functionalOverlap).toBeGreaterThanOrEqual(7);
    expect(next.functionalOverlap).toBeLessThanOrEqual(8);
  });

  it("calibrates founding engineer startup roles to high-alignment stretch band", () => {
    const extracted: ExtractedJobData = {
      company: "Sailor Health",
      title: "Founding Engineer",
      stack: ["TypeScript", "React", "Node.js", "PostgreSQL"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: ["healthcare"],
      responsibilities: ["Shape engineering culture and own major technical decisions."],
      requirements: ["4th engineer", "Build from scratch with high autonomy"],
      rawText:
        "Series A startup, 11-50 employees. Founding team role building healthcare AI workflows with limited mentorship.",
    };
    const next = applyFoundingEngineerStretchCalibration({
      score: {
        stackFit: 23,
        levelFit: 11,
        domainFit: 8,
        resumeStoryClarity: 15,
        functionalOverlap: 10,
        recruiterFriendliness: 10,
        careerValue: 10,
        total: 87,
      },
      extracted,
      rules: { ...baseRules(), foundingEngineerStretch: true },
    });
    expect(next.total).toBeGreaterThanOrEqual(77);
    expect(next.total).toBeLessThanOrEqual(79);
    expect(next.stackFit).toBeGreaterThanOrEqual(21);
    expect(next.stackFit).toBeLessThanOrEqual(23);
    expect(next.levelFit).toBeGreaterThanOrEqual(8);
    expect(next.levelFit).toBeLessThanOrEqual(9);
    expect(next.resumeStoryClarity).toBeGreaterThanOrEqual(13);
    expect(next.resumeStoryClarity).toBeLessThanOrEqual(14);
    expect(next.functionalOverlap).toBe(9);
    expect(next.recruiterFriendliness).toBeGreaterThanOrEqual(7);
    expect(next.recruiterFriendliness).toBeLessThanOrEqual(8);
    expect(next.careerValue).toBe(10);
  });

  it("calibrates credentialed accounting/fintech gate roles into a skip band and fixes headline copy", () => {
    const rules = { ...baseRules(), credentialHeavyFintechAlgorithm: true };
    const next = applyCredentialHeavyFintechAlgorithmCalibration({
      score: {
        stackFit: 20,
        levelFit: 12,
        domainFit: 8,
        resumeStoryClarity: 14,
        functionalOverlap: 9,
        recruiterFriendliness: 12,
        careerValue: 7,
        total: 92,
      },
      rules,
    });
    expect(next.total).toBeGreaterThanOrEqual(35);
    expect(next.total).toBeLessThanOrEqual(45);
    expect(next.recruiterFriendliness).toBeLessThanOrEqual(3);
    expect(next.levelFit).toBeLessThanOrEqual(6);
    expect(next.careerValue).toBeGreaterThanOrEqual(9);
    expect(appendCredentialedAccountingSystemsGuidance("generic overlap", { rules })).toMatch(
      /credentialed fintech\/accounting systems profile/i,
    );
    expect(appendLotteryTicketGuidance("headline", { score: next, rules })).toBe("headline");
  });

  it("caps competitive production-bar scores at 80 when profile lacks JD gate stack match", () => {
    const extracted: ExtractedJobData = {
      company: "LivePerson",
      title: "Software Engineer",
      stack: ["Python", "PostgreSQL", "NestJS"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: [],
      rawText: "2+ years professional experience. Python and PostgreSQL in production. Ownership of services.",
    };
    const next = applyProductionCompetitiveHiringBarCalibration({
      score: {
        stackFit: 22,
        levelFit: 12,
        domainFit: 8,
        resumeStoryClarity: 15,
        functionalOverlap: 10,
        recruiterFriendliness: 12,
        careerValue: 9,
        total: 88,
      },
      extracted,
      userProfile,
      rules: { ...baseRules(), productionBarCompetitivePool: true },
    });
    expect(next.total).toBeLessThanOrEqual(80);
    expect(next.recruiterFriendliness).toBeLessThanOrEqual(8);
  });

  it("calibrates Go/data-infra stretch roles into a low-50s skip band", () => {
    const rules = { ...baseRules(), goDistributedDataInfraCandidateGap: true };
    const next = applyGoDistributedDataInfraCalibration({
      score: {
        stackFit: 18,
        levelFit: 12,
        domainFit: 7,
        resumeStoryClarity: 14,
        functionalOverlap: 9,
        recruiterFriendliness: 11,
        careerValue: 8,
        total: 79,
      },
      rules,
    });
    expect(next.total).toBeGreaterThanOrEqual(48);
    expect(next.total).toBeLessThanOrEqual(55);
    expect(next.stackFit).toBeGreaterThanOrEqual(6);
    expect(next.stackFit).toBeLessThanOrEqual(10);
    expect(next.levelFit).toBeLessThanOrEqual(8);
    expect(next.recruiterFriendliness).toBeLessThanOrEqual(6);
    expect(appendGoDistributedDataInfraStretchGuidance("Strong TypeScript API fit.", { rules })).toMatch(
      /low-fit backend\/data-infrastructure stretch/i,
    );
  });
});
