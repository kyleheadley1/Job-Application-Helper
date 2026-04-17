import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jobsRepository, JobsRepository } from "../../services/jobs/jobs.repository.js";
import { createMongoTestHarness } from "../support/mongo-test-db.js";
import type { JobRecord } from "../../types/job.js";

const makeRecord = (): JobRecord => {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    extracted: {
      company: "PersistCo",
      title: "Software Engineer",
      stack: ["TypeScript", "Node.js"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: ["Build APIs"],
      requirements: ["TypeScript"],
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
      stackFit: 20,
      levelFit: 10,
      domainFit: 8,
      resumeStoryClarity: 12,
      functionalOverlap: 8,
      recruiterFriendliness: 10,
      careerValue: 8,
      total: 76,
    },
    recommendation: "selective_yes",
    salaryAsk: { number: 150000 },
    recommendedResume: "SWE",
    resumeRationale: ["API-heavy product role"],
    topMatch: "TypeScript backend overlap",
    mainRisk: "None major",
    rationale: ["Strong stack fit"],
    risks: [],
    generated: {},
    tracker: {
      statusOutcome: "to_review",
      color: "yellow",
      shortlist: false,
      notes: "",
      recommendedAction: "Apply selectively",
    },
    status: "to_review",
    createdAt: now,
    updatedAt: now,
    scoreHistory: [{ scoredAt: now, score: { stackFit: 20, levelFit: 10, domainFit: 8, resumeStoryClarity: 12, functionalOverlap: 8, recruiterFriendliness: 10, careerValue: 8, total: 76 }, recommendation: "selective_yes" }],
    statusHistory: [],
  };
};

describe("Mongo persistence restart-safe behavior", () => {
  const mongo = createMongoTestHarness("restart_safe");

  beforeAll(async () => {
    await mongo.start();
  });

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await jobsRepository.clearForTests();
  });

  it("saved role survives repository reinitialization with assets, notes, and status history", async () => {
    const repo1 = new JobsRepository();
    const record = makeRecord();
    await repo1.saveTriage(record);
    await repo1.mergeGeneratedAssets(record.id, {
      coverLetter: "Persisted cover letter",
      whyCompany: "Persisted why company",
    });
    await repo1.updateNotes(record.id, "Persistent notes");
    await repo1.updateStatus(record.id, "applied", "Submitted via career page");

    const repo2 = new JobsRepository();
    const got = await repo2.getById(record.id);
    expect(got).toBeTruthy();
    expect(got?.generated.coverLetter).toBe("Persisted cover letter");
    expect(got?.tracker.notes).toBe("Persistent notes");
    expect(got?.status).toBe("applied");
    expect(got?.statusHistory?.length).toBe(1);
    expect(got?.statusHistory?.[0]?.toStatus).toBe("applied");
    expect(got?.scoreHistory?.length).toBe(1);
  });
});

