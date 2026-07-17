import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../app.js";
import { jobsRepository } from "../../services/jobs/jobs.repository.js";
import { createMongoTestHarness } from "../support/mongo-test-db.js";

const STARTUP_RAW = `
Nimbus Labs — Software Engineer — Product (Seed-stage startup)
Remote (US). NYC-friendly hybrid optional.
Build customer-facing features with TypeScript, Node.js, React, and REST APIs.
Ship internal tools and AI-enabled workflows for operations teams.
Salary: 130000 USD - 160000 USD
`.trim();

const BAD_FIT_RAW = `
Heritage Payments — Software Engineer
Location: Hybrid, New York, NY
Build backend services in Java and TypeScript for transaction analytics.
1-3 years experience preferred.
Salary: 95000 USD - 125000 USD
`.trim();

const triage = async (rawText: string, companyHint: string) => {
  const res = await request(app).post("/api/jobs/triage").send({ rawText, companyHint, fullPrep: false });
  expect(res.status).toBe(200);
  const confirm = await request(app).post(`/api/jobs/${res.body.id}/confirm-applied`).send({});
  expect(confirm.status).toBe(200);
  return confirm.body as { id: string };
};

describe("tracker routes", () => {
  const mongo = createMongoTestHarness("tracker_routes");

  beforeAll(async () => {
    await mongo.start();
  });

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await jobsRepository.clearForTests();
  });

  it("PATCH /:id/status tracks transitions and updates color/shortlist", async () => {
    const created = await triage(STARTUP_RAW, "Nimbus Labs");

    const s1 = await request(app).patch(`/api/jobs/${created.id}/status`).send({
      status: "interviewing",
      note: "Recruiter screen passed",
    });
    expect(s1.status).toBe(200);
    expect(s1.body.status).toBe("interviewing");
    expect(s1.body.tracker.color).toBe("blue");
    expect(typeof s1.body.tracker.shortlist).toBe("boolean");
    expect(s1.body.statusHistory?.length).toBe(2);
    expect(s1.body.statusHistory?.[1]?.fromStatus).toBe("applied");
    expect(s1.body.statusHistory?.[1]?.toStatus).toBe("interviewing");
    expect(s1.body.statusHistory?.[1]?.note).toBe("Recruiter screen passed");

    const s2 = await request(app).patch(`/api/jobs/${created.id}/status`).send({
      status: "closed",
      note: "Role filled",
    });
    expect(s2.status).toBe(200);
    expect(s2.body.status).toBe("closed");
    expect(s2.body.tracker.color).toBe("red");
    expect(s2.body.tracker.shortlist).toBe(false);
    expect(s2.body.statusHistory?.length).toBe(3);
  });

  it("PATCH /:id/notes persists notes", async () => {
    const created = await triage(STARTUP_RAW, "Nimbus Labs");
    const updated = await request(app).patch(`/api/jobs/${created.id}/notes`).send({
      notes: "Applied via referral; waiting on recruiter.",
    });
    expect(updated.status).toBe(200);
    expect(updated.body.tracker.notes).toContain("Applied via referral");

    const got = await request(app).get(`/api/jobs/${created.id}`);
    expect(got.status).toBe(200);
    expect(got.body.tracker.notes).toContain("Applied via referral");
  });

  it("PATCH /:id/applied-at sets manual date applied and rewrites applied history", async () => {
    const created = await triage(STARTUP_RAW, "Nimbus Labs");
    const updated = await request(app).patch(`/api/jobs/${created.id}/applied-at`).send({
      appliedAt: "2026-07-10",
    });
    expect(updated.status).toBe(200);
    expect(updated.body.tracker.appliedAt).toBe("2026-07-10T12:00:00.000Z");
    expect(updated.body.status).toBe("applied");
    const appliedHistory = (updated.body.statusHistory ?? []).filter(
      (h: { toStatus: string }) => h.toStatus === "applied",
    );
    expect(appliedHistory.length).toBeGreaterThanOrEqual(1);
    expect(appliedHistory[0].createdAt).toBe("2026-07-10T12:00:00.000Z");

    const got = await request(app).get(`/api/jobs/${created.id}`);
    expect(got.status).toBe(200);
    expect(got.body.tracker.appliedAt).toBe("2026-07-10T12:00:00.000Z");
  });

  it("GET /api/jobs filters by status/shortlist/recommendation/resume/minScore/company", async () => {
    const high = await triage(STARTUP_RAW, "Nimbus Labs");
    const low = await triage(BAD_FIT_RAW, "Heritage Bank");

    const moved = await request(app).patch(`/api/jobs/${high.id}/status`).send({ status: "interviewing" });
    expect(moved.status).toBe(200);

    const byStatus = await request(app).get("/api/jobs").query({ status: "interviewing" });
    expect(byStatus.status).toBe(200);
    expect(byStatus.body.items.length).toBe(1);
    expect(byStatus.body.items[0].id).toBe(high.id);

    const byCompany = await request(app).get("/api/jobs").query({ company: "heritage" });
    expect(byCompany.status).toBe(200);
    expect(byCompany.body.items.length).toBe(1);
    expect(byCompany.body.items[0].id).toBe(low.id);

    const byMinScore = await request(app).get("/api/jobs").query({ minScore: 78 });
    expect(byMinScore.status).toBe(200);
    expect(byMinScore.body.items.every((i: { score: { total: number } }) => i.score.total >= 78)).toBe(true);

    const byShortlist = await request(app).get("/api/jobs").query({ shortlist: true });
    expect(byShortlist.status).toBe(200);
    expect(byShortlist.body.items.every((i: { tracker: { shortlist?: boolean } }) => i.tracker.shortlist)).toBe(true);
    expect(typeof byShortlist.body.shortlistTotal).toBe("number");
  });

  it("POST /refresh-shortlist removes legacy shortlist flags when score no longer qualifies", async () => {
    const { fixtureToJobRecord, loadCalibrationFixture } = await import(
      "../fixtures/calibrationAnchors.js"
    );
    const legacy = fixtureToJobRecord(loadCalibrationFixture("roAiEngineer"));
    legacy.id = "legacy-shortlist-test";
    legacy.status = "to_review";
    legacy.tracker = { ...legacy.tracker, shortlist: true };
    legacy.score = {
      ...legacy.score,
      total: 25,
      scoreDisplay: {
        final: 25,
        hardGates: ["Role seniority/staff bar exceeds early-career profile."],
      },
    };
    await jobsRepository.saveTriage(legacy);

    const refreshed = await request(app).post("/api/jobs/refresh-shortlist");
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.removed).toBeGreaterThanOrEqual(1);

    const got = await jobsRepository.getById(legacy.id);
    expect(got!.tracker.shortlist).toBe(false);

    const byShortlist = await request(app).get("/api/jobs").query({ shortlist: true });
    expect(byShortlist.body.items.some((i: { id: string }) => i.id === legacy.id)).toBe(false);
  });

  it("GET /api/jobs/export returns canonical 15-column tracker shape", async () => {
    await triage(STARTUP_RAW, "Nimbus Labs");
    const res = await request(app).get("/api/jobs/export");
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    const row = res.body.rows[0];
    expect(Object.keys(row)).toEqual([
      "Rank",
      "Discussed",
      "Company",
      "Role",
      "Latest Score",
      "Original / Alt Score",
      "Priority",
      "Recommended Action",
      "Status / Outcome",
      "Salary Ask",
      "JD Input",
      "Top Match",
      "Main Risk",
      "Notes",
      "Resume",
    ]);
    expect(row.Company).toEqual(expect.any(String));
    expect(row["Latest Score"]).toEqual(expect.any(String));
    expect(row.Resume).toMatch(/SWE|SIE|EARLY_CAREER/);
  });

  it("GET /api/jobs/export?format=csv returns CSV", async () => {
    await triage(STARTUP_RAW, "Nimbus Labs");
    const res = await request(app).get("/api/jobs/export").query({ format: "csv" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const header = String(res.text).split("\n")[0];
    expect(header).toBe(
      "Rank,Discussed,Company,Role,Latest Score,Original / Alt Score,Priority,Recommended Action,Status / Outcome,Salary Ask,JD Input,Top Match,Main Risk,Notes,Resume",
    );
  });

  it("status/notes updates preserve generated assets and score history", async () => {
    const created = await triage(STARTUP_RAW, "Nimbus Labs");
    await jobsRepository.mergeGeneratedAssets(created.id, {
      coverLetter: "hello",
      whyCompany: "because",
      emphasize: ["api-first"],
    });
    const before = await request(app).get(`/api/jobs/${created.id}`);
    expect(before.status).toBe(200);
    const scoreHistoryBefore = before.body.scoreHistory ?? [];

    const s = await request(app).patch(`/api/jobs/${created.id}/status`).send({ status: "applied" });
    expect(s.status).toBe(200);
    const n = await request(app).patch(`/api/jobs/${created.id}/notes`).send({ notes: "Submitted." });
    expect(n.status).toBe(200);

    const after = await request(app).get(`/api/jobs/${created.id}`);
    expect(after.status).toBe(200);
    expect(after.body.generated.coverLetter).toBe("hello");
    expect(after.body.generated.whyCompany).toBe("because");
    expect(after.body.scoreHistory).toEqual(scoreHistoryBefore);
  });

  it("DELETE /:id removes job from tracker list", async () => {
    const created = await triage(STARTUP_RAW, "Nimbus Labs");
    const before = await request(app).get("/api/jobs");
    expect(before.status).toBe(200);
    expect(before.body.items.some((i: { id: string }) => i.id === created.id)).toBe(true);

    const deleted = await request(app).delete(`/api/jobs/${created.id}`);
    expect(deleted.status).toBe(204);

    const after = await request(app).get("/api/jobs");
    expect(after.status).toBe(200);
    expect(after.body.items.some((i: { id: string }) => i.id === created.id)).toBe(false);

    const missing = await request(app).delete(`/api/jobs/${created.id}`);
    expect(missing.status).toBe(404);
  });
});

