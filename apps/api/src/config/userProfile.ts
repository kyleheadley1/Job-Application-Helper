import type { UserProfile } from "../types/userProfile.js";

export const userProfile: UserProfile = {
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
    "RAG-ish and LLM-enabled applications",
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
    note: "Nontraditional background with no bachelor's degree.",
  },
  training: {
    program: "Codesmith",
    completionDate: "2025-06-27",
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
      name: "AI-enabled internal workflow tooling",
      summary: "Built product-facing internal tooling that used LLM workflows to speed repetitive ops.",
      tech: ["TypeScript", "Node.js", "React", "APIs", "LLM integrations"],
      outcomes: ["Reduced repetitive manual steps", "Improved team operational clarity"],
    },
    {
      name: "Backend-leaning full-stack product features",
      summary: "Implemented API-first features end-to-end with practical product tradeoff decisions.",
      tech: ["TypeScript", "Node.js", "Express", "React", "MongoDB"],
      outcomes: ["Shipped usable product increments", "Collaborated with stakeholders on scope"],
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
  requiresSponsorship: false,
};
