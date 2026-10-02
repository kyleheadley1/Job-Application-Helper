import { describe, expect, it } from "vitest";
import {
  computeExperienceGap,
  levelFitCeilingForSeniorityDock,
  seniorityLevelFitDock,
} from "../../lib/experienceGap.js";
import type { ExtractedJobData } from "../../types/job.js";

const profile = { estimatedProfessionalYears: 1.75 };

const job = (overrides: Record<string, unknown>): ExtractedJobData =>
  ({
    company: "Co",
    title: "Software Engineer",
    stack: [],
    requiredSkills: [],
    preferredSkills: [],
    domainTags: [],
    responsibilities: [],
    requirements: [],
    rawText: "",
    ...overrides,
  }) as ExtractedJobData;

const dockFor = (overrides: Record<string, unknown>) => computeExperienceGap(job(overrides), profile)?.dock ?? 0;

describe("seniority dock is a level-fit ceiling, not a second subtraction", () => {
  it("maps docks to ceilings anchored at a matched 18/20", () => {
    expect(levelFitCeilingForSeniorityDock(1)).toBe(17);
    expect(levelFitCeilingForSeniorityDock(4)).toBe(16);
    expect(levelFitCeilingForSeniorityDock(8)).toBe(14);
    expect(levelFitCeilingForSeniorityDock(12)).toBe(11);
  });

  it("combines title stretch and experience gap under the cap", () => {
    expect(seniorityLevelFitDock({ seniorityStretch: true, experienceGap: { dock: 8, reason: "" } })).toBe(12);
    expect(seniorityLevelFitDock({ experienceGap: { dock: 3, reason: "" } })).toBe(3);
  });
});

describe("proportional experience gap", () => {
  it("2–6 years counts the floor and the top of the range", () => {
    const gap = computeExperienceGap(job({ yearsExperience: { raw: "2–6 years", min: 2, max: 6 } }), profile);
    expect(gap?.dock).toBe(5);
    expect(gap?.reason).toMatch(/2–6 years.*below the 2-year floor.*up to 6 years/);
  });

  it("scales with the range and stays under the cap", () => {
    expect(dockFor({ yearsExperience: { raw: "1+ years", min: 1 } })).toBe(0);
    expect(dockFor({ yearsExperience: { raw: "2+ years", min: 2 } })).toBe(1);
    expect(dockFor({ yearsExperience: { raw: "1–3 years", min: 1, max: 3 } })).toBe(1);
    expect(dockFor({ yearsExperience: { raw: "3–5 years", min: 3, max: 5 } })).toBe(5);
    expect(dockFor({ yearsExperience: { raw: "4+ years", min: 4 } })).toBe(5);
    expect(dockFor({ yearsExperience: { raw: "2–10 years", min: 2, max: 10 } })).toBe(8);
  });

  it("reads a range from Required text when the years field is empty", () => {
    expect(dockFor({ requirements: ["2–6+ years of professional software engineering experience"] })).toBe(5);
  });

  it("docks a mid-level label lightly when no years are stated", () => {
    const gap = computeExperienceGap(job({ seniority: "Mid Level" }), profile);
    expect(gap?.dock).toBe(3);
    expect(gap?.reason).toMatch(/mid-level/);
    expect(dockFor({ seniority: "Junior, Mid" })).toBe(0);
    expect(dockFor({ title: "Junior Software Engineer", seniority: "mid-level" })).toBe(0);
    expect(dockFor({ title: "Software Engineer I", seniority: "mid-level" })).toBe(0);
  });

  it("leaves hard-gated roles to the seniority gate", () => {
    expect(dockFor({ title: "Senior Engineer", yearsExperience: { raw: "6+ years", min: 6 } })).toBe(0);
  });
});
