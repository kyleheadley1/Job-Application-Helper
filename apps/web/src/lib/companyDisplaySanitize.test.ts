import { describe, expect, it } from "vitest";
import {
  headerCompanyFromRawText,
  isProseCompanyName,
  pickDisplayCompanyName,
} from "./companyDisplaySanitize";

const BATTELLE_JD = `
Battelle
· Reposted 48 minutes ago
Software Engineer (Early Career)
position
United States
Responsibilities
Communicating on a regular basis with project leaders, team members and client stakeholders including mathematicians
`.trim();

const PALLET_JD = `
Product & Deployment Engineer
Posted on 6/19/2026
Pallet
Pallet
11-50 employees
San Francisco, CA, USA + 1 more
United States
`.trim();

describe("companyDisplaySanitize", () => {
  it("rejects prose misclassified as company", () => {
    expect(isProseCompanyName("stakeholders including mathematicians")).toBe(true);
    expect(isProseCompanyName("us")).toBe(true);
    expect(isProseCompanyName("United States")).toBe(true);
  });

  it("recovers Battelle from raw header when stored fields are wrong", () => {
    expect(
      pickDisplayCompanyName(
        ["stakeholders including mathematicians", undefined, "stakeholders including mathematicians"],
        BATTELLE_JD,
      ),
    ).toBe("Battelle");
    expect(headerCompanyFromRawText(BATTELLE_JD)).toBe("Battelle");
  });

  it("recovers Pallet from raw header when stored fields are wrong", () => {
    expect(pickDisplayCompanyName(["us", "US", "United States"], PALLET_JD)).toBe("Pallet");
  });
});
