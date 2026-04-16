import { describe, expect, it } from "vitest";
import { evaluateRules } from "../agents/jobAgent/rules.js";
import { userProfile } from "../config/userProfile.js";
const makeJob = (overrides) => ({
    company: "Acme Bank",
    title: "Senior Software Engineer",
    stack: ["Java"],
    requiredSkills: [],
    preferredSkills: [],
    domainTags: ["finance"],
    responsibilities: [],
    requirements: [],
    remoteType: "onsite",
    locationIsCommutable: false,
    degreeRequirement: { level: "required", raw: "Bachelor's degree required" },
    ...overrides,
});
describe("evaluateRules", () => {
    it("applies explicit degree and finance realism penalties", () => {
        const result = evaluateRules(makeJob({}), userProfile);
        expect(result.explicitDegreeRisk).toBe(true);
        expect(result.financePenalty).toBe(true);
        expect(result.penaltyVector?.degree).toBeGreaterThan(0);
    });
    it("flags onsite mismatch and seniority skepticism", () => {
        const result = evaluateRules(makeJob({}), userProfile);
        expect(result.locationMismatch).toBe(true);
        expect(result.seniorityOverreach).toBe(true);
    });
});
