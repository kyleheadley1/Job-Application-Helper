import { describe, expect, it } from "vitest";
import type { ExtractedJobData } from "../../types/job.js";
import { applyCompanyPresentation } from "../../tools/companyExtraction.js";
import { extractFromRawText, mergeExtractedWithHeuristics } from "../../tools/deterministicRawTextExtract.js";
import { validateExtractedCompany } from "../../tools/jobPostingMetadataExtract.js";

const BATTELLE_JD = `
Battelle
· Reposted 48 minutes ago
Software Engineer (Early Career)
position
United States
Responsibilities
stakeholders including mathematicians
Battelle is a research and development organization committed to science and technology.
`.trim();

describe("company extraction end-to-end merge", () => {
  it("overrides LLM prose company with Battelle from deterministic header", () => {
    const llm: ExtractedJobData = {
      company: "stakeholders including mathematicians",
      title: "Software Engineer (Early Career)",
      remoteType: "unknown",
      stack: [],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: [],
      rawText: BATTELLE_JD,
    };
    const heur = extractFromRawText(BATTELLE_JD);
    const merged = mergeExtractedWithHeuristics(llm, heur);
    const company = validateExtractedCompany(merged.company, BATTELLE_JD);
    const presented = applyCompanyPresentation({ ...merged, company: company ?? merged.company });

    expect(merged.company).toBe("Battelle");
    expect(company).toBe("Battelle");
    expect(presented.companyDisplayName).toBe("Battelle");
    expect(presented.title).toBe("Software Engineer (Early Career)");
  });
});
