import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../../app.js";

describe("POST /api/jobs/triage", () => {
  it("returns a structured, auditable triage result", async () => {
    const response = await request(app).post("/api/jobs/triage").send({
      rawText:
        "Software Engineer. Build TypeScript and Node.js APIs with React frontend. 2+ years experience. Remote in NYC.",
      companyHint: "AppFlow",
      fullPrep: false,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      extracted: expect.any(Object),
      rules: expect.any(Object),
      score: expect.any(Object),
      recommendation: expect.stringMatching(/yes|selective_yes|no/),
      salaryAsk: expect.any(Object),
      recommendedResume: expect.stringMatching(/SWE|SIE|EARLY_CAREER/),
      resumeRationale: expect.any(Array),
      topMatch: expect.any(String),
      mainRisk: expect.any(String),
      rationale: expect.any(Array),
      risks: expect.any(Array),
      tracker: expect.any(Object),
      generated: expect.any(Object),
    });
    expect(response.body.generated).toEqual({});
  });

  it("validates triage input", async () => {
    const response = await request(app).post("/api/jobs/triage").send({});
    expect(response.status).toBe(400);
  });
});
