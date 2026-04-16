import { describe, expect, it } from "vitest";
import { selectResume } from "../agents/jobAgent/resumeSelector.js";
import { userProfile } from "../config/userProfile.js";
const baseScore = {
    stackFit: 20,
    levelFit: 10,
    domainFit: 7,
    resumeStoryClarity: 10,
    functionalOverlap: 8,
    recruiterFriendliness: 10,
    careerValue: 8,
    total: 73,
};
describe("selectResume", () => {
    it("selects SIE for implementation-heavy role shapes", async () => {
        const extracted = {
            company: "DeployCo",
            title: "Solutions Engineer",
            stack: ["TypeScript"],
            requiredSkills: ["customer-facing implementation"],
            preferredSkills: [],
            domainTags: [],
            responsibilities: ["Lead forward deployed integrations with enterprise customers"],
            requirements: [],
        };
        const result = await selectResume({
            extracted,
            score: baseScore,
            topMatch: "Implementation overlap",
            mainRisk: "Domain strictness",
            userProfile,
        });
        expect(result.recommendedResume).toBe("SIE");
    });
});
