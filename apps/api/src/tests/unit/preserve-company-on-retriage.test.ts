import { describe, expect, it } from "vitest";
import {
  companyHintFromExtracted,
  preserveCompanyOnRetriage,
} from "../../lib/preserveCompanyOnRetriage.js";
import type { ExtractedJobData } from "../../types/job.js";

const baseExtracted = (overrides: Partial<ExtractedJobData>): ExtractedJobData => ({
  company: "Unknown Company",
  title: "Junior Full Stack Developer",
  stack: [],
  requiredSkills: [],
  preferredSkills: [],
  domainTags: [],
  responsibilities: [],
  requirements: [],
  ...overrides,
});

describe("preserveCompanyOnRetriage", () => {
  it("extracts company hint from presentation fields", () => {
    const hint = companyHintFromExtracted(
      baseExtracted({
        company: "Unknown Company",
        companyDisplayName: "e.Republic",
        listingCompanyName: "e.Republic",
      }),
    );
    expect(hint).toBe("e.Republic");
  });

  it("restores e.Republic when fresh extraction degrades to Unknown Company", () => {
    const previous = baseExtracted({
      company: "e.Republic",
      listingCompanyName: "e.Republic",
      companyDisplayName: "e.Republic",
    });
    const fresh = baseExtracted({
      company: "Unknown Company",
      companyDisplayName: "Unknown Company",
      listingCompanyName: undefined,
    });

    const merged = preserveCompanyOnRetriage(previous, fresh);
    expect(merged.company).toBe("e.Republic");
    expect(merged.companyDisplayName).toBe("e.Republic");
    expect(merged.listingCompanyName).toBe("e.Republic");
  });

  it("does not override when fresh extraction finds a concrete company", () => {
    const previous = baseExtracted({ company: "OldCo", companyDisplayName: "OldCo" });
    const fresh = baseExtracted({ company: "NewCo", companyDisplayName: "NewCo" });
    expect(preserveCompanyOnRetriage(previous, fresh).company).toBe("NewCo");
  });
});
