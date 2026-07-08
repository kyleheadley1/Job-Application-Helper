import { describe, expect, it } from "vitest";
import { userProfile } from "../../config/userProfile.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import {
  applyDifferentiatorCoverageCap,
  countDifferentiatorTags,
  evaluateDifferentiatorCoverage,
} from "../../lib/differentiatorCoverage.js";
import { buildScoreDisplay, computeCapabilityBreakdown } from "../../lib/scoreDisplayModel.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { RuleEvaluation, ScoreBreakdown } from "../../types/scoring.js";

const cleanRules = (): RuleEvaluation => ({
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
});

const FRONTEND_ONLY_JOB: ExtractedJobData = {
  company: "UI Co",
  title: "Frontend Engineer",
  location: "Remote",
  remoteType: "remote",
  stack: ["React", "TypeScript", "Tailwind"],
  requiredSkills: ["React", "TypeScript"],
  preferredSkills: ["Tailwind", "MUI"],
  domainTags: ["product"],
  responsibilities: ["Build customer-facing React components and TypeScript UI"],
  requirements: ["Strong React and TypeScript experience", "CSS/Tailwind proficiency"],
  rawText: `
Frontend Engineer — React/TypeScript
Build polished customer-facing UI with React, TypeScript, and Tailwind.
  `.trim(),
};

/** Raw scores that scale to ~30/35 stack + functional before caps. */
const HIGH_FRONTEND_RAW: ScoreBreakdown = {
  stackFit: 17,
  levelFit: 17,
  domainFit: 8,
  resumeStoryClarity: 9,
  functionalOverlap: 17,
  recruiterFriendliness: 12,
  careerValue: 8,
  total: 0,
};

const FULL_STACK_JOB: ExtractedJobData = {
  ...FRONTEND_ONLY_JOB,
  title: "Full Stack Engineer",
  stack: ["TypeScript", "React", "Node.js", "Express", "OpenAI"],
  requirements: [
    "TypeScript/React frontend",
    "Node.js/Express backend APIs",
    "RAG and LLM integrations",
  ],
  rawText: `
Full-stack role: React frontend, Node/Express backend APIs, RAG/LLM features, webhooks.
  `.trim(),
};

describe("differentiator coverage detection", () => {
  it("does not treat work authorization language as auth differentiator", () => {
    const blob =
      "Must be legally authorized to work in the United States. React and TypeScript required.";
    const { matchedTags } = countDifferentiatorTags(blob);
    expect(matchedTags).not.toContain("auth");
    expect(matchedTags).not.toContain("authentication");
  });

  it("frontend-only JD → none tier", () => {
    const coverage = evaluateDifferentiatorCoverage(FRONTEND_ONLY_JOB);
    expect(coverage.tier).toBe("none");
    expect(coverage.note).toMatch(/none — (generic stack match|frontend-only role)/i);
  });

  it("backend/AI JD → strong tier", () => {
    const coverage = evaluateDifferentiatorCoverage(FULL_STACK_JOB);
    expect(coverage.tier).toBe("strong");
    expect(coverage.matchCount).toBeGreaterThanOrEqual(3);
  });
});

describe("differentiator coverage caps", () => {
  it("caps stackFit and functionalOverlap at 22 when no differentiators", () => {
    const base = computeCapabilityBreakdown(HIGH_FRONTEND_RAW);
    expect(base.stackFit).toBeGreaterThanOrEqual(29);
    expect(base.functionalOverlap).toBeGreaterThanOrEqual(29);

    const { breakdown, coverage } = applyDifferentiatorCoverageCap(base, FRONTEND_ONLY_JOB);
    expect(coverage.tier).toBe("none");
    expect(breakdown.stackFit).toBe(22);
    expect(breakdown.functionalOverlap).toBe(22);
    expect(breakdown.levelFit).toBe(base.levelFit);
  });

  it("frontend-only role lands in high 70s capability, not high 80s", () => {
    const composite = computeCompositeScore({
      rawScore: HIGH_FRONTEND_RAW,
      rules: cleanRules(),
      extracted: FRONTEND_ONLY_JOB,
      profile: userProfile,
    });

    expect(composite.score.capability).toBeGreaterThanOrEqual(68);
    expect(composite.score.capability).toBeLessThanOrEqual(79);
    expect(composite.score.differentiatorCoverageNote).toMatch(
      /none — (generic stack match|frontend-only role)/i,
    );

    const display = buildScoreDisplay({
      score: composite.score,
      rules: cleanRules(),
      extracted: FRONTEND_ONLY_JOB,
      recommendation: composite.recommendation,
    });
    expect(display?.differentiatorCoverageNote).toMatch(
      /generic stack match|frontend-only role/i,
    );
  });
});
