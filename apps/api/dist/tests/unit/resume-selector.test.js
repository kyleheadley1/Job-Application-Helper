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
});
