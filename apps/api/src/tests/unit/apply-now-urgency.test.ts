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

const NOW = Date.parse("2026-07-13T12:00:00.000Z");
const CREATED_1H_AGO = "2026-07-13T11:00:00.000Z";
const CREATED_2D_AGO = "2026-07-11T12:00:00.000Z";

describe("parsePostedAtHoursAgo", () => {
  it("parses relative hours only when jobCreatedAt is recent", () => {
    expect(
      parsePostedAtHoursAgo(
        { rawText: "Posted 2 hours ago", jobCreatedAt: CREATED_1H_AGO },
        NOW,
      ),
    ).toBe(3);
    expect(parsePostedAtHoursAgo({ rawText: "Posted 2 hours ago" }, NOW)).toBeUndefined();
    expect(
      parsePostedAtHoursAgo(
        { rawText: "Posted 2 hours ago", jobCreatedAt: CREATED_2D_AGO },
        NOW,
      ),
    ).toBeUndefined();
  });

  it("parses ISO postedAt without needing createdAt", () => {
    const postedAt = "2026-07-13T09:00:00.000Z";
    expect(parsePostedAtHoursAgo({ postedAt }, NOW)).toBe(3);
  });

  it("returns undefined when unknown", () => {
    expect(parsePostedAtHoursAgo({ rawText: "Software Engineer remote" })).toBeUndefined();
  });
});

describe("evaluateApplyNowUrgency", () => {
  it("fires for favorable-shape + small employer + posted <6h on a fresh record", () => {
    expect(
      evaluateApplyNowUrgency({
        extracted: productSweJob(),
        rules: baseRules(),
        recommendation: "apply_cold",
        scoreBand: "apply",
        final: 78,
        jobCreatedAt: CREATED_1H_AGO,
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it("does not fire on stale relative chrome for old stored jobs", () => {
    expect(
      evaluateApplyNowUrgency({
        extracted: productSweJob(),
        rules: baseRules(),
        recommendation: "apply_cold",
        final: 78,
        jobCreatedAt: CREATED_2D_AGO,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("does not fire when posted >6h", () => {
    expect(
      evaluateApplyNowUrgency({
        extracted: productSweJob({ rawText: "Posted 12 hours ago\n11-50 employees\nTypeScript" }),
        rules: baseRules(),
        recommendation: "apply_cold",
        final: 78,
        jobCreatedAt: CREATED_1H_AGO,
        nowMs: NOW,
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
        jobCreatedAt: CREATED_1H_AGO,
        nowMs: NOW,
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
        jobCreatedAt: CREATED_1H_AGO,
        nowMs: NOW,
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
      jobCreatedAt: CREATED_1H_AGO,
    });
    // buildScoreDisplay uses Date.now(); pin via evaluate path already covered —
    // when createdAt is recent relative to real now this may flake; use ISO postedAt instead.
    const withIso = buildScoreDisplay({
      score: highScore(),
      rules: baseRules(),
      extracted: productSweJob({
        postedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        rawText: "NicheStartup — Software Engineer\n11-50 employees\nTypeScript React",
      }),
      recommendation: "apply_cold",
    });
    expect(withIso?.applyNowUrgency).toBe(true);
    expect(withIso?.applyNowUrgencyNote).toBe(APPLY_NOW_URGENCY_MESSAGE);
    expect(withIso?.final).toBe(highScore().total);
    expect(display?.final).toBe(highScore().total);
  });
});
