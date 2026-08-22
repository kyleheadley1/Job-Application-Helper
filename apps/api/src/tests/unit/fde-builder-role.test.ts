import { describe, expect, it } from "vitest";
import {
  countStrongSieRoleDescriptorHits,
  hasStrongExternalCustomerDeliverySignals,
  isFdeBuilderSoftwarePrimaryShape,
  jobBlobForFdeHeuristics,
} from "../../lib/fdeBuilderRole.js";
import type { ExtractedJobData } from "../../types/job.js";

const deployCoSieJd = `
DeployCo — Solutions Engineer (Forward Deployed)
You will own customer-facing implementation, integrations with enterprise APIs, and technical onboarding workshops.
Delivery timelines and integration timelines matter.
`.trim();

describe("fdeBuilderRole", () => {
  it("counts strong SIE phrases for classic solutions / customer implementation JD", () => {
    const n = countStrongSieRoleDescriptorHits(deployCoSieJd);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(hasStrongExternalCustomerDeliverySignals(deployCoSieJd)).toBe(true);
  });

  it("treats Maple-style forward deployed builder JD as fdeBuilderSoftwarePrimary", () => {
    const job: ExtractedJobData = {
      company: "Maple AI",
      title: "Forward Deployed Engineer",
      stack: ["TypeScript", "Python"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [
        "Ship internal sales tooling and AI-enabled workflows.",
        "Partner with sales and ops to translate business needs into software.",
        "Build full-stack features; hybrid NYC office cadence.",
      ],
      requirements: ["2+ years shipping software", "growth mindset"],
      rawText: "Founding-team energy. LLM and RAG experience valued.",
    };
    expect(isFdeBuilderSoftwarePrimaryShape(job)).toBe(true);
    expect(hasStrongExternalCustomerDeliverySignals(jobBlobForFdeHeuristics(job))).toBe(false);
  });

  it("does not mark fdeBuilderSoftwarePrimary when external customer implementation core is present", () => {
    const job: ExtractedJobData = {
      company: "DeployCo",
      title: "Forward Deployed Engineer",
      stack: ["TypeScript"],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [
        "Lead customer-facing implementation and integrations with enterprise APIs.",
        "Own technical onboarding workshops for new enterprise customers.",
      ],
      requirements: [],
    };
    expect(isFdeBuilderSoftwarePrimaryShape(job)).toBe(false);
  });

  it("does not mark BisectHosting Web Developer as FDE when only body mentions growth engineering", () => {
    const job: ExtractedJobData = {
      company: "BisectHosting",
      title: "Web Developer",
      seniority: "Entry Level",
      stack: ["React", "TypeScript", "PHP", "Laravel"],
      requiredSkills: ["React", "TypeScript", "JavaScript"],
      preferredSkills: [],
      domainTags: ["gaming", "web hosting"],
      responsibilities: [
        "Build customer-facing web applications with React and Nuxt/Vue.",
        "Contribute to growth engineering, experimentation, and integrations.",
      ],
      requirements: [
        "Strong experience with JavaScript/TypeScript and React, Vue, or Nuxt",
        "Experience developing backend applications and APIs using PHP Laravel",
      ],
      rawText:
        "BisectHosting Web Developer SDE1. Frontend with React and Nuxt/Vue, backend PHP Laravel, growth engineering and experimentation.",
    };
    expect(isFdeBuilderSoftwarePrimaryShape(job)).toBe(false);
  });
});
