import { describe, expect, it } from "vitest";
import {
  extractCompanyFromSelfDescription,
  extractHeaderCompanyBeforeActivity,
  isActivityTimestampLine,
  isHardRejectedCompanyCandidate,
  looksLikeBrandCompanyName,
} from "../../tools/companyCandidateRules.js";

describe("companyCandidateRules", () => {
  it("detects repost/posted activity lines", () => {
    expect(isActivityTimestampLine("· Reposted 48 minutes ago")).toBe(true);
    expect(isActivityTimestampLine("· 2 days ago")).toBe(true);
    expect(isActivityTimestampLine("· Posted 3 hours ago")).toBe(true);
  });

  it("rejects prose and punctuation-heavy candidates", () => {
    expect(isHardRejectedCompanyCandidate("stakeholders including mathematicians")).toBe(true);
    expect(isHardRejectedCompanyCandidate("Acme, Inc.")).toBe(false);
    expect(isHardRejectedCompanyCandidate("Entry Level")).toBe(true);
    expect(isHardRejectedCompanyCandidate("a very long company name that reads like a sentence")).toBe(true);
  });

  it("accepts short brand-like names", () => {
    expect(looksLikeBrandCompanyName("Battelle")).toBe(true);
    expect(looksLikeBrandCompanyName("Acme AI")).toBe(true);
    expect(looksLikeBrandCompanyName("Bank of America")).toBe(true);
  });

  it("extracts header company before activity timestamp", () => {
    const lines = ["Battelle", "· Reposted 48 minutes ago", "Software Engineer (Early Career)"];
    expect(extractHeaderCompanyBeforeActivity(lines)).toBe("Battelle");
  });

  it("extracts self-description leading proper noun", () => {
    const text = "Battelle is a research and development organization committed to science.";
    expect(extractCompanyFromSelfDescription(text)).toBe("Battelle");
  });
});
