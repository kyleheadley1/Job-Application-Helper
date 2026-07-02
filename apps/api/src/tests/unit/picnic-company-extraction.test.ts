import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { applyCompanyPresentation } from "../../tools/companyExtraction.js";
import {
  extractBodyHiringEntityFromJd,
  isValidCompanyCandidate,
  resolveCompanyFromText,
} from "../../tools/companyCandidateRules.js";

const picnicFixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../fixtures/calibration/picnicFrontend.json"),
    "utf8",
  ),
);

describe("Picnic / Atoms company extraction", () => {
  const rawText = picnicFixture.extracted.rawText as string;

  it("rejects job-board UI section headers as company names", () => {
    expect(isValidCompanyCandidate("Why This Job")).toBe(false);
    expect(isValidCompanyCandidate("Why This Job is a Match")).toBe(false);
    expect(isValidCompanyCandidate("Full Job Posting")).toBe(false);
    expect(isValidCompanyCandidate("Summary")).toBe(false);
    expect(isValidCompanyCandidate("History")).toBe(false);
  });

  it("extracts Picnic from in-body hiring-entity self description", () => {
    expect(extractBodyHiringEntityFromJd(rawText)).toBe("Picnic");
  });

  it("does not pick Why This Job from pasted Simplify chrome", () => {
    expect(resolveCompanyFromText(rawText)).toBe("Picnic");
    expect(resolveCompanyFromText(rawText, { llmCompany: "Why This Job" })).toBe("Picnic");
  });

  it("surfaces card vs body conflict and prefers Picnic for display", () => {
    const presented = applyCompanyPresentation(
      {
        company: "Why This Job",
        title: "Frontend Engineer",
        rawText,
      },
      "Atoms",
    );

    expect(presented.companyDisplayName).toBe("Picnic");
    expect(presented.listingCompanyName).toBe("Atoms");
    expect(presented.employerCompanyName).toBe("Picnic");
    expect(presented.companyConfidence).toBe("low");
    expect(presented.companyExtractionNotes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/company conflict: card says Atoms, body says Picnic — verify/),
      ]),
    );
  });
});
