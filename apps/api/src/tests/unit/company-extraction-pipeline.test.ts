import { describe, expect, it } from "vitest";
import { applyCompanyPresentation } from "../../tools/companyExtraction.js";
import {
  COMPANY_SOURCE_RANK,
  extractCompanyFromAboutHeader,
  extractCompanyFromPostedHeader,
  extractDuplicateCompanyBeforeEmployeeCount,
  isValidCompanyCandidate,
  normalizeJobLines,
  pickBestCompanyCandidate,
  resolveCompanyFromText,
} from "../../tools/companyCandidateRules.js";
import { extractCompanyName, extractJobPostingMetadata } from "../../tools/jobPostingMetadataExtract.js";
import { extractFromRawText, mergeExtractedWithHeuristics } from "../../tools/deterministicRawTextExtract.js";
import type { ExtractedJobData } from "../../types/job.js";

export const BATTELLE_JD = `
Battelle
· Reposted 48 minutes ago
Software Engineer (Early Career)
position
United States
time
Full-time
remote
Hybrid
seniority
Entry Level
money
No salary listed
Responsibilities
Communicating on a regular basis with project leaders, team members and client stakeholders including mathematicians
Conduct research and development work
Qualification
Required
Battelle is a research and development organization committed to science and technology.
`.trim();

export const PALLET_JD = `
Product & Deployment Engineer
Posted on 6/19/2026

Unlock job analytics with
Simplify+
Pallet
Pallet
11-50 employees

Platform matching niche talent with employers
San Francisco, CA, USA + 1 more
More locations: New York, NY, USA
Remote across the U.S.
United States
`.trim();

function jobHeaderLabel(extracted: {
  companyDisplayName?: string;
  title: string;
}): string {
  return `${extracted.companyDisplayName} - ${extracted.title}`;
}

describe("Battelle company extraction", () => {
  it("extracts Battelle from posted header", () => {
    expect(extractCompanyName(BATTELLE_JD)).toBe("Battelle");
    expect(extractCompanyFromPostedHeader(normalizeJobLines(BATTELLE_JD))).toBe("Battelle");
  });

  it("rejects body prose as company", () => {
    expect(isValidCompanyCandidate("stakeholders including mathematicians")).toBe(false);
    expect(
      isValidCompanyCandidate(
        "Communicating on a regular basis with project leaders, team members and client stakeholders including mathematicians",
      ),
    ).toBe(false);
  });

  it("sets display fields correctly", () => {
    const meta = extractJobPostingMetadata(BATTELLE_JD);
    const heur = extractFromRawText(BATTELLE_JD);
    const merged = mergeExtractedWithHeuristics(
      {
        company: "stakeholders including mathematicians",
        title: meta.jobTitle!,
        remoteType: "unknown",
        stack: [],
        requiredSkills: [],
        preferredSkills: [],
        domainTags: [],
        responsibilities: [],
        requirements: [],
        rawText: BATTELLE_JD,
      } satisfies ExtractedJobData,
      heur,
    );
    const presented = applyCompanyPresentation(merged);

    expect(presented.company).toBe("Battelle");
    expect(presented.listingCompanyName).toBe("Battelle");
    expect(presented.companyDisplayName).toBe("Battelle");
    expect(presented.title).toBe("Software Engineer (Early Career)");
    expect(jobHeaderLabel(presented)).toBe("Battelle - Software Engineer (Early Career)");
  });
});

describe("Pallet company extraction", () => {
  it("extracts Pallet from duplicated company line before employee count", () => {
    expect(extractCompanyName(PALLET_JD)).toBe("Pallet");
    expect(extractDuplicateCompanyBeforeEmployeeCount(normalizeJobLines(PALLET_JD))).toBe("Pallet");
  });

  it("extracts Pallet from About header as backup", () => {
    const text = `
Product & Deployment Engineer

About Pallet

Pallet is building AI Agents to transform logistics.
`.trim();
    expect(extractCompanyFromAboutHeader(normalizeJobLines(text))).toBe("Pallet");
  });

  it("rejects location and country tokens as companies", () => {
    expect(isValidCompanyCandidate("us")).toBe(false);
    expect(isValidCompanyCandidate("US")).toBe(false);
    expect(isValidCompanyCandidate("USA")).toBe(false);
    expect(isValidCompanyCandidate("U.S.")).toBe(false);
    expect(isValidCompanyCandidate("United States")).toBe(false);
    expect(isValidCompanyCandidate("Remote")).toBe(false);
    expect(isValidCompanyCandidate("In Person")).toBe(false);
    expect(isValidCompanyCandidate("San Francisco, CA, USA + 1 more")).toBe(false);
    expect(isValidCompanyCandidate("More locations: New York, NY, USA")).toBe(false);
  });

  it("sets display fields correctly", () => {
    const meta = extractJobPostingMetadata(PALLET_JD);
    const heur = extractFromRawText(PALLET_JD);
    const merged = mergeExtractedWithHeuristics(
      {
        company: "us",
        title: meta.jobTitle!,
        remoteType: "unknown",
        stack: [],
        requiredSkills: [],
        preferredSkills: [],
        domainTags: [],
        responsibilities: [],
        requirements: [],
        rawText: PALLET_JD,
      } satisfies ExtractedJobData,
      heur,
    );
    const presented = applyCompanyPresentation(merged);

    expect(presented.company).toBe("Pallet");
    expect(presented.listingCompanyName).toBe("Pallet");
    expect(presented.companyDisplayName).toBe("Pallet");
    expect(presented.title).toBe("Product & Deployment Engineer");
    expect(jobHeaderLabel(presented)).toBe("Pallet - Product & Deployment Engineer");
  });
});

describe("company candidate priority", () => {
  it("does not let weak LLM/fallback values overwrite strong header values", () => {
    const candidates = [
      { value: "Pallet", source: "duplicate_before_employee_count" as const, rank: COMPANY_SOURCE_RANK.duplicate_before_employee_count },
      { value: "us", source: "llm" as const, rank: COMPANY_SOURCE_RANK.llm },
    ];
    expect(pickBestCompanyCandidate(candidates)?.value).toBe("Pallet");
  });

  it("does not let body prose overwrite posted header company", () => {
    const candidates = [
      { value: "Battelle", source: "posted_header" as const, rank: COMPANY_SOURCE_RANK.posted_header },
      { value: "stakeholders including mathematicians", source: "fallback_scoring" as const, rank: COMPANY_SOURCE_RANK.fallback_scoring },
    ];
    expect(pickBestCompanyCandidate(candidates)?.value).toBe("Battelle");
  });

  it("resolveCompanyFromText prefers posted header over invalid llm", () => {
    expect(
      resolveCompanyFromText(BATTELLE_JD, {
        llmCompany: "stakeholders including mathematicians",
      }),
    ).toBe("Battelle");
    expect(resolveCompanyFromText(PALLET_JD, { llmCompany: "us" })).toBe("Pallet");
  });
});
