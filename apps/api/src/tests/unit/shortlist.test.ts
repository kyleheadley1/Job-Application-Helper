import { describe, expect, it } from "vitest";
import {
  APPLIED_SILENCE_DAYS,
  POSTING_FRESH_DAYS,
  POSTING_STALE_DAYS,
  SHORTLIST_FAVORABLE_POOL,
  SHORTLIST_MIN_FINAL,
  SHORTLIST_MIN_POOL,
} from "../../config/shortlistPolicy.js";
import {
  compareShortlistJobs,
  evaluateShortlist,
  jobFinalScore,
  shouldShortlist,
} from "../../lib/shortlist.js";
import {
  autoArchiveNote,
  daysSinceApplied,
  hasLoggedApplicationProgress,
  isInFlightApplication,
  shouldAutoArchiveAppliedJob,
} from "../../lib/trackerAutoArchive.js";
import { loadCalibrationFixture } from "../fixtures/calibrationAnchors.js";
import type { JobRecord } from "../../types/job.js";
import type { RuleEvaluation } from "../../types/scoring.js";

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

const daysAgo = (n: number): string => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

const baseJob = (overrides: Partial<JobRecord> = {}): JobRecord => {
  const traba = loadCalibrationFixture("trabaAppliedAi");
  return {
    id: "test-job",
    extracted: traba.extracted,
    rules: cleanRules(),
    score: {
      ...traba.storedCategoryScores,
      total: 80,
      capability: 79,
      survivability: 0.55,
      survivabilityBreakdown: { poolFriendliness: 0.88 },
      scoreDisplay: {
        final: 80,
        hardGates: [],
      },
    } as JobRecord["score"],
    recommendation: "referral_gated",
    salaryAsk: {},
    recommendedResume: "SWE",
    resumeRationale: [],
    topMatch: "",
    mainRisk: "",
    rationale: [],
    risks: [],
    generated: {},
    tracker: {},
    status: "to_review",
    createdAt: daysAgo(3),
    updatedAt: daysAgo(1),
    ...overrides,
  };
};

describe("shortlist policy constants", () => {
  it("exposes tunable thresholds", () => {
    expect(SHORTLIST_MIN_FINAL).toBe(78);
    expect(SHORTLIST_FAVORABLE_POOL).toBe(0.62);
    expect(SHORTLIST_MIN_POOL).toBe(0.55);
    expect(POSTING_FRESH_DAYS).toBe(21);
    expect(POSTING_STALE_DAYS).toBe(30);
    expect(APPLIED_SILENCE_DAYS).toBe(30);
  });
});

