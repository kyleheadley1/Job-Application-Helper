import { describe, expect, it } from "vitest";
import { userProfile } from "../../config/userProfile.js";
import { analyzeCoreLanguageRequirement } from "../../lib/coreLanguageRequirements.js";
import { deriveClaimableStackFromText } from "../../lib/claimableStack.js";
import {
  evaluateDisjunctiveLanguageRequirement,
  isExclusiveCoreLanguageRequirement,
} from "../../lib/disjunctiveLanguageRequirement.js";
import { analyzeStackMismatch } from "../../lib/stackMismatchAnalysis.js";
import type { ExtractedJobData } from "../../types/job.js";

const claimableFromProfile = () =>
  deriveClaimableStackFromText(
    [
      userProfile.headline,
      ...userProfile.strengths,
      "TypeScript Node.js Python",
    ].join(" "),
  );

describe("disjunctive vs exclusive language gates", () => {
  it("does not stack-mismatch on disjunctive list when candidate has Node.js", () => {
    const job: ExtractedJobData = {
      company: "Aledade",
      title: "Software Engineer I",
      stack: [],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: [
        "Expertise in at least 1 server-side web technology (e.g. Node.js, Java, Python, Scala, C#, C++, Go, JVM)",
      ],
      rawText:
        "Expertise in at least 1 server-side web technology (e.g. Node.js, Java, Python, Scala, C#, C++, Go, JVM).",
    };
    const claimable = claimableFromProfile();
    const analysis = analyzeStackMismatch(job, claimable);
    expect(analysis.stackMismatch).toBe(false);
    expect(analysis.coreLanguageGap).toEqual([]);

    const core = analyzeCoreLanguageRequirement(job, userProfile, claimable);
    expect(core.explicitHardRequirement).toBe(false);
  });

  it("still flags exclusive Go-only requirement", () => {
    const job: ExtractedJobData = {
      company: "GoCo",
      title: "Backend Engineer",
      stack: [],
      requiredSkills: ["Go"],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: ["Must have professional Go experience in production microservices."],
      rawText: "Must have professional Go experience. Go is our primary backend language.",
    };
    const claimable = claimableFromProfile();
    const analysis = analyzeStackMismatch(job, claimable);
    expect(analysis.stackMismatch).toBe(true);
    expect(analysis.coreLanguageGap).toContain("Go");

    const blob = job.rawText ?? "";
    expect(isExclusiveCoreLanguageRequirement(blob, "Go")).toBe(true);
    expect(evaluateDisjunctiveLanguageRequirement(job, claimable).satisfied).toBe(false);
  });
});
