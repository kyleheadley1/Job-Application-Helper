import { describe, expect, it } from "vitest";
import { applyCompanyPresentation } from "../../tools/companyExtraction.js";
import {
  ensureCompanyName,
  extractCompanyFromRecruiterDisclaimer,
  resolveCompanyFromText,
} from "../../tools/companyCandidateRules.js";
import { mergeExtractedWithHeuristics } from "../../tools/deterministicRawTextExtract.js";
import type { ExtractedJobData } from "../../types/job.js";

const MNJ_JD = `
Experience Implementing REST Architecture preferred
Certification: Optional

Benefits
Reimbursement: Best in Industry
Workplace: Remote (Work From Home)
Job Type: Permanent / Contract [Depends on Project Needs or C2H]
Position Type: Full time [Monday – Friday]
No Fee THE MNJ SOFTWARE DOES NOT CHARGE A FEE AT ANY STAGE OF THE RECRUITMENT PROCESS (APPLICATION, INTERVIEW MEETING, PROCESSING, OR TRAINING).
`.trim();

const emptyExtracted = (): ExtractedJobData => ({
  company: "",
  title: "Software Engineer",
  rawText: MNJ_JD,
  stack: [],
  requiredSkills: [],
  preferredSkills: [],
  domainTags: [],
  responsibilities: [],
  requirements: [],
});

describe("company name never blank after extraction", () => {
  it("extracts MNJ SOFTWARE from recruiter no-fee disclaimer", () => {
    expect(extractCompanyFromRecruiterDisclaimer(MNJ_JD)).toBe("MNJ SOFTWARE");
    expect(resolveCompanyFromText(MNJ_JD)).toBe("MNJ SOFTWARE");
  });

  it("merge never leaves company empty when LLM returned blank", () => {
    const merged = mergeExtractedWithHeuristics(emptyExtracted(), {
      partial: {},
      inferredFields: [],
    });
    expect(merged.company.length).toBeGreaterThan(0);
    expect(merged.company).toBe("MNJ SOFTWARE");
  });

  it("applyCompanyPresentation falls back to display name when listing is unknown", () => {
    const presented = applyCompanyPresentation({
      ...emptyExtracted(),
      company: "",
    });
    expect(presented.company.length).toBeGreaterThan(0);
    expect(presented.companyDisplayName?.length).toBeGreaterThan(0);
  });

  it("ensureCompanyName coerces blank to Unknown Company", () => {
    expect(ensureCompanyName("")).toBe("Unknown Company");
    expect(ensureCompanyName("  ")).toBe("Unknown Company");
    expect(ensureCompanyName("Acme")).toBe("Acme");
  });
});
