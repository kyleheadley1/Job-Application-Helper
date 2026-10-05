import { describe, expect, it } from "vitest";
import { exampleUserProfile } from "../../config/userProfile.example.js";
import { isPortfolioForwardMatch } from "../../lib/survivabilityScore.js";
import type { ExtractedJobData } from "../../types/job.js";

const jd = (title: string, rawText: string) =>
  ({ company: "Co", title, stack: [], requiredSkills: [], preferredSkills: [], domainTags: [], rawText }) as ExtractedJobData;

describe("portfolio-forward listings", () => {
  it("matches a listing that screens on personal projects and open source", () => {
    const telcor = jd(
      "AI Platform Engineer",
      "Strong candidates will also show evidence of personal projects and open source contributions.",
    );
    expect(isPortfolioForwardMatch(telcor, exampleUserProfile, "")).toBe(true);
  });

  it("ignores 'portfolio' in the finance sense", () => {
    const addepar = jd("Portfolio Services Engineer", "Build backend tooling for portfolio services and portfolio analytics.");
    expect(isPortfolioForwardMatch(addepar, exampleUserProfile, "")).toBe(false);
  });
});
