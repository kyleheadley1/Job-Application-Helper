import { describe, expect, it } from "vitest";
import { extractPreScoringMetadata, normalizeLocationPrefixedTitle } from "../../tools/preScoringMetadataExtract.js";
import { extractJobPostingMetadata } from "../../tools/jobPostingMetadataExtract.js";
import { extractFromRawText, mergeExtractedWithHeuristics } from "../../tools/deterministicRawTextExtract.js";
import type { ExtractedJobData } from "../../types/job.js";

const CASE_A = `
Next Match AI
· 11 hours ago
Junior Developer
position
United States
time
Full-time
remote
Remote
seniority
Entry Level
`.trim();

const CASE_B = `
Full Stack Software Engineer, Plaid
$176.4-243.6k
Offers Equity
Junior and Mid level

Plaid
Data network powering...
`.trim();

const CASE_C = `
Fullstack Engineer, Patreon
Creator Home
$189-255.5k

Patreon
Funding platform for creatives
`.trim();

const CASE_D = `United States - Junior Developer`;

describe("pre-scoring metadata extract (scraped layouts)", () => {
  it("case A: Next Match AI junior developer", () => {
    const meta = extractPreScoringMetadata(CASE_A);
    expect(meta.companyName).toBe("Next Match AI");
    expect(meta.jobTitle).toBe("Junior Developer");
    expect(meta.location).toBe("United States");
    expect(meta.confidence).toBe("high");
  });

  it("case B: comma-split Plaid full stack role", () => {
    const meta = extractPreScoringMetadata(CASE_B);
    expect(meta.companyName).toBe("Plaid");
    expect(meta.jobTitle).toBe("Full Stack Software Engineer");
    expect(meta.confidence).toBe("high");
  });

  it("case C: comma-split Patreon fullstack role", () => {
    const meta = extractPreScoringMetadata(CASE_C);
    expect(meta.companyName).toBe("Patreon");
    expect(meta.jobTitle).toBe("Fullstack Engineer");
  });

  it("case D: strips location prefix from malformed title", () => {
    const meta = extractPreScoringMetadata(CASE_D);
    expect(meta.jobTitle).toBe("Junior Developer");
    expect(meta.location).toBe("United States");
    expect(normalizeLocationPrefixedTitle("New York, NY - Full Stack Engineer").jobTitle).toBe(
      "Full Stack Engineer",
    );
  });

  it("does not use position label value as job title", () => {
    const meta = extractPreScoringMetadata(CASE_A);
    expect(meta.jobTitle).not.toBe("United States");
    expect(meta.rawTitleSource).toBe("Junior Developer");
  });

  it("merge fixes LLM location-prefixed title", () => {
    const llm: ExtractedJobData = {
      company: "Unknown Company",
      title: "United States - Junior Developer",
      remoteType: "unknown",
      stack: [],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: [],
      rawText: CASE_A,
    };
    const heur = extractFromRawText(CASE_A);
    const merged = mergeExtractedWithHeuristics(llm, heur);
    expect(merged.company).toBe("Next Match AI");
    expect(merged.title).toBe("Junior Developer");
    expect(merged.location).toBe("United States");
  });

  it("extractJobPostingMetadata integrates pre-scoring with high confidence", () => {
    const meta = extractJobPostingMetadata(CASE_A);
    expect(meta.companyName).toBe("Next Match AI");
    expect(meta.jobTitle).toBe("Junior Developer");
    expect(meta.location).toBe("United States");
    expect(meta.preScoring?.confidence).toBe("high");
  });
});
