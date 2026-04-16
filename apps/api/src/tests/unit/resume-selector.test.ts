import { describe, expect, it } from "vitest";
import { selectResume } from "../../agents/jobAgent/resumeSelector.js";
import { userProfile } from "../../config/userProfile.js";
import type { ExtractedJobData } from "../../types/job.js";

const score = {
  stackFit: 20,
  levelFit: 10,
  domainFit: 7,
  resumeStoryClarity: 10,
  functionalOverlap: 8,
  recruiterFriendliness: 11,
  careerValue: 8,
  total: 74,
};

describe("resume selection", () => {
  it("picks SIE for integration and customer implementation shape", async () => {
    const extracted: ExtractedJobData = {
      company: "DeployCo",
      title: "Solutions Engineer",
      stack: ["TypeScript"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: ["Lead customer-facing implementation and integrations"],
      requirements: [],
    };
    const result = await selectResume({
      extracted,
      score,
      topMatch: "Implementation overlap",
      mainRisk: "Domain depth",
      userProfile,
    });
    expect(result.recommendedResume).toBe("SIE");
  });

  it("picks EARLY_CAREER only for explicit early-career signals", async () => {
    const extracted: ExtractedJobData = {
      company: "GradTrack",
      title: "Associate Software Engineer",
      stack: ["JavaScript"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: ["Early career rotational program"],
    };
    const result = await selectResume({
      extracted,
      score,
      topMatch: "Entry-level path",
      mainRisk: "Pipeline strictness",
      userProfile,
    });
    expect(result.recommendedResume).toBe("EARLY_CAREER");
  });
});
