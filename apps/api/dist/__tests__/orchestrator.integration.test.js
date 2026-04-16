import { describe, expect, it, vi } from "vitest";
vi.mock("../tools/saveJobRecord.js", () => ({
    saveJobRecord: async (job) => job,
}));
vi.mock("../tools/extractJobData.js", () => ({
    extractJobData: async () => ({
        company: "TestCo",
        title: "Software Engineer",
        stack: ["TypeScript", "Node.js", "React"],
        requiredSkills: ["API development"],
        preferredSkills: ["LLM apps"],
        domainTags: ["saas"],
        remoteType: "remote",
        responsibilities: ["Build product features"],
        requirements: ["2+ years experience"],
    }),
}));
describe("triage orchestrator", () => {
    it("returns a conservative, structured job record", async () => {
        const { triageJob } = await import("../agents/jobAgent/orchestrator.js");
        const result = await triageJob({
            rawText: "Software Engineer role building product APIs.",
            fullPrep: true,
        });
        expect(result.extracted.company).toBe("TestCo");
        expect(result.score.total).toBeTypeOf("number");
        expect(result.recommendedResume).toMatch(/SWE|SIE|EARLY_CAREER/);
        expect(result.generated.coverLetter).toBeTruthy();
    });
});
