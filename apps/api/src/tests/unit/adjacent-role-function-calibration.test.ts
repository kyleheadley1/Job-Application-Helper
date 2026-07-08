import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { evaluateDifferentiatorCoverage } from "../../lib/differentiatorCoverage.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import { classifyRoleFunction, hasSiePrimaryResumeSignal } from "../../lib/roleFunctionClassifier.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { ScoreBreakdown } from "../../types/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

const PATHPOINT_JOB: ExtractedJobData = {
  company: "Pathpoint",
  title: "Technical Implementation Analyst",
  location: "Remote",
  remoteType: "remote",
  stack: ["REST API", "Salesforce", "Insurance", "Postman"],
  requiredSkills: ["requirements documentation", "QA test plans", "REST API validation"],
  domainTags: ["insurance", "insurtech"],
  responsibilities: [
    "Gather business requirements and author functional requirements documentation",
    "Create QA test plans and coordinate UAT with business stakeholders",
    "Validate REST API integrations against carrier specifications",
    "Support implementation rollout and stakeholder coordination across insurance partners",
  ],
  requirements: [
    "Experience writing requirements documentation and test plans",
    "Comfort coordinating technical and business stakeholders",
    "Ability to validate API integrations during implementation",
    "Insurance or regulated-industry experience preferred",
  ],
  rawText: `
Pathpoint — Technical Implementation Analyst
Insurance distribution platform implementation role.
Author requirements docs, QA test plans, and stakeholder coordination.
Validate REST API integrations; support implementation testing and UAT.
  `.trim(),
};

const QA_WOLF_JOB: ExtractedJobData = {
  company: "QA Wolf",
  title: "QA Engineer",
  location: "Remote",
  remoteType: "remote",
  stack: ["Playwright", "Cypress", "API testing", "Postman"],
  requiredSkills: ["manual testing", "test automation", "bug reports"],
  domainTags: ["qa", "testing as a service"],
  responsibilities: [
    "Execute manual and automated test plans for customer web applications",
    "File detailed bug reports and coordinate with client engineering teams",
    "Maintain regression suites in Playwright and Cypress",
  ],
  requirements: [
    "QA Wolf provides managed quality assurance services to software teams",
    "Strong test plan authoring and bug reporting skills",
    "Experience with API testing and Postman",
  ],
  rawText: `
QA Wolf — QA Engineer
Testing as a service for customer engineering teams.
Write test plans, run regression suites, validate APIs with Postman.
  `.trim(),
};

const SCALENCE_JOB: ExtractedJobData = {
  company: "Scalence",
  title: "Implementation Analyst",
  location: "Remote",
  remoteType: "remote",
  stack: ["Salesforce", "Jira", "REST API"],
  requiredSkills: ["implementation support", "requirements gathering", "UAT"],
  domainTags: ["professional services", "implementation"],
  responsibilities: [
    "Support enterprise customer implementations and configuration testing",
    "Document business requirements and implementation workflows",
    "Coordinate UAT and stakeholder sign-off across customer teams",
  ],
  requirements: [
    "Implementation analyst experience with enterprise SaaS rollouts",
    "Strong requirements documentation and cross-functional coordination",
    "Comfort validating integrations during implementation",
  ],
  rawText: `
Scalence — Implementation Analyst
Enterprise implementation support, requirements documentation, UAT coordination.
Validate REST API integrations during customer rollout.
  `.trim(),
};

/** Inflated LLM-ish raw scores before adjacent-role caps (Pathpoint ~85 capability). */
const INFLATED_ADJACENT_RAW: ScoreBreakdown = {
  stackFit: 18,
  levelFit: 16,
  domainFit: 8,
  resumeStoryClarity: 9,
  functionalOverlap: 13,
  recruiterFriendliness: 11,
  careerValue: 8,
  total: 0,
};

function scoreAdjacentJob(extracted: ExtractedJobData) {
  const rules = evaluateRules(extracted, userProfile, { activeResumeType: "SWE" });
  const clamped = applyScoringClampLayer({
    score: INFLATED_ADJACENT_RAW,
    extracted,
    rules,
  });
  const composite = computeCompositeScore({
    rawScore: clamped.score,
    rules: clamped.rules,
    extracted,
    profile: userProfile,
    resumeText: SWE_RESUME,
  });
  const display = buildScoreDisplay({
    score: composite.score,
    rules: clamped.rules,
    extracted,
    recommendation: composite.recommendation,
  });
  return { composite, display, rules: clamped.rules };
}

describe("adjacent role-function classifier", () => {
  it("detects Pathpoint implementation analyst shape", () => {
    const classification = classifyRoleFunction(PATHPOINT_JOB);
    expect(classification.detected).toBe(true);
    expect(classification.kind).toBe("implementation_analyst");
    expect(classification.note).toMatch(/outside core SWE lane/i);
  });

  it("does not count API-validation-only tokens as strong backend differentiators", () => {
    const coverage = evaluateDifferentiatorCoverage(PATHPOINT_JOB);
    expect(coverage.tier).not.toBe("strong");
    expect(coverage.matchedTags).not.toContain("api");
    expect(coverage.matchedTags).not.toContain("rest api");
  });

  it("Pathpoint capability drops to high 60s/low 70s and final lands in the 60s", () => {
    const { composite, display, rules } = scoreAdjacentJob(PATHPOINT_JOB);

    expect(rules.adjacentRoleFunction).toBe(true);
    expect(composite.score.capability).toBeGreaterThanOrEqual(68);
    expect(composite.score.capability).toBeLessThanOrEqual(72);
    expect(composite.score.capabilityBreakdown?.functionalOverlap).toBeLessThanOrEqual(20);
    expect(composite.score.roleFunctionCapNote).toMatch(/outside core SWE lane/i);
    expect(display?.final ?? 0).toBeGreaterThanOrEqual(60);
    expect(display?.final ?? 0).toBeLessThanOrEqual(69);
    expect(["stretch_signal", "skip"]).toContain(composite.recommendation);
    expect(display?.bandHeadline).not.toBe("Yes");
  });

  it("treats SIE-primary solutions roles as adjacent when not builder-first", () => {
    const solutionsJob: ExtractedJobData = {
      ...PATHPOINT_JOB,
      title: "Solutions Engineer",
      responsibilities: [
        "Lead customer onboarding workshops and technical solution design",
        "Coordinate enterprise implementation timelines with external clients",
      ],
    };
    expect(hasSiePrimaryResumeSignal(solutionsJob)).toBe(true);
    expect(classifyRoleFunction(solutionsJob).detected).toBe(true);
  });

  it("caps QA Wolf QA-as-product role", () => {
    const { composite } = scoreAdjacentJob(QA_WOLF_JOB);
    expect(classifyRoleFunction(QA_WOLF_JOB).detected).toBe(true);
    expect(composite.score.capability).toBeLessThanOrEqual(72);
    expect(composite.score.capabilityBreakdown?.functionalOverlap).toBeLessThanOrEqual(20);
  });

  it("caps Scalence implementation analyst role", () => {
    const { composite } = scoreAdjacentJob(SCALENCE_JOB);
    expect(classifyRoleFunction(SCALENCE_JOB).detected).toBe(true);
    expect(composite.score.capability).toBeLessThanOrEqual(72);
    expect(composite.score.capabilityBreakdown?.functionalOverlap).toBeLessThanOrEqual(20);
  });
});
