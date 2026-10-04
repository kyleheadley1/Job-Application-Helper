import { describe, expect, it, vi } from "vitest";
import {
  BriefSchema,
  buildPrepPrompt,
  resolveBrief,
  roundLine,
  type InterviewBrief,
} from "../../services/gmail/interviewBrief.js";
import type { InterviewRound } from "../../services/gmail/interviewRounds.js";
import type { ApplicationEvaluation } from "../../services/gmail/jdRecovery/evaluations.repository.js";

const evaluation = (over: Partial<ApplicationEvaluation> = {}): ApplicationEvaluation =>
  ({
    key: "acme::software engineer",
    company: "Acme",
    role: "Software Engineer",
    appliedAt: "2026-09-20T00:00:00.000Z",
    recovery: { status: "scored", attempts: [], serperQueries: 0 },
    jd: { text: "Acme builds payroll software for restaurants. You will own our TypeScript API.", textHash: "h" },
    fit: {
      total: 72,
      recommendation: "apply",
      recommendedResume: "BASE",
      scoredAt: "2026-09-21T00:00:00.000Z",
      promptVersion: "v",
      breakdown: { categories: {}, topMatch: "TypeScript APIs", mainRisk: "No Go", risks: ["No Go production experience"] },
    },
    outcome: { status: "interviewing", updatedAt: "2026-09-25T00:00:00.000Z", history: [] },
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...over,
  }) as ApplicationEvaluation;

const brief: InterviewBrief = {
  companyBio: "Payroll software for restaurants.",
  teamNeed: "Own the TypeScript API.",
  strengths: [{ point: "TypeScript APIs", evidence: "Built Express services" }],
  weakPoints: [{ gap: "No Go", probe: "Have you shipped Go?", answer: "Adjacent: typed backends; ramping on Go." }],
  askThem: ["What does the first 90 days look like?"],
  generatedAt: "2026-10-01T00:00:00.000Z",
  promptVersion: "brief-v1",
};

const round: InterviewRound = {
  number: 2,
  kind: "technical",
  focus: "live coding",
  interviewers: "Jane Doe (EM)",
  startedAt: "2026-10-01T00:00:00.000Z",
  lastEmailAt: "2026-10-01T00:00:00.000Z",
  emailIds: [],
  scheduledAt: "2026-10-06T15:00:00.000Z",
  durationMinutes: 45,
  cancelled: false,
  label: "2nd round · technical with Jane Doe",
};

describe("BriefSchema", () => {
  it("caps list lengths and clips long text", () => {
    const long = Array.from({ length: 80 }, (_, i) => `w${i}`).join(" ");
    const item = { point: "p", evidence: "e" };
    const weak = { gap: "g", probe: "q", answer: "a" };
    const parsed = BriefSchema.parse({
      companyBio: long,
      teamNeed: "t",
      strengths: [item, item, item, item, item],
      weakPoints: [weak, weak, weak, weak],
      askThem: ["a", "b", "c"],
    });
    expect(parsed.companyBio.split(" ")).toHaveLength(40);
    expect(parsed.companyBio.endsWith("…")).toBe(true);
    expect(parsed.strengths).toHaveLength(3);
    expect(parsed.weakPoints).toHaveLength(3);
    expect(parsed.askThem).toHaveLength(2);
  });
});

describe("resolveBrief", () => {
  it("never calls the LLM without a recovered JD", async () => {
    const generate = vi.fn();
    expect(await resolveBrief(evaluation({ jd: undefined }), { generate })).toEqual({ brief: null, reason: "no_jd" });
    expect(await resolveBrief(null, { generate })).toEqual({ brief: null, reason: "no_jd" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("returns the stored brief without regenerating", async () => {
    const generate = vi.fn();
    const result = await resolveBrief(evaluation({ interviewBrief: brief }), { generate });
    expect(result.brief).toBe(brief);
    expect(generate).not.toHaveBeenCalled();
  });

  it("generates once and saves when missing", async () => {
    const generate = vi.fn().mockResolvedValue(brief);
    const save = vi.fn().mockResolvedValue(undefined);
    const result = await resolveBrief(evaluation(), { generate, save });
    expect(result.brief).toBe(brief);
    expect(save).toHaveBeenCalledWith("acme::software engineer", brief);
  });

  it("keeps the old brief when a regenerate fails", async () => {
    const generate = vi.fn().mockResolvedValue(null);
    const save = vi.fn();
    const result = await resolveBrief(evaluation({ interviewBrief: brief }), { regenerate: true, generate, save });
    expect(result).toEqual({ brief });
    expect(save).not.toHaveBeenCalled();
  });
});

describe("buildPrepPrompt", () => {
  it("bundles the round, gaps, resume type, and full JD", () => {
    const prompt = buildPrepPrompt({ company: "Acme", role: "Software Engineer", round, evaluation: evaluation(), brief });
    expect(prompt).toContain("Software Engineer at Acme");
    expect(prompt).toContain("BASE resume");
    expect(prompt).toContain("2nd round · technical with Jane Doe · live coding");
    expect(prompt).toContain("Jane Doe (EM)");
    expect(prompt).toContain("No Go (likely probe: Have you shipped Go?)");
    expect(prompt).toContain("Acme builds payroll software for restaurants.");
  });

  it("falls back to scorer risks and still works without a JD", () => {
    const prompt = buildPrepPrompt({ company: "Acme", role: null, round: undefined, evaluation: evaluation({ jd: undefined }), brief: null });
    expect(prompt).toContain("No Go production experience");
    expect(prompt).toContain("Round: unknown");
    expect(prompt).not.toContain("## Job description");
  });
});

describe("roundLine", () => {
  it("does not repeat a focus already in the label", () => {
    expect(roundLine({ ...round, focus: "technical" })).toBe(round.label);
    expect(roundLine(undefined)).toBeNull();
  });
});
