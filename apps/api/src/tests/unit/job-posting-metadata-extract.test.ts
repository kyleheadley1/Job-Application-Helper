import { describe, expect, it } from "vitest";
import {
  extractCompanyName,
  extractJobPostingMetadata,
  validateExtractedCompany,
} from "../../tools/jobPostingMetadataExtract.js";

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
});
