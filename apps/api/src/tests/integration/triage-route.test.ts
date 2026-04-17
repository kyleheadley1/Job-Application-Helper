import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../app.js';
import { jobsRepository } from '../../services/jobs/jobs.repository.js';
import { createMongoTestHarness } from '../support/mongo-test-db.js';

describe('POST /api/jobs/triage', () => {
  const mongo = createMongoTestHarness('triage_routes');

  beforeAll(async () => {
    await mongo.start();
  });

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await jobsRepository.clearForTests();
  });

  it('returns a structured, auditable triage result', async () => {
    const response = await request(app).post('/api/jobs/triage').send({
      rawText:
        'Software Engineer. Build TypeScript and Node.js APIs with React frontend. 2+ years experience. Remote in NYC.',
      companyHint: 'AppFlow',
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
    expect(response.body.debugExtraction?.extraction?.success).toBeDefined();
    expect(response.body.debugExtraction?.scoring?.success).toBeDefined();
  });

  it('validates triage input', async () => {
    const response = await request(app).post('/api/jobs/triage').send({});
    expect(response.status).toBe(400);
  });

  it("does not add scored jobs to tracker list until confirm-applied", async () => {
    const triage = await request(app).post("/api/jobs/triage").send({
      rawText:
        "Software Engineer. Build TypeScript and Node.js APIs with React frontend. 2+ years experience. Remote in NYC.",
      companyHint: "AppFlow",
      fullPrep: false,
    });
    expect(triage.status).toBe(200);
    const id = triage.body.id as string;
    const listBefore = await request(app).get("/api/jobs");
    expect(listBefore.status).toBe(200);
    expect(listBefore.body.items.some((i: { id: string }) => i.id === id)).toBe(false);

    const confirm = await request(app).post(`/api/jobs/${id}/confirm-applied`).send({});
    expect(confirm.status).toBe(200);

    const listAfter = await request(app).get("/api/jobs");
    expect(listAfter.status).toBe(200);
    expect(listAfter.body.items.some((i: { id: string }) => i.id === id)).toBe(true);
  });
});
