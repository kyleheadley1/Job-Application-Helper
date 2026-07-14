import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import {
  detectNamedHardRequirementGaps,
  extractNamedHardRequirements,
} from "../../lib/namedHardRequirement.js";
import { repairMidWordLineBreaks } from "../../lib/repairMidWordLineBreaks.js";
import { normalizeText } from "../../lib/text.js";
import {
  calibrationSweResumeContexts,
  loadCalibrationFixture,
  scoreCalibrationAnchor,
} from "../fixtures/calibrationAnchors.js";
import type { ExtractedJobData } from "../../types/job.js";

const makeJob = (overrides: Partial<ExtractedJobData>): ExtractedJobData => ({
  company: "TestCo",
  title: "Software Engineer",
  stack: [],
  requiredSkills: [],
  preferredSkills: [],
  domainTags: [],
  requirements: [],
  responsibilities: [],
  rawText: "",
  ...overrides,
});

describe("repairMidWordLineBreaks", () => {
  it("rejoins experi\\nence and prog\\nram mangled soft wraps", () => {
    const mangled =
      "Strong coding skills and experi\nence with prog\nramming fundamentals.";
    expect(repairMidWordLineBreaks(mangled)).toBe(
      "Strong coding skills and experience with programming fundamentals.",
    );
    expect(normalizeText(mangled)).toContain("experience");
    expect(normalizeText(mangled)).toContain("programming");
    expect(normalizeText(mangled)).not.toContain("experi ence");
  });

  it("does not glue job-board chrome labels (States\\nposition)", () => {
    const chrome = "United States\nposition\nFull-time\ntime\nRemote\nremote";
    expect(repairMidWordLineBreaks(chrome)).toContain("States\nposition");
    expect(repairMidWordLineBreaks(chrome)).not.toContain("Statesposition");
  });
});

describe("named hard-requirement detector", () => {
  it("extracts Must have experience with TULIP Interfaces; ignores skill chip lists", () => {
    const job = makeJob({
      title: "Software Engineer - TULIP Interfaces",
      requiredSkills: ["TULIP Interfaces", "TypeScript", "React", "Node.js"],
      requirements: [
        "Must have experience with TULIP Interfaces",
        "Strong knowledge of TypeScript, JavaScript, React and Node.js",
      ],
      rawText: "Required\nMust have experience with TULIP Interfaces\nTypeScript\nReact\nNode.js",
    });
    expect(extractNamedHardRequirements(job)).toEqual(["TULIP Interfaces"]);
    const gaps = detectNamedHardRequirementGaps(job, "TypeScript React Node.js Codesmith");
    expect(gaps.map((g) => g.name)).toEqual(["TULIP Interfaces"]);
    expect(gaps[0]?.note).toMatch(/JD requires named tool\/platform TULIP Interfaces/);
  });

  it("does not fire on generic required-skill chip lists without must-have phrasing", () => {
    const job = makeJob({
      requiredSkills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
      requirements: [
        "Strong knowledge of TypeScript, React, and Node.js",
        "Familiarity with PostgreSQL",
      ],
      rawText: "Required Skills\nTypeScript\nReact\nNode.js\nPostgreSQL",
    });
    expect(extractNamedHardRequirements(job)).toEqual([]);
    expect(detectNamedHardRequirementGaps(job, "Python Django")).toEqual([]);
  });

  it("does not flag when the named tool appears in the candidate background", () => {
    const job = makeJob({
      requirements: ["Must have experience with Salesforce Apex"],
    });
    expect(
      detectNamedHardRequirementGaps(job, "Production Salesforce Apex workflows"),
    ).toEqual([]);
  });
});

describe("named required-tool absent calibration (PCG / TULIP)", () => {
  const fixture = loadCalibrationFixture("namedRequiredToolAbsent");

  it("raw text includes Must have experience with TULIP Interfaces; TULIP not in techCanon path", () => {
    expect(fixture.extracted.rawText).toMatch(/Must have experience with TULIP Interfaces/);
    expect(fixture.extracted.title).toMatch(/TULIP/i);
  });

  it("rules surface prominent Key Risk naming TULIP as unmet named requirement", () => {
    const rules = evaluateRules(fixture.extracted, userProfile, {
      resumeContexts: calibrationSweResumeContexts(),
      activeResumeType: "SWE",
    });
    expect(rules.namedHardRequirementGaps).toContain("TULIP Interfaces");
    expect(rules.notes[0]).toMatch(
      /JD requires named tool\/platform TULIP Interfaces — no experience found in your background/,
    );
  });

  it("recompute keeps the named-tool note first among soft risks", () => {
    const scored = scoreCalibrationAnchor("namedRequiredToolAbsent");
    expect(scored.rules.namedHardRequirementGaps).toContain("TULIP Interfaces");
    expect(scored.rules.notes.some((n) => /TULIP Interfaces/.test(n))).toBe(true);
  });
});

describe("named-tool detector guard — existing anchors unchanged", () => {
  for (const key of ["cherryHill", "fuboFrontend", "trabaAppliedAi", "stubHubCoreCompute"] as const) {
    it(`${key} has no namedHardRequirementGaps`, () => {
      const scored = scoreCalibrationAnchor(key);
      expect(scored.rules.namedHardRequirementGaps ?? []).toEqual([]);
      expect(
        scored.rules.notes.some((n) => /JD requires named tool\/platform/i.test(n)),
      ).toBe(false);
    });
  }
});
