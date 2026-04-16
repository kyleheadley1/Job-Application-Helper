import { z } from "zod";
import { responsesClient } from "../../services/llm/responsesClient.js";
import { assetGenerationSystemPrompt, buildAssetGenerationPrompt } from "./prompts.js";
const AssetOutputSchema = z.object({
    whyCompany: z.string(),
    coverLetter: z.string(),
    talkingPoints: z.array(z.string()).min(3).max(5),
    tailoredBulletCandidates: z.array(z.string()).min(3).max(5),
    emphasize: z.array(z.string()).min(3).max(5),
    avoidClaiming: z.array(z.string()).min(3).max(5),
    recruiterReplyDraft: z.string().optional(),
});
const fallbackAssets = (job) => ({
    whyCompany: `The ${job.extracted.title} role at ${job.extracted.company} aligns with backend-leaning full-stack work and API-focused delivery.`,
    coverLetter: `Hi ${job.extracted.company} team,\n\nI'm interested in the ${job.extracted.title} role. I focus on backend-leaning full-stack development using TypeScript, Node.js, React, and API-driven product work. I have shipped practical internal tools and AI-enabled workflows, and I value collaboration with stakeholders to deliver useful systems.\n\nThis role stands out because it combines product execution with technical depth in areas where I can contribute quickly while continuing to grow.\n\nThank you for your consideration.`,
    talkingPoints: [
        "Discuss API-first feature delivery with TypeScript and Node.",
        "Show how product constraints influenced implementation decisions.",
        "Highlight AI-enabled workflow improvements without over-claiming model depth.",
    ],
    tailoredBulletCandidates: [
        "Built backend-leaning full-stack features with TypeScript, Node.js, and React to ship practical product improvements.",
        "Implemented API integrations and internal tooling that reduced manual operational steps.",
        "Collaborated with stakeholders to scope and deliver useful systems under ambiguity.",
    ],
    emphasize: ["Backend-leaning full-stack execution", "APIs + internal tools", "Product-minded collaboration"],
    avoidClaiming: ["Years not demonstrated", "Specialized domain mastery", "Large-scale infra ownership"],
});
export const generateAssets = async (job, profile) => {
    const fallback = () => fallbackAssets(job);
    return responsesClient.runStructured({
        systemPrompt: assetGenerationSystemPrompt,
        userPrompt: buildAssetGenerationPrompt({ job, userProfile: profile }),
        schema: AssetOutputSchema,
        fallback,
    });
};
