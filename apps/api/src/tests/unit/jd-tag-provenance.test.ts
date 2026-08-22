import { describe, expect, it } from "vitest";
import {
  buildJdTagProvenance,
  classifyJdLines,
  sanitizeExtractedTags,
} from "../../lib/jdTagProvenance.js";
import type { ExtractedJobData } from "../../types/job.js";

const baseJob = (overrides: Partial<ExtractedJobData>): ExtractedJobData => ({
  company: "Co",
  title: "Engineer",
  stack: [],
  requiredSkills: [],
  preferredSkills: [],
  domainTags: [],
  responsibilities: [],
  requirements: [],
  rawText: "",
  ...overrides,
});

describe("jdTagProvenance", () => {
  it("classifies Who You Are prose as NARRATIVE", () => {
    const lines = classifyJdLines(
      "Who You Are\nYou have a passion for good design and delightful UX.\nQualifications\nMust have TypeScript",
    );
    expect(lines.some((l) => l.line.includes("good design") && l.strength === "NARRATIVE")).toBe(
      true,
    );
    expect(lines.some((l) => l.line.includes("Must have TypeScript") && l.strength === "REQUIRED")).toBe(
      true,
    );
  });

  it("removes tags not literally present in rawText", () => {
    const job = baseJob({
      requiredSkills: ["Figma", "TypeScript"],
      rawText: "Qualifications\nMust have TypeScript experience.",
    });
    const out = sanitizeExtractedTags(job);
    expect(out.requiredSkills).toEqual(["TypeScript"]);
    expect(out.requiredSkills).not.toContain("Figma");
  });

  it("assigns source quotes to grounded tags", () => {
    const job = baseJob({
      requiredSkills: ["React", "TypeScript"],
      requirements: ["2+ years with React and/or TypeScript"],
      rawText: "Qualifications\n2+ years with React and/or TypeScript",
    });
    const out = sanitizeExtractedTags(job);
    const tags = buildJdTagProvenance(out);
    expect(tags.find((t) => t.term === "React")?.strength).toBe("REQUIRED");
    expect(tags.find((t) => t.term === "React")?.sourceQuote).toMatch(/React/);
  });
});
