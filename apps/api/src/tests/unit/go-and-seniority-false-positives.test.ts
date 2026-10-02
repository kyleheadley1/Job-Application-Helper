import { describe, expect, it } from "vitest";
import { goMentionedAsPreferred, textMentionsGoLanguage } from "../../lib/goLanguage.js";
import {
  detectRoleSeniorityOverreach,
  seniorityFieldUncorroborated,
  seniorityNeedsManualReview,
} from "../../lib/seniorityGate.js";
import { extractFromRawText } from "../../tools/deterministicRawTextExtract.js";
import type { ExtractedJobData } from "../../types/job.js";

const SURGE_LIKE_JD = [
  "Software Engineer, Coding Evaluation & Training Data",
  "We build rich RL environments and conduct rigorous evaluations that go beyond benchmarks.",
  "Partner with technical staff at our clients to translate high-level training goals into projects.",
  "2–6+ years of professional software engineering experience building and maintaining real systems.",
  "Excellent written and verbal communication skills, with the ability to speak credibly with senior client engineers.",
].join("\n");

describe("Go language detection ignores English 'go'", () => {
  it.each([
    "evaluations that go beyond benchmarks",
    "Go above and beyond for customers",
    "Ready to go? Let's go build.",
    "work on the go",
    "our go-to-market team",
    "you'll go deep on infrastructure",
    "Go fast and own outcomes",
  ])("no match: %s", (text) => {
    expect(textMentionsGoLanguage(text)).toBe(false);
  });

  it.each([
    "Experience with Python, Go, or Rust",
    "Backend services in Go and Postgres",
    "Go/Java microservices",
    "Languages: TypeScript, Go",
    "Tech stack: Kafka, Go, Kubernetes",
    "We use Golang heavily",
    "- Go\n- Postgres",
    "proficiency in Go",
    "Go services handling high throughput",
    "experience with python, go, or rust",
  ])("match: %s", (text) => {
    expect(textMentionsGoLanguage(text)).toBe(true);
  });

  it("treats Go as preferred only when it sits on a preferred line", () => {
    expect(goMentionedAsPreferred("Nice to have: Go or Rust experience")).toBe(true);
    expect(goMentionedAsPreferred("Plus points for teams that go beyond")).toBe(false);
  });
});

describe("deterministic extraction on a Surge-like JD", () => {
  const { partial } = extractFromRawText(SURGE_LIKE_JD, "Surge");

  it("does not invent Go as a required skill", () => {
    expect(partial.stack ?? []).not.toContain("Go");
    expect(partial.requiredSkills ?? []).not.toContain("Go");
  });

  it("does not label the role senior from body prose", () => {
    expect(partial.seniority).not.toBe("senior");
    expect(partial.yearsExperience?.min).toBe(2);
  });
});

describe("seniority gate needs corroboration for a senior field", () => {
  const base: ExtractedJobData = {
    company: "Surge",
    title: "Software Engineer, Coding Evaluation & Training Data",
    stack: [],
    requiredSkills: [],
    preferredSkills: [],
    domainTags: [],
    responsibilities: [],
    requirements: [],
    seniority: "senior",
    yearsExperience: { raw: "2–6+ years", min: 2, max: 6 },
    rawText: SURGE_LIKE_JD,
  };

  it("does not gate an inferred senior label with a clean title and years ≤4", () => {
    expect(seniorityFieldUncorroborated(base)).toBe(true);
    expect(seniorityNeedsManualReview(base)).toBe(true);
    expect(detectRoleSeniorityOverreach(base)).toBe(false);
  });

  it("still gates when the posting backs it up", () => {
    expect(detectRoleSeniorityOverreach({ ...base, title: "Senior Software Engineer" })).toBe(true);
    expect(detectRoleSeniorityOverreach({ ...base, yearsExperience: { raw: "6+ years", min: 6 } })).toBe(true);
    expect(
      detectRoleSeniorityOverreach({ ...base, rawText: `Seniority\nSenior Level\n${SURGE_LIKE_JD}` }),
    ).toBe(true);
  });
});
