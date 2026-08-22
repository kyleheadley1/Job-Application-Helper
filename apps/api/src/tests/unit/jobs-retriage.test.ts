import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRecord } from "../../types/job.js";

const triageJobMock = vi.fn();

vi.mock("../../agents/jobAgent/orchestrator.js", () => ({
  triageJob: (...args: unknown[]) => triageJobMock(...args),
}));

vi.mock("../../services/jobs/jobs.repository.js", () => ({
  jobsRepository: {
    getById: vi.fn(),
    upsertJob: vi.fn(),
  },
}));

import { jobsRepository } from "../../services/jobs/jobs.repository.js";
import { jobsService, JobNoJdSourceError } from "../../services/jobs/jobs.service.js";

const score62 = {
  stackFit: 10,
  levelFit: 10,
  domainFit: 7,
  resumeStoryClarity: 8,
  functionalOverlap: 10,
  recruiterFriendliness: 10,
  careerValue: 7,
  total: 62,
};

const score85 = {
  stackFit: 16,
  levelFit: 18,
  domainFit: 8,
  resumeStoryClarity: 9,
  functionalOverlap: 14,
  recruiterFriendliness: 12,
  careerValue: 8,
  total: 85,
};

const baseRules = (): JobRecord["rules"] => ({
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

const triageResult = (overrides: Partial<JobRecord> = {}): JobRecord => ({
  id: "draft-1",
  extracted: {
    company: "Acme",
    title: "Engineer",
    rawText: "Build internal AI tools with Claude Code.",
    stack: [],
    requiredSkills: [],
    preferredSkills: [],
    domainTags: [],
    responsibilities: [],
    requirements: [],
  },
  rules: baseRules(),
  score: score85,
  recommendation: "yes",
  salaryAsk: {},
  recommendedResume: "SWE",
  resumeRationale: [],
  topMatch: "Fresh match",
  mainRisk: "Fresh risk",
  rationale: [],
  risks: [],
  generated: {},
  tracker: {
    priority: "high",
    recommendedAction: "Apply with urgency",
    statusOutcome: "yes",
    shortlist: true,
    color: "green",
  },
  status: "to_review",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  scoreHistory: [{ scoredAt: "2026-01-02T00:00:00.000Z", score: score85, recommendation: "yes" }],
  ...overrides,
});

describe("jobsService.runRetriage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(jobsRepository.getById).mockResolvedValue(null);
    vi.mocked(jobsRepository.upsertJob).mockReset();
  });

  it("re-scores a draft job in place and clears generated assets", async () => {
    triageJobMock
      .mockResolvedValueOnce(
        triageResult({
          id: "draft-1",
          score: score62,
          recommendation: "selective_yes",
          topMatch: "Old match",
          generated: { coverLetter: "old letter" },
          scoreHistory: [{ scoredAt: "2026-01-01T00:00:00.000Z", score: score62, recommendation: "selective_yes" }],
        }),
      )
      .mockResolvedValueOnce(
        triageResult({
          id: "ignored",
          extracted: {
            company: "Unknown Company",
            title: "Engineer",
            companyDisplayName: "Unknown Company",
            rawText: "Build internal AI tools with Claude Code.",
            stack: [],
            requiredSkills: [],
            preferredSkills: [],
            domainTags: [],
            responsibilities: [],
            requirements: [],
          },
        }),
      );

    const seeded = await jobsService.runTriage({
      rawText: "Build internal AI tools with Claude Code.",
      companyHint: "Acme",
    });
    const { job, tracked } = await jobsService.runRetriage(seeded.id);

    expect(tracked).toBe(false);
    expect(job.id).toBe("draft-1");
    expect(job.score.total).toBe(85);
    expect(job.extracted.company).toBe("Acme");
    expect(job.extracted.companyDisplayName).toBe("Acme");
    expect(job.topMatch).toBe("Fresh match");
    expect(job.generated).toEqual({});
    expect(job.scoreHistory?.length).toBe(2);
    expect(triageJobMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rawText: "Build internal AI tools with Claude Code.",
        companyHint: "Acme",
        retriageFrom: expect.objectContaining({ id: "draft-1" }),
      }),
    );
  });

  it("persists re-score for tracked jobs via repository upsert", async () => {
    vi.mocked(jobsRepository.getById).mockResolvedValue(
      triageResult({
        id: "tracked-1",
        score: score62,
        recommendation: "selective_yes",
        status: "applied",
        generated: { coverLetter: "old" },
        trackerSpreadsheet: { latestScore: "62" },
        scoreHistory: [{ scoredAt: "2026-01-01T00:00:00.000Z", score: score62, recommendation: "selective_yes" }],
      }),
    );
    vi.mocked(jobsRepository.upsertJob).mockImplementation(async (record) => record);
    triageJobMock.mockResolvedValueOnce(triageResult({ id: "ignored" }));

    const { job, tracked } = await jobsService.runRetriage("tracked-1");

    expect(tracked).toBe(true);
    expect(jobsRepository.upsertJob).toHaveBeenCalled();
    expect(job.id).toBe("tracked-1");
    expect(job.score.total).toBe(85);
    expect(job.trackerSpreadsheet?.latestScore).toBe("85");
    expect(job.trackerSpreadsheet?.originalAltScore).toBe("62");
  });

  it("rejects re-triage when no JD source is stored", async () => {
    triageJobMock.mockResolvedValueOnce(
      triageResult({
        id: "draft-2",
        extracted: {
          company: "Acme",
          title: "Engineer",
          stack: [],
          requiredSkills: [],
          preferredSkills: [],
          domainTags: [],
          responsibilities: [],
          requirements: [],
        },
      }),
    );
    const seeded = await jobsService.runTriage({ rawText: "temporary" });
    await expect(jobsService.runRetriage(seeded.id)).rejects.toBeInstanceOf(JobNoJdSourceError);
  });
});
