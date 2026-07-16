import { describe, expect, it } from "vitest";
import {
  detectRoleSeniorityOverreach,
  earlyCareerLevelVetoesSeniorityGate,
  roleTitleSignalsSeniority,
  seniorityFieldSignalsOverreach,
  titleArchitectIsRoleNoun,
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

  it("veto: junior/mid level with years ≤4 never gates regardless of responsibilities", () => {
    const job = makeJob({
      title: "Architect core systems and AI pipelines",
      seniority: "Mid Level",
      yearsExperience: { min: 1, raw: "1+ years" },
      responsibilities: [
        "Architect core systems for the founding team",
        "Join our founding engineer culture",
        "You will architect scalable LLM pipelines",
      ],
      rawText:
        "Mid Level 1+ years. Architect core systems. founding team. founding engineer. You will architect pipelines.",
    });
    expect(earlyCareerLevelVetoesSeniorityGate(job)).toBe(true);
    expect(detectRoleSeniorityOverreach(job)).toBe(false);
  });

  it("multi-band Mid+Lead/Staff with generic Required text does not hard-gate (Fun)", () => {
    const job = makeJob({
      company: "Fun",
      title: "Software Engineer, Backend",
      seniority: "Mid, Senior Level, Lead/Staff",
      yearsExperience: { min: 2, max: 5, raw: "2–5 years" },
      requirements: [
        "2+ years of professional software engineering experience",
        "Strong backend fundamentals and API design",
        "Experience with relational databases and cloud services",
      ],
      rawText: "Seniority\nMid, Senior Level, Lead/Staff\nStrong backend fundamentals and API design",
    });
    expect(earlyCareerLevelVetoesSeniorityGate(job)).toBe(true);
    expect(detectRoleSeniorityOverreach(job)).toBe(false);
  });

  it("multi-band Mid+Senior with senior-depth Required still gates (Luminos)", () => {
    const job = makeJob({
      company: "Luminos",
      title: "Software Engineer",
      seniority: "Mid, Senior Level",
      yearsExperience: { min: 3, raw: "3+ years" },
      requirements: [
        "Hands-on experience with memory management in production systems",
        "Proven ability to run load testing and performance profiling to diagnose bottlenecks",
      ],
      rawText: "Seniority\nMid, Senior Level\nmemory management\nload testing\nprofiling",
    });
    expect(earlyCareerLevelVetoesSeniorityGate(job)).toBe(true);
    expect(detectRoleSeniorityOverreach(job)).toBe(true);
  });

  it("seniorityFieldSignalsOverreach treats lowest band as threshold", () => {
    expect(seniorityFieldSignalsOverreach("Mid, Senior Level, Lead/Staff")).toBe(false);
    expect(seniorityFieldSignalsOverreach("Mid, Senior Level")).toBe(false);
    expect(seniorityFieldSignalsOverreach("Senior Level")).toBe(true);
    expect(seniorityFieldSignalsOverreach("Lead/Staff")).toBe(true);
  });

  it("treats architect as verb in polluted title, not role noun", () => {
    expect(titleArchitectIsRoleNoun("Architect core systems and AI pipelines")).toBe(false);
    expect(roleTitleSignalsSeniority("Architect core systems and AI pipelines")).toBe(false);
    expect(titleArchitectIsRoleNoun("Principal Software Architect")).toBe(true);
    expect(roleTitleSignalsSeniority("Tech Lead, AI Platform")).toBe(true);
  });

  it("still fires for genuine senior title when early-career veto does not apply", () => {
    expect(
      detectRoleSeniorityOverreach(
        makeJob({
          title: "Staff AI Engineer",
          seniority: "Staff",
          yearsExperience: { min: 8, raw: "8+ years" },
        }),
      ),
    ).toBe(true);
    expect(
      detectRoleSeniorityOverreach(
        makeJob({
          title: "Tech Lead, AI Platform",
          seniority: "Senior Level",
          yearsExperience: { min: 6, raw: "6+ years" },
        }),
      ),
    ).toBe(true);
  });

  it("veto blocks senior-in-title when level is explicitly junior/mid and years ≤4", () => {
    expect(
      detectRoleSeniorityOverreach(
        makeJob({
          title: "Senior Software Engineer",
          seniority: "Junior, Mid",
          yearsExperience: { min: 2, raw: "2+ years" },
        }),
      ),
    ).toBe(false);
  });
});
