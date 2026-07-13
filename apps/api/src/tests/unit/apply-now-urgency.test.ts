import { describe, expect, it } from "vitest";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import {
  APPLY_NOW_URGENCY_MESSAGE,
  evaluateApplyNowUrgency,
  parsePostedAtHoursAgo,
} from "../../lib/postedAtFreshness.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { RuleEvaluation, ScoreBreakdown } from "../../types/scoring.js";

const baseRules = (): RuleEvaluation =>
  ({
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
    adjacentRoleFunction: false,
    platformInfraRole: false,
    notes: [],
  }) as RuleEvaluation;

const productSweJob = (overrides: Partial<ExtractedJobData> = {}): ExtractedJobData => ({
  company: "NicheStartup",
  title: "Software Engineer",
  location: "Remote",
  remoteType: "remote",
  companyEmployeeCount: 45,
  stack: ["TypeScript", "React", "Node.js"],
  requiredSkills: ["TypeScript", "React"],
  preferredSkills: [],
  domainTags: ["saas"],
  responsibilities: ["Build full-stack product features"],
  requirements: ["TypeScript"],
  rawText: `
NicheStartup — Software Engineer
Posted 2 hours ago
11-50 employees
Build full-stack TypeScript/React product features.
  `.trim(),
  ...overrides,
});

const highScore = (): ScoreBreakdown => ({
  stackFit: 17,
  levelFit: 16,
  domainFit: 8,
  resumeStoryClarity: 9,
  functionalOverlap: 14,
  recruiterFriendliness: 12,
  careerValue: 8,
  total: 84,
  capability: 84,
  survivability: 0.7,
});

describe("parsePostedAtHoursAgo", () => {
  it("parses relative hours from rawText", () => {
    expect(parsePostedAtHoursAgo({ rawText: "Posted 2 hours ago" })).toBe(2);
    expect(parsePostedAtHoursAgo({ rawText: "3 hours ago · Remote" })).toBe(3);
  });

  it("parses ISO postedAt", () => {
    const now = Date.parse("2026-07-13T12:00:00.000Z");
    const postedAt = "2026-07-13T09:00:00.000Z";
    expect(parsePostedAtHoursAgo({ postedAt }, now)).toBe(3);
  });

  it("returns undefined when unknown", () => {
    expect(parsePostedAtHoursAgo({ rawText: "Software Engineer remote" })).toBeUndefined();
  });
});

describe("evaluateApplyNowUrgency", () => {
  it("fires for favorable-shape + small employer + posted <6h", () => {
    expect(
      evaluateApplyNowUrgency({
        extracted: productSweJob(),
        rules: baseRules(),
        recommendation: "apply_cold",
        scoreBand: "apply",
        final: 78,
      }),
    ).toBe(true);
  });

  it("does not fire when posted >6h", () => {
    expect(
      evaluateApplyNowUrgency({
        extracted: productSweJob({ rawText: "Posted 12 hours ago\n11-50 employees\nTypeScript" }),
        rules: baseRules(),
        recommendation: "apply_cold",
        final: 78,
      }),
    ).toBe(false);
  });

  it("does not fire for large employers", () => {
    expect(
      evaluateApplyNowUrgency({
        extracted: productSweJob({
          company: "The New York Times",
          companyEmployeeCount: 10001,
          rawText: "Posted 1 hour ago\n10,001+ employees\nTypeScript React",
        }),
        rules: baseRules(),
        recommendation: "apply_cold",
        final: 78,
      }),
    ).toBe(false);
  });

  it("does not fire for adjacent roles", () => {
    expect(
      evaluateApplyNowUrgency({
        extracted: productSweJob(),
        rules: { ...baseRules(), adjacentRoleFunction: true },
        recommendation: "apply_cold",
        final: 68,
      }),
    ).toBe(false);
  });
});

describe("apply-now urgency on score display", () => {
  it("surfaces applyNowUrgencyNote without changing score math", () => {
    const display = buildScoreDisplay({
      score: highScore(),
      rules: baseRules(),
      extracted: productSweJob(),
      recommendation: "apply_cold",
    });
    expect(display?.applyNowUrgency).toBe(true);
    expect(display?.applyNowUrgencyNote).toBe(APPLY_NOW_URGENCY_MESSAGE);
    expect(display?.final).toBe(highScore().total);
  });
});
