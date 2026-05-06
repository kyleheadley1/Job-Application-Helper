import { describe, expect, it } from "vitest";
import { selectResume } from "../../agents/jobAgent/resumeSelector.js";
import { userProfile } from "../../config/userProfile.js";
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
describe("resume selection", () => {
    it("picks SIE for integration and customer implementation shape", async () => {
        const extracted = {
            company: "DeployCo",
            title: "Solutions Engineer",
            stack: ["TypeScript"],
            requiredSkills: [],
            preferredSkills: [],
            domainTags: [],
            responsibilities: ["Lead customer-facing implementation and integrations"],
            requirements: [],
        };
        const result = await selectResume({
            extracted,
            score,
            topMatch: "Implementation overlap",
            mainRisk: "Domain depth",
            userProfile,
        });
        expect(result.recommendedResume).toBe("SIE");
    });
    it("picks EARLY_CAREER only for explicit early-career signals", async () => {
        const extracted = {
            company: "GradTrack",
            title: "Associate Software Engineer",
            stack: ["JavaScript"],
            requiredSkills: [],
            preferredSkills: [],
            domainTags: [],
            responsibilities: [],
            requirements: ["Early career rotational program"],
        };
        const result = await selectResume({
            extracted,
            score,
            topMatch: "Entry-level path",
            mainRisk: "Pipeline strictness",
            userProfile,
        });
        expect(result.recommendedResume).toBe("EARLY_CAREER");
    });
    it("prefers SWE for applied AI engineering roles without junior pipeline language", async () => {
        const extracted = {
            company: "Distyl AI",
            title: "AI Engineer",
            stack: ["Python", "REST APIs"],
            requiredSkills: ["LLMs", "RAG", "vector search"],
            preferredSkills: [],
            domainTags: [],
            responsibilities: ["Build customer-facing production AI systems", "Evaluations and retrieval workflows"],
            requirements: ["Experience with agents and API integrations"],
            rawText: "AI Engineer role. Python, LLMs, RAG, embeddings, REST APIs. Hybrid in New York, NY. Serves enterprise customers.",
        };
        const result = await selectResume({
            extracted,
            score,
            topMatch: "LLM/RAG overlap",
            mainRisk: "Python-primary vs TypeScript strength",
            userProfile,
        });
        expect(result.recommendedResume).toBe("SWE");
    });
    it("prefers SWE for Maple-style forward deployed engineer (builder-first) and notes SIE alternate", async () => {
        const extracted = {
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
            requirements: ["2+ years shipping software"],
            rawText: "Founding team. LLM and RAG experience valued.",
        };
        const result = await selectResume({
            extracted,
            score,
            topMatch: "Strong applied-AI and internal tooling overlap",
            mainRisk: "Adjacent vs pure GTM consulting lane",
            userProfile,
        });
        expect(result.recommendedResume).toBe("SWE");
        expect(result.rationale.some((r) => /SIE can be used as an alternate/i.test(r))).toBe(true);
    });
    it("does not misclassify junior product builder roles as SIE", async () => {
        const extracted = {
            company: "Rokt",
            title: "Junior Software Engineer",
            stack: ["TypeScript", "React"],
            requiredSkills: ["product collaboration", "internal tools", "AI tooling"],
            preferredSkills: ["full-stack ownership"],
            domainTags: [],
            responsibilities: [
                "Build full-stack product features",
                "Work with PM/design/engineering on iteration",
            ],
            requirements: ["1-3 years experience", "early-career growth mindset"],
            rawText: "Junior builder role with full-stack product ownership, collaboration, and AI tooling acceleration.",
        };
        const result = await selectResume({
            extracted,
            score,
            topMatch: "Builder overlap",
            mainRisk: "Scale expectations",
            userProfile,
        });
        expect(result.recommendedResume).not.toBe("SIE");
        expect(["EARLY_CAREER", "SWE"]).toContain(result.recommendedResume);
    });
    it("defaults to SWE (not EARLY_CAREER) for normal 1-4 year backend roles", async () => {
        const extracted = {
            company: "Plaid",
            title: "Backend Engineer",
            stack: ["Go", "Kubernetes", "Postgres"],
            requiredSkills: ["API development", "testing", "debugging"],
            preferredSkills: [],
            domainTags: ["fintech"],
            responsibilities: [
                "Build backend systems and product features.",
                "Collaborate with PM/design and contribute to technical decisions.",
            ],
            requirements: ["2+ years experience", "ownership mindset"],
            rawText: "Python and/or JavaScript/TypeScript acceptable.",
        };
        const result = await selectResume({
            extracted,
            score,
            topMatch: "Backend/API overlap",
            mainRisk: "Scale depth",
            userProfile,
        });
        expect(result.recommendedResume).toBe("SWE");
    });
});
