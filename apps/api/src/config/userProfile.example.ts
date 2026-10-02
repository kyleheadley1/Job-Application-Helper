import type { UserProfile } from "../types/userProfile.js";

/**
 * Fictional early-career candidate. Used by tests and as the fallback when no local
 * `user_profile.json` exists. Copy its shape into your own local profile (see README).
 */
export const exampleUserProfile: UserProfile = {
  headline: "Backend-leaning full-stack engineer focused on practical product systems.",
  strengths: [
    "TypeScript",
    "JavaScript",
    "Node.js",
    "React",
    "API design and integration",
    "Product-minded full-stack development",
    "Internal tools",
    "AI-enabled workflows",
    "RAG and LLM-enabled applications",
    "LLM evaluation (golden sets, citation validity, LLM-as-judge)",
    "LangGraph tool-using agents and agentic workflows",
    "Async processing pipelines (BullMQ, Redis)",
    "REST APIs, authentication, and RBAC",
    "AWS deployment and GitHub Actions CI/CD",
    "Stakeholder collaboration in ambiguity",
  ],
  weakerAreas: [
    "Pure infrastructure and SRE-heavy ownership",
    "Design-engineer and frontend-craft-first roles",
    "Highly specialized enterprise domain requirements without overlap",
    "Strict traditional pipelines with degree as top filter",
  ],
  degreeStatus: {
    hasBachelors: false,
    note: "Associate degree; software engineering bootcamp graduate; no bachelor's degree.",
  },
  training: {
    program: "Software engineering bootcamp",
    completionDate: "2025-06-01",
  },
  targetRoles: [
    "Early-career/junior/lower-mid full-stack product engineering",
    "Backend-leaning full-stack roles",
    "Selective AI application engineering roles",
  ],
  locationPreferences: {
    primary: ["NYC", "Remote"],
    acceptable: ["NYC hybrid", "NYC in-person", "NJ commutable"],
    usuallyNo: ["Out-of-region onsite/hybrid roles"],
  },
  flagshipProjects: [
    {
      name: "Open-source RAG codebase assistant",
      summary:
        "Maintainer of a deployed full-stack RAG app for codebase onboarding: Node.js/Express backend, async repo ingestion with BullMQ/Redis, AST-aware parsing, embeddings in a vector database, reranked retrieval, and file/line-cited answers.",
      tech: ["TypeScript", "Node.js", "Express", "React", "BullMQ", "Redis", "Qdrant", "OpenAI API", "GitHub OAuth"],
      outcomes: ["Deployed and maintained end-to-end", "Source-grounded answers with file- and line-level citations"],
    },
    {
      name: "RAG evaluation and agent extension",
      summary:
        "Built a golden-set eval harness (deterministic retrieval/citation checks, LLM-as-judge, latency/cost tracking) and a LangGraph tool-using agent benchmarked against the fixed RAG pipeline.",
      tech: ["LangGraph", "LangChain", "LLM evals", "ts-morph", "TypeScript"],
      outcomes: [
        "Citation validity raised from 45% to 95%",
        "Agent improved file recall ~80% to ~88%; fixed RAG matched quality at ~35% lower cost and ~50% lower median latency",
      ],
    },
    {
      name: "Internal web applications (contract)",
      summary:
        "Built internal web apps for 10+ users with Node.js/Express REST APIs, authentication and RBAC, AI tools that ingest PDFs and answer via embeddings, AWS infrastructure, and GitHub Actions CI/CD.",
      tech: ["TypeScript", "Node.js", "Express", "React", "AWS (EC2, S3)", "GitHub Actions"],
      outcomes: ["Used by 10+ internal users", "Automated testing and deployments"],
    },
  ],
  recurringStory: [
    "Backend-leaning full-stack development",
    "Internal tools and APIs",
    "AI-enabled practical workflows",
    "Product-oriented execution over demo-only work",
    "Collaborative delivery in ambiguous environments",
  ],
  hardConstraints: [
    "Do not invent years of experience",
    "Do not invent production scale claims",
    "Do not invent domain expertise",
    "Treat explicit citizenship/clearance/degree gates as meaningful",
    "Bias toward landability realism over theoretical capability",
  ],
  estimatedProfessionalYears: 1.75,
  requiresSponsorship: false,
  citizenshipStatus: {
    isUSCitizen: true,
  },
  holdsActiveClearance: false,
  candidateLocation: {
    label: "New York, NY / US-authorized",
    basedInUS: true,
    regions: ["United States", "US", "NYC"],
  },
  certifications: [
    {
      name: "AWS Developer – Associate",
      issuer: "AWS",
      status: "lapsed",
      relatedSkills: [
        "AWS",
        "S3",
        "DynamoDB",
        "Lambda",
        "CloudWatch",
        "EventBridge",
        "Amplify",
        "API Gateway",
        "IAM",
        "SQS",
        "SNS",
      ],
    },
    {
      name: "LPI Linux Essentials",
      issuer: "Linux Professional Institute",
      status: "active",
      relatedSkills: ["Linux", "Bash", "command line"],
    },
  ],
};
