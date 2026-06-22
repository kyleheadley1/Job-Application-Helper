import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../app.js";
import { topJobsRepository } from "../../services/topJobs/topJobs.repository.js";

vi.mock("../../services/topJobs/topJobsSync.js", () => ({
  runTopJobsSync: vi.fn(async () => ({
    fetched: 10,
    preFiltered: 3,
    triaged: 2,
    stored: 1,
    skippedExisting: 0,
    source: "jobsbase",
    jsearchCreditsUsed: 0,
  })),
  promoteTopJobToTracker: vi.fn(),
  TopJobsSyncCooldownError: class extends Error {},
}));

describe("top jobs routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/top-jobs returns list sorted by repository", async () => {
    vi.spyOn(topJobsRepository, "list").mockResolvedValue([
      {
        id: "job-1",
        source: "jsearch",
        externalId: "ext-1",
        applyUrl: "https://example.com/apply",
        sourcePostedAt: "2026-06-03T00:00:00.000Z",
        sourceUpdatedAt: "2026-06-03T00:00:00.000Z",
        lastSyncedAt: "2026-06-03T01:00:00.000Z",
        extracted: {
          company: "Acme",
          title: "Software Engineer",
          remoteType: "remote",
          stack: [],
          requiredSkills: [],
          preferredSkills: [],
          domainTags: [],
          responsibilities: [],
          requirements: [],
        },
        rules: {
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
        },
        score: {
          stackFit: 15,
          levelFit: 18,
          domainFit: 8,
          resumeStoryClarity: 9,
          functionalOverlap: 12,
          recruiterFriendliness: 12,
          careerValue: 8,
          total: 82,
        },
        recommendation: "yes",
        topMatch: "TypeScript fit",
        mainRisk: "None major",
        rationale: ["Good fit"],
        recommendedResume: "SWE",
        resumeRationale: ["Strong TypeScript overlap"],
      },
    ]);

    const res = await request(app).get("/api/top-jobs");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].score.total).toBe(82);
  });

  it("GET /api/top-jobs/sync/status returns quota info", async () => {
    vi.spyOn(topJobsRepository, "getSyncStatus").mockResolvedValue({
      lastSyncAt: null,
      lastManualSyncAt: null,
      lastSyncStats: null,
      lastSyncError: null,
      jsearchCreditsUsedThisMonth: 4,
      jsearchCreditsRemaining: 176,
      jsearchMonthlyCap: 180,
      manualRefreshCooldownMin: 60,
      canManualRefresh: true,
      manualRefreshAvailableAt: null,
    });

    const res = await request(app).get("/api/top-jobs/sync/status");
    expect(res.status).toBe(200);
    expect(res.body.jsearchCreditsRemaining).toBe(176);
  });
});
