import { describe, expect, it } from "vitest";
import { POOL_FRIENDLINESS } from "../../config/capabilitySurvivabilityPolicy.js";
import {
  extractCompanyEmployeeCount,
  isLargeEmployerByHeadcount,
  parseEmployeeCountLine,
} from "../../lib/companyEmployeeCount.js";
import {
  computePoolFriendliness,
  scoreListingEmployerRecognizability,
} from "../../lib/poolFriendliness.js";
import { loadCalibrationFixture, scoreCalibrationAnchor } from "../fixtures/calibrationAnchors.js";
import type { ExtractedJobData } from "../../types/job.js";

describe("company employee count parsing", () => {
  it("parses Simplify employee-count bands", () => {
    expect(parseEmployeeCountLine("10,001+ employees")).toBe(10001);
    expect(parseEmployeeCountLine("51-200 employees")).toBe(51);
    expect(parseEmployeeCountLine("1,001-5,000 employees")).toBe(1001);
  });

  it("extracts from NYT fixture rawText / field", () => {
    const nyt = loadCalibrationFixture("nytNewsMultimodal").extracted;
    expect(extractCompanyEmployeeCount(nyt)).toBeGreaterThanOrEqual(10001);
    expect(isLargeEmployerByHeadcount(nyt)).toBe(true);
  });
});

describe("company-size-aware pool friendliness", () => {
  it("NYT (10,001+) never gets niche employer bonus", () => {
    const nyt = loadCalibrationFixture("nytNewsMultimodal").extracted;
    const pool = computePoolFriendliness(nyt);
    expect(pool.adjustments.some((a) => a.id === "nicheEmployer")).toBe(false);
    expect(scoreListingEmployerRecognizability(nyt)).toBeGreaterThanOrEqual(
      POOL_FRIENDLINESS.LARGE_EMPLOYER_RECOGNIZABILITY_FLOOR,
    );
  });

  it("Cherry Hill / Traba still eligible for niche when small", () => {
    const cherry = scoreCalibrationAnchor("cherryHill");
    expect(isLargeEmployerByHeadcount(cherry.fixture.extracted)).toBe(false);
    // Cherry Hill is favorable specific-match — pool may or may not include niche,
    // but headcount logic must not force brand/large treatment.
    expect(cherry.employerRecognizability).toBeLessThanOrEqual(0.4);

    const smallStartup: ExtractedJobData = {
      company: "TinyCo",
      companyDisplayName: "TinyCo",
      title: "Software Engineer",
      stack: ["TypeScript"],
      requiredSkills: ["TypeScript"],
      preferredSkills: [],
      domainTags: [],
      requirements: [],
      responsibilities: [],
      rawText: "TinyCo — Software Engineer. 11-50 employees. TypeScript product role.",
      companyEmployeeCount: 11,
    };
    const pool = computePoolFriendliness(smallStartup);
    expect(pool.adjustments.some((a) => a.id === "nicheEmployer")).toBe(true);
    expect(pool.adjustments.some((a) => a.id === "brandEmployer")).toBe(false);
  });
});
