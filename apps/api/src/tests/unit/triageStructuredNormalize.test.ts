import { describe, expect, it } from "vitest";
import { ExtractedJobFromModelSchema } from "../../agents/jobAgent/schemas.js";
import { ScoringFromModelSchema } from "../../agents/jobAgent/scoring.js";
import {
  formatWhyCompanyForSIE,
  preprocessExtractionInput,
  preprocessScoringInput,
  stripPastedJdHeaderFromCoverLetter,
} from "../../tools/triageStructuredNormalize.js";
import type { JobRecord } from "../../types/job.js";

describe("preprocessExtractionInput + ExtractedJobFromModelSchema", () => {
  it("drops invalid url and keeps valid url", () => {
    const raw = {
      company: "Acme",
      title: "Engineer",
      url: "not-a-url",
      stack: [],
    };
    const parsed = ExtractedJobFromModelSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.url).toBeUndefined();
    const ok = ExtractedJobFromModelSchema.safeParse({
      company: "Acme",
      title: "Engineer",
      url: "https://example.com/job/1",
      stack: [],
    });
    expect(ok.success).toBe(true);
    if (!ok.success) return;
    expect(ok.data.url).toBe("https://example.com/job/1");
  });

  it("stringifies object location and accepts string location", () => {
    const obj = ExtractedJobFromModelSchema.safeParse({
      company: "Acme",
      title: "Engineer",
      location: { city: "New York", region: "NY", country: "US" },
      stack: [],
    });
    expect(obj.success).toBe(true);
    if (!obj.success) return;
    expect(obj.data.location).toBe("New York, NY, US");

    const str = ExtractedJobFromModelSchema.safeParse({
      company: "Acme",
      title: "Engineer",
      location: "Remote (US)",
      stack: [],
    });
    expect(str.success).toBe(true);
    if (!str.success) return;
    expect(str.data.location).toBe("Remote (US)");
  });

  it("coerces salary numeric strings", () => {
    const parsed = ExtractedJobFromModelSchema.safeParse({
      company: "Acme",
      title: "Engineer",
      salary: { min: "130000", max: "160000", currency: "USD" },
      stack: [],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.salary?.min).toBe(130000);
    expect(parsed.data.salary?.max).toBe(160000);
  });

  it("wraps yearsExperience number and degreeRequirement string", () => {
    const parsed = ExtractedJobFromModelSchema.safeParse({
      company: "Acme",
      title: "Engineer",
      yearsExperience: 2,
      degreeRequirement: "Bachelor's required",
      stack: [],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.yearsExperience?.raw).toBe("2");
    expect(parsed.data.degreeRequirement?.raw).toBe("Bachelor's required");
    expect(parsed.data.degreeRequirement?.level).toBe("unknown");
  });
});

describe("preprocessScoringInput + ScoringFromModelSchema", () => {
  it("coerces topMatch boolean to string", () => {
    const parsed = ScoringFromModelSchema.safeParse({
      score: {
        stackFit: 10,
        levelFit: 10,
        domainFit: 7,
        resumeStoryClarity: 10,
        functionalOverlap: 7,
        recruiterFriendliness: 10,
        careerValue: 7,
        total: 61,
      },
      recommendation: "selective_yes",
      topMatch: true,
      mainRisk: "x",
      rationale: [],
      risks: [],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(typeof parsed.data.topMatch).toBe("string");
    expect(parsed.data.topMatch.length).toBeGreaterThan(3);
  });

  it("lifts score fields from root when score object missing", () => {
    const parsed = ScoringFromModelSchema.safeParse({
      stackFit: 12,
      levelFit: 11,
      domainFit: 7,
      resumeStoryClarity: 11,
      functionalOverlap: 7,
      recruiterFriendliness: 10,
      careerValue: 7,
      recommendation: "yes",
      topMatch: "API overlap",
      mainRisk: "Low",
      rationale: ["a"],
      risks: ["b"],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.score.stackFit).toBe(12);
    expect(parsed.data.score.resumeStoryClarity).toBe(10);
    expect(parsed.data.score.total).toBe(64);
  });

  it("accepts realigned category maxes (functionalOverlap up to 15, stackFit up to 20)", () => {
    const parsed = ScoringFromModelSchema.safeParse({
      score: {
        stackFit: 17,
        levelFit: 16,
        domainFit: 8,
        resumeStoryClarity: 9,
        functionalOverlap: 14,
        recruiterFriendliness: 12,
        careerValue: 8,
        total: 84,
      },
      recommendation: "yes",
      topMatch: "AI internal tools overlap",
      mainRisk: "Low",
      rationale: ["a", "b"],
      risks: [],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.score.functionalOverlap).toBe(14);
    expect(parsed.data.score.stackFit).toBe(17);
  });

  it("reconciles score.total to sum of categories", () => {
    const parsed = ScoringFromModelSchema.safeParse({
      score: {
        stackFit: 10,
        levelFit: 10,
        domainFit: 7,
        resumeStoryClarity: 10,
        functionalOverlap: 7,
        recruiterFriendliness: 10,
        careerValue: 7,
        total: 999,
      },
      recommendation: "no",
      topMatch: "t",
      mainRisk: "m",
      rationale: [],
      risks: [],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.score.total).toBe(61);
  });

  it("strips emphasize/avoidClaiming so schema validates", () => {
    const parsed = ScoringFromModelSchema.safeParse({
      score: {
        stackFit: 5,
        levelFit: 5,
        domainFit: 5,
        resumeStoryClarity: 5,
        functionalOverlap: 5,
        recruiterFriendliness: 5,
        careerValue: 5,
        total: 35,
      },
      recommendation: "no",
      topMatch: "t",
      mainRisk: "m",
      rationale: [],
      risks: [],
      emphasize: ["should be stripped"],
      avoidClaiming: ["stripped"],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
  });
});

describe("stripPastedJdHeaderFromCoverLetter", () => {
  const baseJob = {
    extracted: { company: "Heritage Bank", title: "Associate Software Engineer" },
  } as Pick<JobRecord, "extracted">;

  it("removes first-line JD header matching company — title", () => {
    const letter = "Heritage Bank — Associate Software Engineer\n\nHello team,\nBody.";
    const out = stripPastedJdHeaderFromCoverLetter(baseJob as JobRecord, letter);
    expect(out.startsWith("Hello team")).toBe(true);
    expect(out).not.toMatch(/^Heritage Bank —/);
  });
});

describe("formatWhyCompanyForSIE", () => {
  it("splits long single-paragraph text into blocks", () => {
    const dense =
      "First sentence here. Second sentence here. Third sentence here. Fourth sentence adds more detail.";
    const out = formatWhyCompanyForSIE(dense);
    expect(out).toContain("\n\n");
    expect(out.split("\n\n").length).toBeGreaterThanOrEqual(3);
  });

  it("leaves short text unchanged", () => {
    const s = "Short. Two.";
    expect(formatWhyCompanyForSIE(s)).toBe(s);
  });
});

describe("preprocessExtractionInput edge cases", () => {
  it("normalizes location array to string", () => {
    const n = preprocessExtractionInput({
      company: "A",
      title: "B",
      location: ["NYC", "Hybrid"],
      stack: [],
    }) as Record<string, unknown>;
    expect(n.location).toBe("NYC; Hybrid");
  });
});
