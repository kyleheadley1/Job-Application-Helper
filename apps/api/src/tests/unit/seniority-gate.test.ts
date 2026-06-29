import { describe, expect, it } from "vitest";
import {
  detectRoleSeniorityOverreach,
  roleTitleSignalsSeniority,
  seniorityFieldSignalsOverreach,
  yearsExperienceSignalsOverreach,
} from "../../lib/seniorityGate.js";
import type { ExtractedJobData } from "../../types/job.js";

const makeJob = (overrides: Partial<ExtractedJobData>): ExtractedJobData => ({
  company: "TestCo",
  title: "Software Engineer",
  stack: ["TypeScript"],
  requiredSkills: [],
  preferredSkills: [],
  domainTags: [],
  responsibilities: [],
  requirements: [],
  rawText: "",
  ...overrides,
});

describe("seniorityGate", () => {
  it("ignores team/manager senior tokens in rawText body", () => {
    const job = makeJob({
      title: "AI Engineer",
      seniority: "Junior, Mid",
      yearsExperience: { min: 1, max: 4, raw: "1-4 years" },
      rawText:
        "Work with Senior AI Lead, senior engineers, Engineering Manager, and technical leaders. Learn from experienced engineers.",
    });
    expect(detectRoleSeniorityOverreach(job)).toBe(false);
  });

  it("fires on senior tokens in title", () => {
    expect(roleTitleSignalsSeniority("Senior Software Engineer")).toBe(true);
    expect(roleTitleSignalsSeniority("Staff Platform Engineer")).toBe(true);
    expect(roleTitleSignalsSeniority("Principal AI Engineer")).toBe(true);
  });

  it("fires when structured years min is 5+", () => {
    expect(yearsExperienceSignalsOverreach(5)).toBe(true);
    expect(yearsExperienceSignalsOverreach(4)).toBe(false);
  });

  it("does not treat multi-band junior/mid seniority as overreach", () => {
    expect(seniorityFieldSignalsOverreach("Junior, Mid")).toBe(false);
    expect(seniorityFieldSignalsOverreach("Junior, Mid and Senior level")).toBe(false);
    expect(seniorityFieldSignalsOverreach("Staff")).toBe(true);
  });
});
