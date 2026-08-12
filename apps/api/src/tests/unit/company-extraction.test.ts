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

  it("Craft Digital: does not treat 'the client stack' responsibility prose as explicit employer", () => {
    const jd = `
Craft Digital
· 2 hours ago
Junior Engineer
position
United States
Craft Digital is a company that focuses on delivering effective engineering solutions.
Responsibilities
Build dashboards, integrations, and features across the client stack
Ask great questions, then drive yourself to the answer
    `.trim();
    const out = resolveCompanyPresentation({
      listingCompanyName: "Craft Digital",
      rawText: jd,
    });
    expect(out.companyDisplayName).toBe("Craft Digital");
    expect(out.listingCompanyName).toBe("Craft Digital");
    expect(out.employerCompanyName).toBeNull();
    expect(out.companyConfidence).toBe("direct_or_unclear");
  });

  it("does not treat 'working with computers' product prose as agency representation", () => {
    const jd = `
Junior AI
Junior AI
Compensation Overview
Junior is building the AI operating system for investment research.
Design and build new modes of working with computers
Talk directly to the clients who use what you build
    `.trim();
    const out = resolveCompanyPresentation({
      listingCompanyName: "Junior AI",
      rawText: jd,
    });
    expect(out.companyDisplayName).toBe("Junior AI");
    expect(out.companyConfidence).not.toBe("agency_only");
    expect(out.agencyCompanyName).toBeNull();
  });

  it("prefers Rollout card over About This Role body false positive", () => {
    const jd = `
Rollout
Rollout
1-10 employees
About This Role
In person, NYC. We work together in the New York City area.
You're the team's go-to authority on AI-assisted development.
you go find the answer rather than wait to be handed one.
    `.trim();
    const out = resolveCompanyPresentation({
      listingCompanyName: "Rollout",
      rawText: jd,
    });
    expect(out.companyDisplayName).toBe("Rollout");
    expect(out.employerCompanyName).not.toBe("This Role");
    expect(out.companyConfidence).not.toBe("low");
  });
});
