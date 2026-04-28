import { z } from "zod";
import { env } from "../../config/env.js";
import { resumeProfiles } from "../../config/resumeProfiles.js";
import { responsesClient } from "../../services/llm/responsesClient.js";
import { buildResumeSelectionPrompt, resumeSelectionSystemPrompt } from "./prompts.js";
import { normalizeText } from "../../lib/text.js";
import { logger } from "../../lib/logger.js";
const ResumeSelectionSchema = z.object({
    recommendedResume: z.enum(["SWE", "SIE", "EARLY_CAREER"]),
    confidence: z.number().min(0).max(1),
    rationale: z.array(z.string()).default([]),
});
const deterministicResumeSelection = (job, resumeContexts) => {
    const text = normalizeText([
        job.title,
        job.rawText ?? "",
        (job.requirements ?? []).join(" "),
        (job.responsibilities ?? []).join(" "),
    ].join(" "));
    const sieSignals = [
        "forward deployed",
        "solutions engineer",
        "customer-facing implementation",
        "implementation",
        "integrations",
        "customer deployment",
        "technical onboarding",
        "solution design",
        "delivery timelines",
        "integration timelines",
        "partner engineering",
        "pre-sales",
        "post-sales",
        "api integration",
        "workflow implementation",
        "technical implementation",
    ];
    const earlySignals = ["new grad", "entry level", "early career", "rotational", "associate"];
    const sweSignals = ["software engineer", "full-stack", "backend", "api", "product engineer", "builder"];
    const juniorBuilderSignals = [
        "junior",
        "entry-level",
        "entry level",
        "early-career",
        "early career",
        "associate",
        "product engineer",
        "full-stack",
        "internal tools",
    ];
    const sieHits = sieSignals.filter((needle) => text.includes(needle)).length;
    const earlyHits = earlySignals.filter((needle) => text.includes(needle)).length;
    const sweHits = sweSignals.filter((needle) => text.includes(needle)).length;
    const juniorBuilderHits = juniorBuilderSignals.filter((needle) => text.includes(needle)).length;
    const metaScoreByType = { SWE: 0, SIE: 0, EARLY_CAREER: 0 };
    if (resumeContexts) {
        const stackAndNeeds = normalizeText([...job.stack, ...job.requiredSkills, ...job.preferredSkills, ...job.responsibilities, ...job.requirements].join(" "));
        const words = new Set(stackAndNeeds.split(/\s+/).filter(Boolean));
        const types = ["SWE", "SIE", "EARLY_CAREER"];
        for (const type of types) {
            const ctx = resumeContexts[type];
            if (!ctx)
                continue;
            const keywordOverlap = ctx.metadata.keywords.filter((k) => words.has(k)).length;
            const themeOverlap = ctx.metadata.strongestThemes.filter((t) => stackAndNeeds.includes(normalizeText(t))).length;
            metaScoreByType[type] = keywordOverlap + themeOverlap * 2;
        }
    }
    const combinedByType = {
        SWE: metaScoreByType.SWE * 2 + sweHits,
        SIE: metaScoreByType.SIE * 2 + sieHits,
        EARLY_CAREER: metaScoreByType.EARLY_CAREER * 2 + earlyHits,
    };
    // Calibration: junior builder/product roles should default to EARLY_CAREER or SWE,
    // unless clear SIE implementation/onboarding/customer-delivery signals are present.
    if (juniorBuilderHits > 0 && sieHits < 2) {
        combinedByType.SWE += 2;
        combinedByType.EARLY_CAREER += 2;
        combinedByType.SIE -= 2;
    }
    if (sieHits >= 2 && /customer[-\s]?facing|onboarding|implementation|integration/.test(text)) {
        combinedByType.SIE += 2;
    }
    const ordered = Object.entries(combinedByType).sort((a, b) => b[1] - a[1]);
    const ambiguous = Math.abs((ordered[0]?.[1] ?? 0) - (ordered[1]?.[1] ?? 0)) <= 1;
    const recommendedResume = ordered[0]?.[0] ?? "SWE";
    const profile = resumeProfiles.find((r) => r.type === recommendedResume);
    return {
        recommendedResume,
        confidence: ambiguous ? 0.62 : 0.84,
        rationale: profile?.exampleRationale ?? ["Resume selected from stable role-shape heuristics."],
        ambiguous,
    };
};
export const selectResume = async (params) => {
    const deterministic = deterministicResumeSelection(params.extracted, params.resumeContexts);
    if (!deterministic.ambiguous ||
        !env.openAiApiKey ||
        (env.triageFastMode && env.triageSkipLlmResumeSelectionInFastMode)) {
        return {
            recommendedResume: deterministic.recommendedResume,
            confidence: deterministic.confidence,
            rationale: deterministic.rationale,
        };
    }
    const fallback = () => ({
        recommendedResume: deterministic.recommendedResume,
        confidence: deterministic.confidence,
        rationale: deterministic.rationale,
    });
    const selected = await responsesClient.runStructured({
        systemPrompt: resumeSelectionSystemPrompt,
        userPrompt: buildResumeSelectionPrompt(params),
        schema: ResumeSelectionSchema,
        fallback,
    });
    if (!selected.success) {
        logger.warn("Resume selection used deterministic fallback", {
            fallbackUsed: selected.diagnostics.fallbackUsed,
            httpStatus: selected.diagnostics.httpStatus,
            errorCode: selected.diagnostics.errorCode,
            parseStage: selected.diagnostics.parseStage,
            reason: selected.diagnostics.reason,
        });
    }
    return selected.data;
};
