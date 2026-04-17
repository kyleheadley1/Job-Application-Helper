import { describe, expect, it } from "vitest";
import { resolveResumeCandidatePaths } from "../../config/resumeContext.js";

describe("resume context path lookup", () => {
  it("prefers txt then pdf for SWE", () => {
    const paths = resolveResumeCandidatePaths("SWE");
    expect(paths[0].endsWith("swe_resume.txt")).toBe(true);
    expect(paths[1].endsWith("swe_resume.pdf")).toBe(true);
  });

  it("prefers txt then pdf for SIE", () => {
    const paths = resolveResumeCandidatePaths("SIE");
    expect(paths[0].endsWith("sie_resume.txt")).toBe(true);
    expect(paths[1].endsWith("sie_resume.pdf")).toBe(true);
  });

  it("prefers txt then pdf for EARLY_CAREER", () => {
    const paths = resolveResumeCandidatePaths("EARLY_CAREER");
    expect(paths[0].endsWith("early_career_resume.txt")).toBe(true);
    expect(paths[1].endsWith("early_career_resume.pdf")).toBe(true);
  });
});
