import { describe, expect, it } from "vitest";
import {
  extractPreScoringMetadata,
  looksLikeTeamOrgQualifier,
  parseCommaTitleCompany,
} from "../../tools/preScoringMetadataExtract.js";

describe("parseCommaTitleCompany — team vs company", () => {
  it("does not treat Reflections / AI Platforms / Interactive News as company", () => {
    expect(parseCommaTitleCompany("Software Engineer, Reflections")).toBeNull();
    expect(parseCommaTitleCompany("Software Engineer, AI Platforms")).toBeNull();
    expect(parseCommaTitleCompany("Software Engineer, Interactive News")).toBeNull();
    expect(looksLikeTeamOrgQualifier("Reflections")).toBe(true);
    expect(looksLikeTeamOrgQualifier("Acme Technologies")).toBe(false);
  });

  it("still splits real Title, Company lines", () => {
    expect(parseCommaTitleCompany("Software Engineer, Google")).toEqual({
      jobTitle: "Software Engineer",
      companyName: "Google",
    });
    expect(parseCommaTitleCompany("Backend Engineer, Acme Technologies")).toEqual({
      jobTitle: "Backend Engineer",
      companyName: "Acme Technologies",
    });
  });

  it("preserves full team-qualified title when it is the first JD line", () => {
    const meta = extractPreScoringMetadata(
      "Software Engineer, Reflections\nThe New York Times\nNew York, NY",
    );
    expect(meta.jobTitle).toBe("Software Engineer, Reflections");
  });
});
