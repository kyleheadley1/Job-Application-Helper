import { describe, expect, it } from "vitest";
import { resolveCompanyPresentation } from "../../tools/companyExtraction.js";

describe("resolveCompanyPresentation", () => {
  it("case A: listing company self-described as employer (direct_or_unclear)", () => {
    const jd = `
Mentor Talent Acquisition is a fast-growing, profitable technology company building hiring tools.
We are hiring a Senior Software Engineer.
    `.trim();
    const out = resolveCompanyPresentation({
      listingCompanyName: "Mentor Talent Acquisition",
      rawText: jd,
    });
    expect(out.listingCompanyName).toBe("Mentor Talent Acquisition");
    expect(out.companyDisplayName).toBe("Mentor Talent Acquisition");
    expect(out.companyConfidence).toBe("direct_or_unclear");
    expect(out.agencyCompanyName).toBeNull();
    expect(out.employerCompanyName).toBeNull();
  });

  it("case B: agency representing undisclosed client (agency_only)", () => {
    const jd = `
Mentor Talent Acquisition is working with a fast-growing technology company to hire a Senior Software Engineer.
    `.trim();
    const out = resolveCompanyPresentation({
      listingCompanyName: "Mentor Talent Acquisition",
      rawText: jd,
    });
    expect(out.agencyCompanyName).toBe("Mentor Talent Acquisition");
    expect(out.employerCompanyName).toBeNull();
    expect(out.companyDisplayName).toBe("Mentor Talent Acquisition client");
    expect(out.companyConfidence).toBe("agency_only");
  });

  it("case C: explicit employer named in JD (explicit_employer)", () => {
    const jd = `
Recruiting Firm X is hiring on behalf of our client.
Our client, Acme AI, is hiring a Platform Engineer.
    `.trim();
    const out = resolveCompanyPresentation({
      listingCompanyName: "Recruiting Firm X",
      rawText: jd,
    });
    expect(out.agencyCompanyName).toBe("Recruiting Firm X");
    expect(out.employerCompanyName).toBe("Acme AI");
    expect(out.companyDisplayName).toBe("Acme AI");
    expect(out.companyConfidence).toBe("explicit_employer");
  });

  it("does not hallucinate employer from vague fast-growing company phrasing alone", () => {
    const jd = "We are partnering with a fast-growing technology company on a confidential search.";
    const out = resolveCompanyPresentation({
      listingCompanyName: "Search Partners LLC",
      rawText: jd,
    });
    expect(out.employerCompanyName).toBeNull();
    expect(out.companyConfidence).toBe("agency_only");
  });
});
