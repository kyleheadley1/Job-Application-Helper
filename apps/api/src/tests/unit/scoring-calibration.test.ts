import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { scoreJobDeterministicPreview } from "../../agents/jobAgent/scoring.js";
import { userProfile } from "../../config/userProfile.js";
import type { ExtractedJobData } from "../../types/job.js";

describe("scoring calibration", () => {
  it("keeps aspirational early-career builder roles conservative", () => {
    const aspirational: ExtractedJobData = {
      company: "ScaleMesh",
      title: "Junior Software Engineer",
      stack: ["TypeScript", "Node.js"],
      requiredSkills: ["full-stack product shipping", "collaboration"],
      preferredSkills: ["ai tooling", "optimization"],
      domainTags: [],
      responsibilities: [
        "Ship product features in a high-scale environment.",
        "Collaborate on business-impact and revenue growth initiatives.",
      ],
      requirements: ["1-3 years experience", "early-career growth role"],
      rawText:
        "Junior builder role with internet-scale systems exposure, data-science collaboration, and revenue growth language.",
    };
    const baseline: ExtractedJobData = {
      ...aspirational,
      responsibilities: ["Ship product features with cross-functional collaboration."],
      rawText: "Junior builder role focused on full-stack product shipping and collaboration.",
    };
    const aspirationalScore = scoreJobDeterministicPreview({
      extracted: aspirational,
      rules: evaluateRules(aspirational, userProfile),
    });
    const baselineScore = scoreJobDeterministicPreview({
      extracted: baseline,
      rules: evaluateRules(baseline, userProfile),
    });
    expect(aspirationalScore.score.total).toBeLessThanOrEqual(baselineScore.score.total);
  });
});
