import type { ResumeProfile } from "../types/resume.js";

export const resumeProfiles: ResumeProfile[] = [
  {
    type: "SWE",
    label: "Software Engineering",
    bestFor: [
      "Product engineering",
      "Standard software engineering",
      "Internal full-stack",
      "Backend-leaning full-stack",
      "API/platform applications",
    ],
    avoidFor: [
      "Forward-deployed customer implementation",
      "Pure solutions onboarding and delivery consulting",
    ],
    summaryStyle: "Backend-leaning product engineer who ships practical full-stack systems.",
    emphasisKeywords: ["TypeScript", "Node.js", "React", "APIs", "product engineering", "internal tools"],
    exampleRationale: [
      "Role is product/full-stack oriented and rewards API + application delivery.",
      "Screen story is strongest when framed as backend-leaning product engineering.",
    ],
  },
  {
    type: "SIE",
    label: "Solutions & Implementation Engineering",
    bestFor: [
      "Forward deployed roles",
      "Solutions engineering-ish roles",
      "Customer-facing implementation",
      "Integrations and delivery",
      "Technical implementation bridging business and engineering",
    ],
    avoidFor: ["Deep product feature ownership with minimal customer implementation context"],
    summaryStyle: "Technical implementation bridge for customer-facing onboarding and integration work.",
    emphasisKeywords: [
      "Integrations",
      "delivery",
      "implementation",
      "stakeholder collaboration",
      "solution design",
    ],
    exampleRationale: [
      "JD emphasizes delivery and integration outcomes over product feature ownership.",
      "Story fit is stronger with implementation and cross-functional framing.",
    ],
  },
  {
    type: "EARLY_CAREER",
    label: "Early Career Engineering",
    bestFor: [
      "Explicit new grad / early career",
      "Associate / rotational engineering",
      "Internship-equivalent expectations",
      "Roles screening for foundational ability over deep tenure",
    ],
    avoidFor: ["Senior-level expectations", "Roles requiring deep domain ownership from day one"],
    summaryStyle: "Foundational full-stack engineer with practical shipping experience and growth trajectory.",
    emphasisKeywords: ["early career", "foundational engineering", "learning velocity", "TypeScript", "full-stack"],
    exampleRationale: [
      "Role is explicitly early-career and expects a junior pitch.",
      "Recruiter screen likely expects foundational framing rather than tenure-heavy claims.",
    ],
  },
];
