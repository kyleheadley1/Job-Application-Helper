import { describe, expect, it } from "vitest";
import {
  locationInText,
  normalizeForMatch,
  strictTitleSimilarity,
  textSimilarity,
  titleInText,
} from "../../services/gmail/jdRecovery/titleMatch.js";

describe("strictTitleSimilarity", () => {
  it("treats reordered or punctuated versions of the same title as equal", () => {
    expect(strictTitleSimilarity("Full Stack Software Engineer", "Software Engineer, Full-Stack")).toBe(1);
    expect(strictTitleSimilarity("Software Engineer - 2027 New Grads", "Software Engineer, 2027 New Grad")).toBe(1);
  });

  it("keeps level markers and penalizes broader titles", () => {
    expect(strictTitleSimilarity("Software Engineer I", "Software Engineer II")).toBeLessThan(0.8);
    expect(strictTitleSimilarity("Software Engineer", "Software Engineer, Data Platform")).toBeLessThan(0.8);
    expect(strictTitleSimilarity("Software Engineer", "Senior Software Engineer")).toBeLessThan(0.8);
  });

  it("expands the SE abbreviation", () => {
    expect(strictTitleSimilarity("SE II - Platform", "Software Engineer II, Platform")).toBe(1);
  });
});

describe("email text checks", () => {
  const email = normalizeForMatch("Thanks for applying to Software Engineer, Frontend (New York, NY)!");

  it("finds whole titles and cities in the email", () => {
    expect(titleInText("Software Engineer - Frontend", email)).toBe(true);
    expect(titleInText("Software Engineer - Backend", email)).toBe(false);
    expect(locationInText("New York, NY", email)).toBe(true);
    expect(locationInText("San Francisco, CA", email)).toBe(false);
  });

  it("ignores generic locations like Remote", () => {
    expect(locationInText("Remote - US", normalizeForMatch("this role is remote"))).toBe(false);
  });
});

describe("textSimilarity", () => {
  const jd = Array.from({ length: 100 }, (_, i) => `Build feature ${i} and own outcome ${i * 3}.`).join(" ");
  it("is near 1 for the same JD with a different location line and low for different JDs", () => {
    expect(textSimilarity(`Austin, TX\n${jd}`, `Denver, CO\n${jd}`)).toBeGreaterThan(0.9);
    expect(textSimilarity(jd, "Own the data warehouse and dbt models for analytics. ".repeat(20))).toBeLessThan(0.1);
  });
});
