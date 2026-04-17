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
Heritage Bank — Associate Software Engineer (New Graduate Program)
Location: Onsite, Dallas, TX (not commutable from NYC)
Bachelor's required
US citizenship required
No visa sponsorship
Enterprise Java 5+ years preferred
`.trim();

const triage = async (rawText: string, companyHint: string) => {
  const res = await request(app).post("/api/jobs/triage").send({ rawText, companyHint, fullPrep: false });
  expect(res.status).toBe(200);
  return res.body as { id: string };
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
    expect(s1.body.statusHistory?.length).toBe(1);
    expect(s1.body.statusHistory?.[0]?.fromStatus).toBe("to_review");
    expect(s1.body.statusHistory?.[0]?.toStatus).toBe("interviewing");
    expect(s1.body.statusHistory?.[0]?.note).toBe("Recruiter screen passed");

    const s2 = await request(app).patch(`/api/jobs/${created.id}/status`).send({
      status: "closed",
      note: "Role filled",
    });
    expect(s2.status).toBe(200);
    expect(s2.body.status).toBe("closed");
    expect(s2.body.tracker.color).toBe("red");
    expect(s2.body.tracker.shortlist).toBe(false);
    expect(s2.body.statusHistory?.length).toBe(2);
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
  });

  it("GET /api/jobs/export returns spreadsheet row shape", async () => {
    await triage(STARTUP_RAW, "Nimbus Labs");
    const res = await request(app).get("/api/jobs/export");
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    const row = res.body.rows[0];
    expect(row).toMatchObject({
      Company: expect.any(String),
      Role: expect.any(String),
      "Latest Score": expect.any(Number),
      "Recommended Action": expect.any(String),
      "Salary Ask": expect.any(String),
      "Top Match": expect.any(String),
      "Main Risk": expect.any(String),
      Resume: expect.stringMatching(/SWE|SIE|EARLY_CAREER/),
      "Status / Outcome": expect.any(String),
      Shortlist: expect.any(Boolean),
      Notes: expect.any(String),
      "Created At": expect.any(String),
      "Updated At": expect.any(String),
    });
  });

  it("GET /api/jobs/export?format=csv returns CSV", async () => {
    await triage(STARTUP_RAW, "Nimbus Labs");
    const res = await request(app).get("/api/jobs/export").query({ format: "csv" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(String(res.text).split("\n")[0]).toContain("Company,Role,Latest Score");
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
});

