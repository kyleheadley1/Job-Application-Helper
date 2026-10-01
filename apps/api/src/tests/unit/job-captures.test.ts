import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobCapture } from "../../services/captures/captures.repository.js";
import type { JobRecord } from "../../types/job.js";

const triageJobMock = vi.fn();
const store = new Map<string, JobCapture>();

vi.mock("../../agents/jobAgent/orchestrator.js", () => ({
  triageJob: (...args: unknown[]) => triageJobMock(...args),
}));

vi.mock("../../services/jobs/jobs.repository.js", () => ({
  jobsRepository: {
    getById: vi.fn(async () => null),
    upsertJob: vi.fn(async (record: unknown) => record),
    deleteById: vi.fn(async () => false),
  },
}));

vi.mock("../../services/captures/captures.repository.js", () => ({
  capturesRepository: {
    insert: vi.fn(async (c: JobCapture) => {
      store.set(c.id, { ...c });
      return c;
    }),
    getById: vi.fn(async (id: string) => store.get(id) ?? null),
    findByJobId: vi.fn(
      async (jobId: string) => [...store.values()].find((c) => c.jobId === jobId) ?? null,
    ),
    findActiveDuplicate: vi.fn(
      async (p: { jdTextHash: string; normalizedSourceUrl?: string }) =>
        [...store.values()]
          .filter((c) => ["queued", "scoring", "complete"].includes(c.status))
          .find(
            (c) =>
              c.jdTextHash === p.jdTextHash ||
              (p.normalizedSourceUrl != null && c.normalizedSourceUrl === p.normalizedSourceUrl),
          ) ?? null,
    ),
    update: vi.fn(async (id: string, patch: Partial<JobCapture>) => {
      const prev = store.get(id);
      if (!prev) return null;
      const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
      store.set(id, next);
      return next;
    }),
    listRecent: vi.fn(async (limit: number) => [...store.values()].slice(-limit).reverse()),
    listUnfinished: vi.fn(async () =>
      [...store.values()].filter((c) => c.status === "queued" || c.status === "scoring"),
    ),
    deleteByJobId: vi.fn(async () => false),
  },
}));

import { app } from "../../app.js";
import { env } from "../../config/env.js";
import { capturesService, normalizeSourceUrl } from "../../services/captures/captures.service.js";

const TOKEN = "test-extension-token";
const originalToken = env.extensionApiToken;
const auth = { Authorization: `Bearer ${TOKEN}` };

const JD_TEXT = `Software Engineer at Acme.
We build internal tools with TypeScript, Node.js, and React for operations teams.
Requirements: 2+ years of professional software experience, strong API design fundamentals,
and comfort working with product managers in ambiguous problem spaces. Remote in the USA.`;

const scoredJob = (overrides: Partial<JobRecord> = {}): JobRecord =>
  ({
    id: "job-from-capture",
    extracted: {
      company: "Acme",
      companyDisplayName: "Acme",
      title: "Software Engineer",
      rawText: JD_TEXT,
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
      stackFit: 16,
      levelFit: 16,
      domainFit: 7,
      resumeStoryClarity: 8,
      functionalOverlap: 12,
      recruiterFriendliness: 10,
      careerValue: 7,
      total: 76,
      recommendationLabel: "Strong fit, good screen odds",
    },
    recommendation: "apply_cold",
    salaryAsk: {},
    recommendedResume: "SWE",
    resumeRationale: [],
    topMatch: "TypeScript product work",
    mainRisk: "Pool may be crowded",
    rationale: [],
    risks: [],
    generated: {},
    tracker: {},
    status: "to_review",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }) as JobRecord;

