import { describe, expect, it } from "vitest";
import { extractBoardMatchPercent, isBoardMatchChromeLine } from "../../tools/jobBoardMatchExtract.js";

describe("jobBoardMatchExtract", () => {
  it("detects board match chrome lines", () => {
    expect(isBoardMatchChromeLine("77%")).toBe(true);
    expect(isBoardMatchChromeLine("STRONG MATCH")).toBe(true);
    expect(isBoardMatchChromeLine("Acme AI")).toBe(false);
  });

  it("extracts percent from Next Match-style paste", () => {
    const raw = ["77%", "STRONG MATCH", "Experience. Level", "Skill Match", "Acme AI", "Software Engineer"].join("\n");
    expect(extractBoardMatchPercent(raw)).toBe(77);
  });

  it("extracts inline strong match percent", () => {
    expect(extractBoardMatchPercent("98% STRONG MATCH\nSoftware Engineer")).toBe(98);
  });
});
