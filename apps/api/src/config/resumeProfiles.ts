import type { ResumeProfile } from "../types/resume.js";

export const resumeProfiles: ResumeProfile[] = [
  {
    type: "BASE",
    label: "Full-Stack (Base)",
    bestFor: [
      "Product and full-stack software engineering",
      "Backend-leaning full-stack, API, and platform-adjacent applications",
      "Internal tools and workflow systems",
      "Junior / associate / early-career engineering roles",
      "Roles where AI is a minor or optional part of the job",
    ],
    avoidFor: [
      "Roles whose core work is building LLM, RAG, or agent systems (use AI)",
    ],
    summaryStyle: "Full-stack engineer shipping deployed React/TypeScript/Node.js applications with APIs, auth, async pipelines, and AWS.",
    emphasisKeywords: ["TypeScript", "Node.js", "React", "REST APIs", "MongoDB", "AWS", "CI/CD", "internal tools"],
    exampleRationale: [
      "Role is product/full-stack oriented and rewards API + application delivery.",
      "Base resume leads with shipped full-stack work; AI appears as supporting evidence.",
    ],
  },
  {
    type: "AI",
    label: "AI-Heavy",
    bestFor: [
      "AI engineer / applied AI / AI product engineering",
      "LLM application, RAG, retrieval, and search roles",
      "Agentic workflow and tool-using agent roles",
      "LLM evaluation, grounding, and quality roles",
      "Full-stack roles where AI features are central to the product",
    ],
    avoidFor: [
      "General product engineering with no AI component (use BASE)",
      "ML research or model-training roles (no training/fine-tuning experience to claim)",
    ],
    summaryStyle: "Full-stack engineer building AI-enabled applications: RAG, LLM evals, deterministic grounding, and LangGraph agents.",
    emphasisKeywords: ["RAG", "LLM evaluation", "LangGraph", "agents", "embeddings", "vector search", "Qdrant", "TypeScript"],
    exampleRationale: [
      "JD centers on LLM/RAG/agent work; AI resume leads with RAG project evals, grounding, and agent benchmarking.",
      "Evidence is measurable (eval metrics, benchmarks, agent vs RAG benchmark).",
    ],
  },
];
