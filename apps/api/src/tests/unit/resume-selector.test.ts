import { describe, expect, it } from "vitest";
import { selectResume } from "../../agents/jobAgent/resumeSelector.js";
import { userProfile } from "../../config/userProfile.js";
import type { ExtractedJobData } from "../../types/job.js";

const score = {
  stackFit: 20,
  levelFit: 10,
  domainFit: 7,
  resumeStoryClarity: 10,
  functionalOverlap: 8,
  recruiterFriendliness: 11,
  careerValue: 8,
  total: 74,
};

const pick = (extracted: ExtractedJobData) =>
  selectResume({ extracted, score, topMatch: "", mainRisk: "", userProfile });

const job = (over: Partial<ExtractedJobData>): ExtractedJobData => ({
  company: "Co",
  title: "Software Engineer",
  stack: [],
  requiredSkills: [],
  preferredSkills: [],
  domainTags: [],
  responsibilities: [],
  requirements: [],
  ...over,
});

describe("resume selection (BASE vs AI)", () => {
  it("picks AI for applied AI engineering roles", async () => {
    const result = await pick(
      job({
        company: "Distyl AI",
        title: "AI Engineer",
        stack: ["Python", "REST APIs"],
        requiredSkills: ["LLMs", "RAG", "vector search"],
        responsibilities: ["Build customer-facing production AI systems", "Evaluations and retrieval workflows"],
        requirements: ["Experience with agents and API integrations"],
        rawText: "AI Engineer role. Python, LLMs, RAG, embeddings, REST APIs. Hybrid in New York, NY.",
      }),
    );
    expect(result.recommendedResume).toBe("AI");
  });

  it("picks AI for a full-stack role whose product is LLM-centric", async () => {
    const result = await pick(
      job({
        title: "Full Stack Engineer",
        responsibilities: [
          "Build RAG pipelines and LLM features end to end",
          "Own evals for agent quality and embeddings-based search",
        ],
        rawText: "We build agentic workflows on OpenAI and LangGraph with vector search.",
      }),
    );
    expect(result.recommendedResume).toBe("AI");
  });

  it("picks BASE for junior product builder roles that only mention AI tooling", async () => {
    const result = await pick(
      job({
        company: "Rokt",
        title: "Junior Software Engineer",
        stack: ["TypeScript", "React"],
        requiredSkills: ["product collaboration", "internal tools", "AI tooling"],
        responsibilities: ["Build full-stack product features", "Work with PM/design/engineering on iteration"],
        requirements: ["1-3 years experience"],
        rawText: "Junior builder role with full-stack product ownership and AI tooling acceleration.",
      }),
    );
    expect(result.recommendedResume).toBe("BASE");
  });

  it("picks BASE for normal backend roles", async () => {
    const result = await pick(
      job({
        company: "Plaid",
        title: "Backend Engineer",
        stack: ["Go", "Kubernetes", "Postgres"],
        requiredSkills: ["API development", "testing"],
        responsibilities: ["Build backend systems and product features."],
        rawText: "Python and/or JavaScript/TypeScript acceptable.",
      }),
    );
    expect(result.recommendedResume).toBe("BASE");
  });

  it("picks BASE for associate / early-career roles", async () => {
    const result = await pick(
      job({
        company: "UnitedHealth Group",
        title: "Associate Software Engineer",
        requirements: ["Early career rotational program", "Java or JavaScript"],
      }),
    );
    expect(result.recommendedResume).toBe("BASE");
  });
});
