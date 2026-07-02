import { describe, expect, it } from "vitest";
import { analyzeLanguageRequirementStrength } from "../../lib/languageRequirementStrength.js";
import type { ExtractedJobData } from "../../types/job.js";

describe("analyzeLanguageRequirementStrength", () => {
  it("classifies strong required Python as hard", () => {
    const job: ExtractedJobData = {
      company: "Mathpix",
      title: "Backend Engineer",
      stack: ["Python", "Flask"],
      requiredSkills: ["Python", "Flask"],
      requirements: ["Strong Python and Flask required"],
      rawText: "Strong Python and Flask required.",
    };
    expect(analyzeLanguageRequirementStrength(job, "Python/Flask")).toBe("hard");
  });

  it("classifies plus/preferred Python as soft", () => {
    const job: ExtractedJobData = {
      company: "Clinical Ink",
      title: "Software Engineer",
      stack: ["TypeScript", "Node.js", "Python"],
      requiredSkills: ["TypeScript", "Node.js"],
      preferredSkills: ["Python"],
      requirements: [
        "We value engineering fundamentals and learning speed over expertise in any specific programming language.",
        "TypeScript/Node experience; Python is a plus.",
      ],
      rawText: `
Clinical Ink — Software Engineer
We value engineering fundamentals and learning speed over expertise in any specific programming language.
TypeScript and Node.js required. Python is a plus.
      `.trim(),
    };
    expect(analyzeLanguageRequirementStrength(job, "Python")).toBe("soft");
  });

  it("classifies fundamentals-over-language framing as soft even when Python is in stack", () => {
    const job: ExtractedJobData = {
      company: "Example Co",
      title: "Software Engineer",
      stack: ["TypeScript", "Python"],
      requiredSkills: ["TypeScript"],
      requirements: ["Fundamentals and learning speed matter more than any specific language."],
      rawText: "Fundamentals and learning speed matter more than any specific language. Python nice to have.",
    };
    expect(analyzeLanguageRequirementStrength(job, "Python")).toBe("soft");
  });
});
