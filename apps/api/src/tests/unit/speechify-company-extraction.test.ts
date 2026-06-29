import { describe, expect, it } from "vitest";
import { applyCompanyPresentation } from "../../tools/companyExtraction.js";
import {
  extractCompanyFromDomain,
  extractCompanyFromSelfDescription,
  extractCompanyFromViewMoreJobs,
  isCompanyNameStopword,
  isValidCompanyCandidate,
  resolveCompanyFromText,
} from "../../tools/companyCandidateRules.js";
import { extractCompanyName } from "../../tools/jobPostingMetadataExtract.js";
import type { ExtractedJobData } from "../../types/job.js";

export const SPEECHIFY_JD = `
Tech Lead, AI Platform
position
New York, NY
time
Full-time
remote
Hybrid
seniority
Senior Level
money
$180K/yr - $220K/yr

This is a key role on our AI platform team. You will partner with senior engineers and technical leaders.

View 192 more jobs at Speechify
Follow Speechify
https://jobs.ashbyhq.com/speechify/tech-lead-ai?utm_source=speechify.com

Responsibilities
Build LLM-powered reading and listening experiences.
`.trim();

function jobHeaderLabel(extracted: Pick<ExtractedJobData, "companyDisplayName" | "title">): string {
  return `${extracted.companyDisplayName} - ${extracted.title}`;
}

describe("Speechify company extraction", () => {
  it("rejects sentence-starter stopwords like This", () => {
    expect(isCompanyNameStopword("This")).toBe(true);
    expect(isValidCompanyCandidate("This")).toBe(false);
    expect(extractCompanyFromSelfDescription("This is a key role on our AI platform team.")).toBeNull();
  });

  it("extracts Speechify from structured JD signals, not body prose", () => {
    expect(extractCompanyFromViewMoreJobs(SPEECHIFY_JD)).toBe("Speechify");
    expect(extractCompanyFromDomain(SPEECHIFY_JD)).toBe("Speechify");
    expect(extractCompanyName(SPEECHIFY_JD)).toBe("Speechify");
    expect(resolveCompanyFromText(SPEECHIFY_JD)).toBe("Speechify");
  });

  it("sets display fields and header label to Speechify — Tech Lead...", () => {
    const presented = applyCompanyPresentation({
      company: "This",
      title: "Tech Lead, AI Platform",
      rawText: SPEECHIFY_JD,
      stack: [],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: [],
    });

    expect(presented.companyDisplayName).toBe("Speechify");
    expect(presented.listingCompanyName).toBe("Speechify");
    expect(presented.companyConfidence).toBe("direct_or_unclear");
    expect(presented.companyExtractionNotes?.some((n) => /sentence-starter false positive/i.test(n))).toBe(
      true,
    );
    expect(jobHeaderLabel(presented)).toBe("Speechify - Tech Lead, AI Platform");
  });

  it("marks low confidence when only stopword candidates exist", () => {
    const jd = "This is a key role. We are hiring engineers.";
    const presented = applyCompanyPresentation({
      company: "This",
      title: "Engineer",
      rawText: jd,
      stack: [],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: [],
    });

    expect(presented.companyDisplayName).toBe("Unknown Company");
    expect(presented.companyConfidence).toBe("low");
    expect(presented.companyExtractionNotes).toContain("company name uncertain — verify");
  });
});
