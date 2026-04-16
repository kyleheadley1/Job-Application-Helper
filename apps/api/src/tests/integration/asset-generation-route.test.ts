import request from "supertest";
import { describe, expect, it, beforeEach } from "vitest";
import { app } from "../../app.js";
import { jobsRepository } from "../../services/jobs/jobs.repository.js";
import { GeneratedAssetsSchema } from "../../agents/jobAgent/schemas.js";

const STARTUP_RAW = `
Nimbus Labs — Software Engineer — Product (Seed-stage startup)
Remote (US). NYC-friendly hybrid optional.

Build customer-facing features with TypeScript, Node.js, React, and REST APIs.
Ship internal tools and AI-enabled workflows for operations teams.
2+ years experience; we care about product sense and ambiguity.

Salary: 130000 USD - 160000 USD
`.trim();

const SIE_RAW = `
DeployCo — Solutions Engineer (Forward Deployed)
Hybrid NYC.

You will own customer-facing implementation, integrations with enterprise APIs, and technical onboarding workshops.

Requirements:
- Strong communication and stakeholder collaboration
- Experience with integrations and delivery timelines

Salary: $140k–$200k
`.trim();

describe("asset generation routes", () => {
  beforeEach(() => {
    jobsRepository.clearForTests();
  });

  it("integration: triage → GET by id → POST generate-assets → validates schema", async () => {
    const triage = await request(app).post("/api/jobs/triage").send({
      rawText: STARTUP_RAW,
      companyHint: "Nimbus Labs",
      fullPrep: false,
    });
    expect(triage.status).toBe(200);
    const id = triage.body.id as string;
    expect(id).toBeTruthy();

    const got = await request(app).get(`/api/jobs/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.id).toBe(id);

    const gen = await request(app).post(`/api/jobs/${id}/generate-assets`).send({});
    expect(gen.status).toBe(200);
    const parsed = GeneratedAssetsSchema.safeParse(gen.body.generated);
    expect(parsed.success).toBe(true);
    expect(gen.body.generated.coverLetter?.length).toBeGreaterThan(30);
    expect(gen.body.generated.whyCompany?.length).toBeGreaterThan(20);
    expect(gen.body.generated.talkingPoints?.length).toBeGreaterThanOrEqual(3);
    expect(gen.body.generated.tailoredBulletCandidates?.length).toBeGreaterThanOrEqual(3);
    expect(gen.body.generated.emphasize?.length).toBeGreaterThanOrEqual(1);
    expect(gen.body.generated.avoidClaiming?.length).toBeGreaterThanOrEqual(1);
    expect(gen.body.recommendedResume).toBe("SWE");

    const sweBlob = [
      gen.body.generated.coverLetter,
      ...(gen.body.generated.talkingPoints ?? []),
      ...(gen.body.generated.tailoredBulletCandidates ?? []),
    ]
      .join(" ")
      .toLowerCase();
    expect(sweBlob).toMatch(/api|typescript|internal|product|full-stack/);
  });

  it("POST /generate-assets from full job body (no prior save) returns assets", async () => {
    const triage = await request(app).post("/api/jobs/triage").send({
      rawText: SIE_RAW,
      companyHint: "DeployCo",
      fullPrep: false,
    });
    expect(triage.status).toBe(200);
    const job = triage.body;
    const res = await request(app).post("/api/jobs/generate-assets").send({ job, persist: false });
    expect(res.status).toBe(200);
    expect(res.body.recommendedResume).toBe("SIE");
    const blob = [
      res.body.generated.coverLetter,
      ...(res.body.generated.talkingPoints ?? []),
    ]
      .join(" ")
      .toLowerCase();
    expect(blob).toMatch(/integration|implementation|onboarding/);
    expect(res.body.generated.whyCompany).toContain("DeployCo");
  });

  it("returns 400 when recommendation is no without force", async () => {
    const triage = await request(app).post("/api/jobs/triage").send({
      rawText: `Heritage Bank — Role
      Onsite Dallas not commutable from NYC
      Bachelor's required
      New graduate rotational program
      US citizenship required
      No visa sponsorship`,
      companyHint: "Heritage Bank",
      fullPrep: false,
    });
    expect(triage.status).toBe(200);
    const id = triage.body.id as string;
    const gen = await request(app).post(`/api/jobs/${id}/generate-assets`).send({});
    expect(gen.status).toBe(400);
    expect(gen.body.error).toBe("ASSET_GENERATION_SKIPPED");
  });
});
