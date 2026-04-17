import { z } from "zod";
import { responsesClient } from "../../services/llm/responsesClient.js";
import { buildCoverLetterGuidance, applicationStrategyAssetSystemPrompt, buildApplicationStrategyAssetUserPrompt, buildCoverLetterAssetUserPrompt, buildTailoredBulletsAssetUserPrompt, buildTalkingPointsAssetUserPrompt, buildWhyCompanyAssetUserPrompt, coverLetterAssetSystemPrompt, tailoredBulletsAssetSystemPrompt, talkingPointsAssetSystemPrompt, whyCompanyAssetSystemPrompt, } from "./prompts.js";
import { formatWhyCompanyForSIE, stripPastedJdHeaderFromCoverLetter } from "../../tools/triageStructuredNormalize.js";
const CoverLetterOut = z.object({ coverLetter: z.string().min(1) });
const WhyCompanyOut = z.object({ whyCompany: z.string().min(1) });
const TalkingOut = z.object({
    talkingPoints: z.array(z.string()).min(3).max(5),
});
const BulletsOut = z.object({
    tailoredBulletCandidates: z.array(z.string()).min(3).max(5),
});
const StrategyOut = z.object({
    emphasize: z.array(z.string()).min(1),
    avoidClaiming: z.array(z.string()).min(1),
    recruiterReplyDraft: z.string().optional(),
});
const toSliceDebug = (r) => ({
    success: r.success,
    fallbackUsed: r.diagnostics.fallbackUsed,
    httpStatus: r.diagnostics.httpStatus,
    errorCode: r.diagnostics.errorCode,
    errorType: r.diagnostics.errorType,
    errorMessage: r.diagnostics.errorMessage,
    parseStage: r.diagnostics.parseStage,
    reason: r.diagnostics.reason,
});
export class AssetGenerationSkippedError extends Error {
    code = "ASSET_GENERATION_SKIPPED";
    constructor(message) {
        super(message);
        this.name = "AssetGenerationSkippedError";
    }
}
const countWords = (text) => text.trim().split(/\s+/).filter(Boolean).length;
const enforceCoverLetterWordBand = (text, fallback, opts) => {
    let out = text.trim();
    if (!out)
        out = fallback.trim();
    if (countWords(out) < opts.min)
        out = fallback.trim();
    const words = out.split(/\s+/).filter(Boolean);
    if (words.length > opts.max)
        return `${words.slice(0, opts.max).join(" ")}...`;
    return out;
};
const caveatPatterns = [
    /\bdon['’]t have\b/gi,
    /\black\b/gi,
    /\bmissing\b/gi,
    /\bno bachelor'?s\b/gi,
    /\bwithout\b/gi,
    /\bstretch\b/gi,
];
const caveatHits = (text) => caveatPatterns.reduce((sum, re) => sum + (text.match(re)?.length ?? 0), 0);
const hasExcessiveCaveatLanguage = (text, recommendation) => {
    const hits = caveatHits(text.toLowerCase());
    if (recommendation === "yes")
        return hits > 1;
    if (recommendation === "selective_yes")
        return hits > 2;
    return hits > 3;
};
const uniqueKeepOrder = (items) => {
    const out = [];
    const seen = new Set();
    for (const item of items) {
        const key = item.trim().toLowerCase();
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        out.push(item.trim());
    }
    return out;
};
/** Honest, template-backed assets when LLM is unavailable or fails — uses only job + profile fields. */
export const buildDeterministicGeneratedAssets = (job, profile) => {
    const { extracted, recommendedResume, rules, mainRisk } = job;
    const company = extracted.company;
    const title = extracted.title;
    const guidance = buildCoverLetterGuidance(job, profile);
    const stackLine = [...extracted.stack, ...extracted.requiredSkills].filter(Boolean).join(", ");
    const resp0 = extracted.responsibilities[0];
    const rawSnippet = extracted.rawText?.trim().slice(0, 320);
    const p1 = `Hello ${company} team, I'm applying for the ${title} role. The role priorities around ${guidance.priorities
        .slice(0, 2)
        .join(" and ")
        .replace(/\.$/, "")} are a strong fit for how I like to work. I'm specifically drawn to the practical scope here and the chance to contribute in a way that is immediately useful.`;
    const evidenceBits = guidance.selectedProjectSummaries.slice(0, 2);
    const p2 = evidenceBits.length > 1
        ? `Two relevant examples from my background: ${evidenceBits[0]} Also, ${evidenceBits[1]} Together, these reflect the blend of execution, product judgment, and collaboration this role appears to prioritize.`
        : `A relevant example from my background: ${evidenceBits[0] ?? profile.flagshipProjects[0]?.summary ?? profile.headline} This is the kind of overlap I would bring into this role from day one.`;
    const p3ByBand = {
        yes: `I'd be excited to contribute quickly in this role and keep building practical product value with your team. If helpful, I can share concrete examples of how I'd approach the first few priorities in your posting.`,
        selective_yes: `If this scope is a match, I'd welcome a conversation on how I'd contribute quickly while ramping where needed. I care most about being clear on near-term impact and delivering consistently from there.`,
        no: `I recognize this role may be a stretch in parts, but I'd still bring practical execution and clear communication from day one. If there is flexibility on exact background profile, I'd be glad to discuss where I can add immediate value.`,
    };
    const coverLetter = enforceCoverLetterWordBand([p1, p2, p3ByBand[job.recommendation]].join("\n\n"), [p1, p2, p3ByBand[job.recommendation]].join("\n\n"), {
        min: 140,
        max: 220,
    });
    const whyTone = {
        yes: "This aligns with the direction I want to keep building in.",
        selective_yes: "This is the kind of role I'd pursue where overlap is strong and growth is realistic.",
        no: "This looks more selective for my background, but the role shape still connects to work I care about.",
    };
    const whyCompany = [
        `I'm interested in ${company}'s ${title} role because it emphasizes ${guidance.priorities[0] ?? "practical delivery"} and ${guidance.priorities[1] ?? "clear product impact"}.`,
        `A relevant overlap from my background is ${guidance.selectedProjectSummaries[0] ?? profile.flagshipProjects[0]?.summary ?? profile.headline}.`,
        whyTone[job.recommendation],
    ].join(" ");
    const talkingPoints = [];
    if (recommendedResume === "SIE") {
        talkingPoints.push("I can walk through how I'd structure an integration or onboarding slice with clear milestones and delivery risk management.");
        talkingPoints.push("I translate ambiguous stakeholder requests into concrete technical plans and then execute against those plans.");
        talkingPoints.push("For this role, my fit is strongest where implementation delivery and cross-functional communication overlap.");
    }
    else if (recommendedResume === "EARLY_CAREER") {
        talkingPoints.push("I'm early-career with a strong hands-on foundation, and I do best in roles with tight feedback loops and practical shipping.");
        talkingPoints.push("I've shipped full-stack project work where clear scoping and readable implementation mattered as much as feature speed.");
        talkingPoints.push("For this role, I'd bring strong fundamentals and a high learning velocity while staying transparent about ramp areas.");
    }
    else {
        talkingPoints.push("I've shipped backend-leaning full-stack work where APIs and internal tools were core to product delivery.");
        talkingPoints.push("I'm strongest when priorities are ambiguous but measurable: narrow scope, ship a practical version, then iterate with stakeholders.");
        talkingPoints.push("For this role, the fit is strongest around product-minded execution tied to concrete technical overlap.");
    }
    for (const summary of guidance.selectedProjectSummaries) {
        if (talkingPoints.length >= 5)
            break;
        talkingPoints.push(`Relevant example: ${summary}`);
    }
    while (talkingPoints.length < 3) {
        talkingPoints.push(`Relevant strength I can substantiate: ${profile.strengths[talkingPoints.length]}.`);
    }
    if (job.recommendation !== "yes" && talkingPoints.length < 5) {
        talkingPoints.push("I approach fit risks directly, but keep focus on where I can deliver immediate value in this role.");
    }
    const normalizedTalkingPoints = uniqueKeepOrder(talkingPoints).slice(0, job.recommendation === "no" ? 3 : 5);
    const bulletLeads = recommendedResume === "SIE"
        ? ["Delivered", "Implemented", "Translated", "Coordinated", "Drove"]
        : recommendedResume === "EARLY_CAREER"
            ? ["Built", "Shipped", "Implemented", "Contributed to", "Developed"]
            : ["Built", "Shipped", "Implemented", "Designed", "Collaborated on"];
    const baseBullets = guidance.selectedProjectSummaries.map((summary, idx) => `${bulletLeads[idx % bulletLeads.length]} ${summary.replace(/\.$/, "")}.`);
    const roleBullets = recommendedResume === "SIE"
        ? [
            "Owned integration-focused implementation slices and kept technical/stakeholder communication aligned through delivery.",
            "Turned ambiguous implementation requirements into executable plans with clear dependencies and checkpoints.",
        ]
        : recommendedResume === "EARLY_CAREER"
            ? [
                "Built practical full-stack features with clear implementation tradeoffs and iterative feedback loops.",
                "Applied strong engineering fundamentals while ramping quickly in new domains and toolchains.",
            ]
            : [
                "Built API-first product features and internal tooling with a backend-leaning full-stack approach.",
                "Collaborated with stakeholders to scope and ship pragmatic increments tied to product needs.",
            ];
    const tailoredBulletCandidates = uniqueKeepOrder([...baseBullets, ...roleBullets]).slice(0, job.recommendation === "no" ? 3 : 5);
    const emphasize = [
        ...profile.recurringStory.slice(0, 2),
        job.topMatch,
        `Resume selected for this application: ${recommendedResume} — keep the story consistent with that framing.`,
    ].filter(Boolean);
    const avoidClaiming = [...profile.hardConstraints];
    if (rules.explicitDegreeRisk) {
        avoidClaiming.push("Posting signals a degree gate — do not imply a bachelor's you don't have; be precise about your path or ask about exceptions early.");
    }
    if (rules.visaMismatch) {
        avoidClaiming.push("Visa/sponsorship: do not imply sponsorship where the posting restricts it.");
    }
    if (rules.citizenshipMismatch) {
        avoidClaiming.push("Citizenship requirement: do not claim eligibility you don't meet.");
    }
    if (rules.clearanceMismatch) {
        avoidClaiming.push("Clearance: do not claim cleared work without it.");
    }
    if (rules.seniorityOverreach) {
        avoidClaiming.push("Seniority: posting reads above your level story — don't claim staff-level ownership.");
    }
    if (rules.stackMismatch) {
        avoidClaiming.push("Stack shape: don't claim deep ownership in the posting's infra/SRE lane if that's not your story.");
    }
    if (rules.domainMismatch) {
        avoidClaiming.push("Domain: don't claim specialized domain depth the posting asks for without overlap.");
    }
    if (rules.strictNewGradPipeline || rules.newGradPenalty) {
        avoidClaiming.push("Pipeline: avoid sounding like a campus-hire program match if you're not in that track.");
    }
    if (rules.financePenalty || rules.traditionalCompanyPenalty) {
        avoidClaiming.push("Employer context: expect stricter screens — keep claims conservative and verifiable.");
    }
    avoidClaiming.push(`Main triage risk to respect: ${mainRisk}`);
    const recruiterReplyDraft = `Thanks for considering my application for ${title} at ${company}. Happy to answer a few scoping questions or share a small work sample that maps to the posting — especially around ${stackLine || "the core responsibilities"}.`;
    return {
        coverLetter,
        whyCompany,
        talkingPoints: normalizedTalkingPoints,
        tailoredBulletCandidates,
        emphasize: emphasize.slice(0, 6),
        avoidClaiming: avoidClaiming.slice(0, 12),
        recruiterReplyDraft,
    };
};
export const generateJobAssets = async (params) => {
    const { job, userProfile, force } = params;
    if (job.recommendation === "no" && !force) {
        return {
            generated: {},
            skipped: true,
            skipReason: "Recommendation is 'no'; asset generation is skipped unless force=true.",
        };
    }
    const fb = buildDeterministicGeneratedAssets(job, userProfile);
    const [cl, why, talk, bullets, strat] = await Promise.all([
        responsesClient.runStructured({
            systemPrompt: coverLetterAssetSystemPrompt,
            userPrompt: buildCoverLetterAssetUserPrompt({ job, userProfile }),
            schema: CoverLetterOut,
            fallback: () => ({ coverLetter: fb.coverLetter ?? "" }),
        }),
        responsesClient.runStructured({
            systemPrompt: whyCompanyAssetSystemPrompt,
            userPrompt: buildWhyCompanyAssetUserPrompt({ job, userProfile }),
            schema: WhyCompanyOut,
            fallback: () => ({ whyCompany: fb.whyCompany ?? "" }),
        }),
        responsesClient.runStructured({
            systemPrompt: talkingPointsAssetSystemPrompt,
            userPrompt: buildTalkingPointsAssetUserPrompt({ job, userProfile }),
            schema: TalkingOut,
            fallback: () => ({ talkingPoints: fb.talkingPoints ?? [] }),
        }),
        responsesClient.runStructured({
            systemPrompt: tailoredBulletsAssetSystemPrompt,
            userPrompt: buildTailoredBulletsAssetUserPrompt({ job, userProfile }),
            schema: BulletsOut,
            fallback: () => ({ tailoredBulletCandidates: fb.tailoredBulletCandidates ?? [] }),
        }),
        responsesClient.runStructured({
            systemPrompt: applicationStrategyAssetSystemPrompt,
            userPrompt: buildApplicationStrategyAssetUserPrompt({ job, userProfile }),
            schema: StrategyOut,
            fallback: () => ({
                emphasize: fb.emphasize ?? [],
                avoidClaiming: fb.avoidClaiming ?? [],
                recruiterReplyDraft: fb.recruiterReplyDraft,
            }),
        }),
    ]);
    const pick = (ok, primary, alt) => (ok ? primary : alt);
    let coverLetter = pick(cl.success, cl.data.coverLetter, fb.coverLetter);
    if (typeof coverLetter === "string" && coverLetter.trim()) {
        coverLetter = stripPastedJdHeaderFromCoverLetter(job, coverLetter);
        coverLetter = enforceCoverLetterWordBand(coverLetter, fb.coverLetter ?? "", { min: 120, max: 220 });
        if (hasExcessiveCaveatLanguage(coverLetter, job.recommendation)) {
            coverLetter = fb.coverLetter ?? coverLetter;
        }
    }
    let whyCompany = pick(why.success, why.data.whyCompany, fb.whyCompany);
    if (typeof whyCompany === "string" && whyCompany.trim() && job.recommendedResume === "SIE") {
        whyCompany = formatWhyCompanyForSIE(whyCompany);
    }
    const generated = {
        coverLetter,
        whyCompany,
        talkingPoints: pick(talk.success, talk.data.talkingPoints, fb.talkingPoints),
        tailoredBulletCandidates: pick(bullets.success, bullets.data.tailoredBulletCandidates, fb.tailoredBulletCandidates),
        emphasize: pick(strat.success, strat.data.emphasize, fb.emphasize),
        avoidClaiming: pick(strat.success, strat.data.avoidClaiming, fb.avoidClaiming),
        recruiterReplyDraft: pick(strat.success, strat.data.recruiterReplyDraft ?? fb.recruiterReplyDraft, fb.recruiterReplyDraft),
    };
    const debugAssetGeneration = {
        slices: {
            coverLetter: toSliceDebug(cl),
            whyCompany: toSliceDebug(why),
            talkingPoints: toSliceDebug(talk),
            tailoredBulletCandidates: toSliceDebug(bullets),
            applicationStrategy: toSliceDebug(strat),
        },
    };
    return { generated, debugAssetGeneration };
};