describe("/api/job-captures", () => {
  beforeEach(() => {
    store.clear();
    triageJobMock.mockReset();
    env.extensionApiToken = TOKEN;
  });

  afterAll(() => {
    env.extensionApiToken = originalToken;
  });

  it("rejects missing or wrong tokens with 401", async () => {
    const missing = await request(app).post("/api/job-captures").send({});
    expect(missing.status).toBe(401);
    const wrong = await request(app)
      .get("/api/job-captures")
      .set("Authorization", "Bearer nope");
    expect(wrong.status).toBe(401);
  });

  it("returns 503 when the server token is not configured", async () => {
    env.extensionApiToken = undefined;
    const res = await request(app).get("/api/job-captures").set(auth);
    expect(res.status).toBe(503);
  });

  it("rejects JD text that is too short", async () => {
    const res = await request(app)
      .post("/api/job-captures")
      .set(auth)
      .send({ jdText: "too short", captureMethod: "paste" });
    expect(res.status).toBe(400);
  });

  it("returns 202 immediately and moves queued -> scoring -> complete", async () => {
    let finishScoring!: (job: JobRecord) => void;
    triageJobMock.mockImplementation(
      () => new Promise<JobRecord>((resolve) => (finishScoring = resolve)),
    );

    const created = await request(app)
      .post("/api/job-captures")
      .set(auth)
      .send({
        sourceUrl: "https://example.com/jobs/123?utm_source=x",
        pageTitle: "Software Engineer",
        jdText: JD_TEXT,
        captureMethod: "selection",
      });
    expect(created.status).toBe(202);
    expect(created.body.status).toBe("queued");
    expect(created.body.deduped).toBe(false);
    const id = created.body.id as string;

    await vi.waitFor(() => expect(store.get(id)?.status).toBe("scoring"));
    const mid = await request(app).get(`/api/job-captures/${id}`).set(auth);
    expect(mid.body.status).toBe("scoring");
    expect(mid.body.summary).toBeUndefined();

    finishScoring(scoredJob());
    await capturesService.drain();

    const done = await request(app).get(`/api/job-captures/${id}`).set(auth);
    expect(done.body.status).toBe("complete");
    expect(done.body.jobId).toBe("job-from-capture");
    expect(done.body.summary).toMatchObject({
      company: "Acme",
      title: "Software Engineer",
      scoreTotal: 76,
      recommendedResume: "SWE",
    });
    expect(triageJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ rawText: JD_TEXT.trim() }),
    );
    expect(triageJobMock.mock.calls[0]![0]).not.toHaveProperty("url");
  });

  it("dedupes a repeat capture of the same JD text or URL", async () => {
    triageJobMock.mockResolvedValue(scoredJob());
    const first = await request(app)
      .post("/api/job-captures")
      .set(auth)
      .send({ sourceUrl: "https://example.com/jobs/9", jdText: JD_TEXT, captureMethod: "paste" });
    await capturesService.drain();

    const sameText = await request(app)
      .post("/api/job-captures")
      .set(auth)
      .send({ jdText: JD_TEXT, captureMethod: "selection" });
    expect(sameText.body.id).toBe(first.body.id);
    expect(sameText.body.deduped).toBe(true);

    const sameUrl = await request(app)
      .post("/api/job-captures")
      .set(auth)
      .send({
        sourceUrl: "https://example.com/jobs/9#apply",
        jdText: `${JD_TEXT}\nExtra footer text that differs.`,
        captureMethod: "container",
      });
    expect(sameUrl.body.id).toBe(first.body.id);
    expect(triageJobMock).toHaveBeenCalledTimes(1);

    const forced = await request(app)
      .post("/api/job-captures")
      .set(auth)
      .send({ jdText: JD_TEXT, captureMethod: "paste", force: true });
    expect(forced.body.id).not.toBe(first.body.id);
    await capturesService.drain();
    expect(triageJobMock).toHaveBeenCalledTimes(2);
  });

  it("marks the capture failed when scoring throws", async () => {
    triageJobMock.mockRejectedValue(new Error("LLM unavailable"));
    const created = await request(app)
      .post("/api/job-captures")
      .set(auth)
      .send({ jdText: JD_TEXT, captureMethod: "paste" });
    await capturesService.drain();
    const res = await request(app).get(`/api/job-captures/${created.body.id}`).set(auth);
    expect(res.body.status).toBe("failed");
    expect(res.body.error).toMatch(/LLM unavailable/);
  });

  it("resolves GET /api/jobs/:jobId through the persisted capture after a restart", async () => {
    triageJobMock.mockResolvedValue(scoredJob({ id: "captured-job-42" }));
    await request(app)
      .post("/api/job-captures")
      .set(auth)
      .send({ jdText: JD_TEXT, captureMethod: "paste" });
    await capturesService.drain();

    // The in-memory draft map never saw this job; only the capture document has it.
    const res = await request(app).get("/api/jobs/captured-job-42");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("captured-job-42");
    expect(res.body.tracked).toBe(false);
  });

  it("re-queues unfinished captures on startup", async () => {
    triageJobMock.mockResolvedValue(scoredJob({ id: "resumed-job" }));
    store.set("stuck", {
      id: "stuck",
      jdText: JD_TEXT,
      captureMethod: "paste",
      jdTextHash: "abc",
      status: "scoring",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await capturesService.resumeUnfinished()).toBe(1);
    await capturesService.drain();
    expect(store.get("stuck")?.status).toBe("complete");
    expect(store.get("stuck")?.jobId).toBe("resumed-job");
  });
});

describe("normalizeSourceUrl", () => {
  it("drops hash and tracking params and lowercases the host", () => {
    expect(normalizeSourceUrl("https://Jobs.Example.com/a/1/?utm_source=li&gh_src=x&id=5#top")).toBe(
      "https://jobs.example.com/a/1/?id=5",
    );
    expect(normalizeSourceUrl("chrome://extensions")).toBeUndefined();
    expect(normalizeSourceUrl("not a url")).toBeUndefined();
  });
});
