import { z } from "zod";
import { scoringPolicy } from "../../config/scoringPolicy.js";
import { buildScoringPrompt, scoringSystemPrompt } from "./prompts.js";
import { responsesClient } from "../../services/llm/responsesClient.js";
const ScoringOutputSchema = z.object({
    score: z.object({
        stackFit: z.number().min(0).max(25),
        levelFit: z.number().min(0).max(15),
        domainFit: z.number().min(0).max(10),
        resumeStoryClarity: z.number().min(0).max(15),
        functionalOverlap: z.number().min(0).max(10),
        recruiterFriendliness: z.number().min(0).max(15),
        careerValue: z.number().min(0).max(10),
        total: z.number().min(0).max(100),
    }),
    recommendation: z.enum(["yes", "selective_yes", "no"]),
    topMatch: z.string(),
    mainRisk: z.string(),
    rationale: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
});
export const mapRecommendationFromScore = (total) => scoringPolicy.recommendationMapping.find((entry) => total >= entry.min && total <= entry.max)?.recommendation ?? "no";
const deterministicFallback = (job, rules) => {
    const stackHits = [job.stack, job.requiredSkills, job.preferredSkills].flat().join(" ").toLowerCase();
    const stackFit = stackHits.includes("typescript") || stackHits.includes("javascript") ? 18 : 10;
    const levelFit = rules.seniorityOverreach ? 5 : 11;
    const domainFit = rules.domainMismatch ? 4 : 7;
    const resumeStoryClarity = rules.stackMismatch ? 6 : 11;
    const functionalOverlap = rules.stackMismatch ? 4 : 7;
    const recruiterFriendliness = Math.max(0, 12 - Object.keys(rules.penaltyVector ?? {}).length * 2);
    const careerValue = 7;
    const subtotal = stackFit + levelFit + domainFit + resumeStoryClarity + functionalOverlap + recruiterFriendliness + careerValue;
    const penalty = Object.values(rules.penaltyVector ?? {}).reduce((sum, value) => sum + value, 0);
    const total = Math.max(0, Math.min(100, subtotal - Math.round(penalty / 3)));
    const recommendation = mapRecommendationFromScore(total);
    return {
        score: {
            stackFit,
            levelFit,
            domainFit,
            resumeStoryClarity,
            functionalOverlap,
            recruiterFriendliness,
            careerValue,
            total,
        },
        recommendation,
        topMatch: "Backend-leaning product engineering and API overlap.",
        mainRisk: rules.notes[0] ?? "Recruiter screen realism risk.",
        rationale: [
            "Score uses conservative fit plus recruiter-screen realism.",
            "Deterministic penalties are applied when hard gates are present.",
        ],
        risks: rules.notes,
    };
};
export const scoreJob = async (params) => {
    const fallback = () => deterministicFallback(params.extracted, params.rules);
    const { data: llmResult } = await responsesClient.runStructured({
        systemPrompt: scoringSystemPrompt,
        userPrompt: buildScoringPrompt({
            extracted: params.extracted,
            rules: params.rules,
            userProfile: params.userProfile,
            scoringPolicy,
        }),
        schema: ScoringOutputSchema,
        fallback,
    });
    const categoryTotal = llmResult.score.stackFit +
        llmResult.score.levelFit +
        llmResult.score.domainFit +
        llmResult.score.resumeStoryClarity +
        llmResult.score.functionalOverlap +
        llmResult.score.recruiterFriendliness +
        llmResult.score.careerValue;
    const boundedTotal = Math.max(0, Math.min(100, Math.round(categoryTotal)));
    const recommendation = mapRecommendationFromScore(boundedTotal);
    return {
        ...llmResult,
        score: { ...llmResult.score, total: boundedTotal },
        recommendation,
    };
};
