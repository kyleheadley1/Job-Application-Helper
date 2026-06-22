import { describe, expect, it } from "vitest";
import {
  extractCompanyName,
  extractJobPostingMetadata,
  scoreCompanyCandidates,
  validateExtractedCompany,
} from "../../tools/jobPostingMetadataExtract.js";
import { applyCompanyPresentation } from "../../tools/companyExtraction.js";
import {
  isHardRejectedCompanyCandidate,
  looksLikeBrandCompanyName,
} from "../../tools/companyCandidateRules.js";

const CASE_1 = `
Contract

Open user menu

AI Enablement Engineer
Updated on 5/26/2026

Unlock job analytics with
Simplify+
GreenLite
GreenLite
51-200 employees
Permit management and code compliance services
`.trim();

const CASE_2 = `
Forward Deployed AI Engineer
Updated on 5/26/2026
Unlock job analytics with
Simplify+
CLEAR
CLEAR
1,001-5,000 employees
Subscription-based biometric identity verification lanes
`.trim();

const CASE_3 = `
Full-time
Software Engineer, Backend
Updated on 5/26/2026
Acme AI
51-200 employees
AI infrastructure startup
`.trim();

const BATTELLE_JD = `
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
stakeholders including mathematicians
Conduct research and development work
Qualification
Required
Bachelor's degree in computer science
Battelle is a research and development organization committed to science and technology.
`.trim();

describe("job posting metadata extract (Simplify-style)", () => {
  it("case 1: GreenLite contract role", () => {
    const meta = extractJobPostingMetadata(CASE_1);
    expect(meta.companyName).toBe("GreenLite");
    expect(meta.jobTitle).toBe("AI Enablement Engineer");
    expect(meta.employmentType).toBe("Contract");
    expect(extractCompanyName(CASE_1)).toBe("GreenLite");
  });

  it("case 2: CLEAR repeated before employee count", () => {
    const meta = extractJobPostingMetadata(CASE_2);
    expect(meta.companyName).toBe("CLEAR");
    expect(meta.jobTitle).toBe("Forward Deployed AI Engineer");
  });

  it("case 3: Acme AI full-time backend role", () => {
    const meta = extractJobPostingMetadata(CASE_3);
    expect(meta.companyName).toBe("Acme AI");
    expect(meta.jobTitle).toBe("Software Engineer, Backend");
    expect(meta.employmentType).toBe("Full-time");
  });

  it("validateExtractedCompany recovers from Unknown when duplicate precedes employee count", () => {
    expect(validateExtractedCompany("Unknown Company", CASE_1)).toBe("GreenLite");
    expect(validateExtractedCompany("Contract", CASE_1)).toBe("GreenLite");
  });

  it("validateExtractedCompany rejects LLM prose company in favor of Battelle header", () => {
    expect(validateExtractedCompany("stakeholders including mathematicians", BATTELLE_JD)).toBe("Battelle");
  });

  it("Battelle: header company before repost timestamp, not body prose", () => {
    expect(isHardRejectedCompanyCandidate("stakeholders including mathematicians")).toBe(true);
    expect(looksLikeBrandCompanyName("stakeholders including mathematicians")).toBe(false);
    expect(looksLikeBrandCompanyName("Battelle")).toBe(true);

    const lines = BATTELLE_JD.split("\n").map((l) => l.trim()).filter(Boolean);
    const candidates = scoreCompanyCandidates(lines);
    expect(candidates.some((c) => c.line === "stakeholders including mathematicians")).toBe(false);
    expect(candidates[0]?.line).toBe("Battelle");

    const meta = extractJobPostingMetadata(BATTELLE_JD);
    expect(meta.companyName).toBe("Battelle");
    expect(meta.jobTitle).toBe("Software Engineer (Early Career)");
    expect(extractCompanyName(BATTELLE_JD)).toBe("Battelle");

    const presented = applyCompanyPresentation({
      company: meta.companyName!,
      title: meta.jobTitle!,
      rawText: BATTELLE_JD,
      listingCompanyName: meta.companyName!,
      companyDisplayName: meta.companyName!,
      stack: [],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: [],
    });
    expect(presented.companyDisplayName).toBe("Battelle");
    expect(presented.listingCompanyName).toBe("Battelle");
    expect(presented.title).toBe("Software Engineer (Early Career)");
    const headerLabel = `${presented.companyDisplayName} - ${presented.title}`;
    expect(headerLabel).toBe("Battelle - Software Engineer (Early Career)");
  });
});