describe("evaluateShortlist", () => {
  it("includes Traba-like favorable-shape role on shortlist", () => {
    const job = baseJob();
    const eval_ = evaluateShortlist(job);
    expect(eval_.onShortlist).toBe(true);
    expect(eval_.sortGroup).toBe(0);
    expect(eval_.freshnessTier).toBe("fresh");
    expect(shouldShortlist(job)).toBe(true);
  });

  it("includes high-fit crowded pool lottery ticket with tag, sorted below best-shots", () => {
    const crowded = baseJob({
      score: {
        ...baseJob().score,
        total: 82,
        survivabilityBreakdown: { poolFriendliness: 0.35 },
        scoreDisplay: { final: 82, hardGates: [] },
      } as JobRecord["score"],
      referralPathwayAvailable: false,
    });
    const favorable = baseJob();

    const crowdedEval = evaluateShortlist(crowded);
    expect(crowdedEval.onShortlist).toBe(true);
    expect(crowdedEval.tag).toBe("high fit / crowded pool — referral recommended");
    expect(crowdedEval.sortGroup).toBe(1);

    expect(compareShortlistJobs(favorable, crowded)).toBeLessThan(0);
  });

  it("excludes hard-gated roles regardless of score", () => {
    const gated = baseJob({
      score: {
        ...baseJob().score,
        total: 90,
        scoreDisplay: { final: 25, hardGates: ["Role seniority/staff bar exceeds early-career profile."] },
      } as JobRecord["score"],
    });
    expect(evaluateShortlist(gated).onShortlist).toBe(false);
  });

  it("includes recent applied roles with qualifying score", () => {
    const applied = baseJob({
      status: "applied",
      createdAt: daysAgo(10),
      statusHistory: [
        {
          id: "h1",
          jobId: "test-job",
          fromStatus: "to_review",
          toStatus: "applied",
          createdAt: daysAgo(10),
        },
      ],
    });
    expect(evaluateShortlist(applied).onShortlist).toBe(true);
  });

  it("excludes rejected and lapsed roles", () => {
    expect(evaluateShortlist(baseJob({ status: "rejected" })).onShortlist).toBe(false);
    expect(evaluateShortlist(baseJob({ status: "lapsed" })).onShortlist).toBe(false);
  });

  it("uses spreadsheet discussed date when import createdAt is stale", () => {
    const imported = baseJob({
      status: "applied",
      createdAt: daysAgo(63),
      trackerSpreadsheet: { discussed: "6/16/26" },
    });
    expect(evaluateShortlist(imported).onShortlist).toBe(true);
    expect(evaluateShortlist(imported).daysSinceActivity).toBeLessThanOrEqual(20);
  });

  it("excludes roles applied 30+ days ago without referral path", () => {
    const stale = baseJob({
      createdAt: daysAgo(35),
    });
    expect(evaluateShortlist(stale).onShortlist).toBe(false);
    expect(evaluateShortlist(stale).daysSinceActivity).toBeGreaterThanOrEqual(35);
  });

  it("extends stale cutoff for referral-path roles", () => {
    const staleReferral = baseJob({
      createdAt: daysAgo(35),
      referralPathwayAvailable: true,
    });
    const eval_ = evaluateShortlist(staleReferral);
    expect(eval_.onShortlist).toBe(true);
    expect(eval_.freshnessTier).toBe("stale_referral");
    expect(eval_.tag).toBe("stale — referral path open");
  });

  it("excludes referral-path jobs beyond stale + extension window", () => {
    const tooOld = baseJob({
      createdAt: daysAgo(50),
      referralPathwayAvailable: true,
    });
    expect(evaluateShortlist(tooOld).onShortlist).toBe(false);
  });

  it("excludes favorable pool when final score is below threshold", () => {
    const highPoolLowScore = baseJob({
      status: "applied",
      score: {
        ...baseJob().score,
        total: 59,
        survivabilityBreakdown: { poolFriendliness: 0.76 },
        scoreDisplay: { final: 59, hardGates: [] },
      } as JobRecord["score"],
    });
    expect(evaluateShortlist(highPoolLowScore).onShortlist).toBe(false);
  });

  it("excludes referral path when final score is below threshold", () => {
    const referralLowFinal = baseJob({
      score: {
        ...baseJob().score,
        total: 72,
        survivabilityBreakdown: { poolFriendliness: 0.4 },
        scoreDisplay: { final: 72, hardGates: [] },
      } as JobRecord["score"],
      referralPathwayAvailable: true,
    });
    expect(evaluateShortlist(referralLowFinal).onShortlist).toBe(false);
  });
});

describe("tracker auto-archive", () => {
  it("auto-archives applied roles with 30+ days silence and no progress", () => {
    const appliedAt = daysAgo(45);
    const job = baseJob({
      status: "applied",
      statusHistory: [
        {
          id: "h1",
          jobId: "test-job",
          fromStatus: "to_review",
          toStatus: "applied",
          createdAt: appliedAt,
        },
      ],
    });
    const candidate = shouldAutoArchiveAppliedJob(job);
    expect(candidate).not.toBeNull();
    expect(candidate!.daysSinceApplied).toBeGreaterThan(APPLIED_SILENCE_DAYS);
    expect(autoArchiveNote(candidate!.daysSinceApplied)).toMatch(/no response/);
    expect(isInFlightApplication(job)).toBe(false);
  });

  it("does not auto-archive when interview progress is logged", () => {
    const appliedAt = daysAgo(45);
    const job = baseJob({
      status: "interviewing",
      statusHistory: [
        {
          id: "h1",
          jobId: "test-job",
          fromStatus: "to_review",
          toStatus: "applied",
          createdAt: appliedAt,
        },
        {
          id: "h2",
          jobId: "test-job",
          fromStatus: "applied",
          toStatus: "interviewing",
          createdAt: daysAgo(10),
        },
      ],
    });
    expect(hasLoggedApplicationProgress(job)).toBe(true);
    expect(shouldAutoArchiveAppliedJob(job)).toBeNull();
  });

  it("keeps recent applied roles in flight", () => {
    const appliedAt = daysAgo(10);
    const job = baseJob({
      status: "applied",
      statusHistory: [
        {
          id: "h1",
          jobId: "test-job",
          fromStatus: "to_review",
          toStatus: "applied",
          createdAt: appliedAt,
        },
      ],
    });
    expect(daysSinceApplied(job)).toBe(10);
    expect(isInFlightApplication(job)).toBe(true);
    expect(shouldAutoArchiveAppliedJob(job)).toBeNull();
  });
});

describe("jobFinalScore", () => {
  it("prefers scoreDisplay.final over legacy total", () => {
    const job = baseJob({
      score: { ...baseJob().score, total: 25, scoreDisplay: { final: 76, hardGates: [] } } as JobRecord["score"],
    });
    expect(jobFinalScore(job)).toBe(76);
  });
});
