import { describe, expect, it } from "vitest";
import {
  isLargeOrEnterpriseEmployerScale,
  isStartupSmallTeamScale,
  resolveEmployerScale,
  scoreEmployerRecognizabilityFromScale,
} from "../../lib/employerScale.js";
import { isVentureFundedStartupShape } from "../../lib/poolCompetitiveness.js";
import type { ExtractedJobData } from "../../types/job.js";

const baseJob = (over: Partial<ExtractedJobData> = {}): ExtractedJobData => ({
  company: "Acme",
  title: "Software Engineer",
  stack: [],
  requiredSkills: [],
  preferredSkills: [],
  domainTags: [],
  requirements: [],
  responsibilities: [],
  rawText: "",
  ...over,
});

describe("employerScale", () => {
  it("uses structured headcount for startup small-team without band regex", () => {
    const job = baseJob({ companyEmployeeCount: 80, rawText: "Series A product team." });
    expect(isStartupSmallTeamScale(job, "traditional bank finance")).toBe(true);
    expect(resolveEmployerScale(job).isStartupSmallByHeadcount).toBe(true);
  });

  it("does not treat 10k+ headcount as startup small-team", () => {
    const job = baseJob({
      companyEmployeeCount: 10001,
      rawText: "10,001+ employees. Fortune 500.",
    });
    expect(isStartupSmallTeamScale(job, job.rawText!)).toBe(false);
    expect(isLargeOrEnterpriseEmployerScale(job, job.rawText!)).toBe(true);
  });

  it("blocks venture-funded startup shape for large headcount employers", () => {
    const job = baseJob({
      company: "BigCo",
      companyEmployeeCount: 10001,
      rawText: "Series B. Well-funded. 10,001+ employees.",
    });
    expect(isVentureFundedStartupShape(job, job.rawText!)).toBe(false);
  });

  it("scores brand + large floor from shared scale", () => {
    const scale = resolveEmployerScale(
      baseJob({ company: "Google", companyEmployeeCount: 10001 }),
      "Google",
    );
    expect(scale.isBrandName).toBe(true);
    expect(scale.isLargeEmployer).toBe(true);
    expect(scoreEmployerRecognizabilityFromScale(scale)).toBeGreaterThanOrEqual(0.55);
  });
});
