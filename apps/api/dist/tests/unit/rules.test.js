import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
const makeJob = (overrides) => ({
    company: "TestCo",
    title: "Software Engineer",
    stack: ["TypeScript", "Node.js"],
    requiredSkills: ["API development"],
    preferredSkills: [],
    domainTags: [],
    responsibilities: [],
    requirements: [],
    remoteType: "remote",
    ...overrides,
});
describe("rule engine", () => {
    it("flags explicit degree risks", () => {
        const rules = evaluateRules(makeJob({
            degreeRequirement: { level: "required", raw: "Bachelor's degree required" },
        }), userProfile);
        expect(rules.explicitDegreeRisk).toBe(true);
    });
    it("flags senior title skepticism", () => {
        const rules = evaluateRules(makeJob({ title: "Senior Software Engineer", yearsExperience: { min: 5 } }), userProfile);
        expect(rules.seniorityOverreach).toBe(true);
    });
    it("flags finance/traditional strictness", () => {
        const rules = evaluateRules(makeJob({ company: "Heritage Bank", domainTags: ["finance"], requirements: ["banking systems experience"] }), userProfile);
        expect(rules.financePenalty).toBe(true);
        expect(rules.traditionalCompanyPenalty).toBe(true);
    });
    it("flags onsite non-commutable mismatch", () => {
        const rules = evaluateRules(makeJob({ remoteType: "onsite", location: "Dallas, TX", locationIsCommutable: false }), userProfile);
        expect(rules.locationMismatch).toBe(true);
    });
    it("flags explicit new-grad penalty", () => {
        const rules = evaluateRules(makeJob({ requirements: ["This is a new grad rotational program"] }), userProfile);
        expect(rules.newGradPenalty).toBe(true);
    });
    it("flags startup founding mismatch", () => {
        const rules = evaluateRules(makeJob({ title: "Founding Engineer", requirements: ["first engineer at startup"] }), userProfile);
        expect(rules.startupFounderMismatch).toBe(true);
    });
});
