import type { ExtractedJobData, JobRecord } from "../../types/job.js";
import type { ResumeType } from "../../types/resume.js";
import type { RuleEvaluation, ScoreBreakdown } from "../../types/scoring.js";
import type { UserProfile } from "../../types/userProfile.js";

export const extractionSystemPrompt = `
You extract job posting details into strict JSON.
Rules:
- Only include facts supported by the posting text.
- Never guess missing values.
- Use "unknown" or omit when uncertain.
- Keep arrays deduplicated and concise.
- Output only valid JSON.
`;

export const buildExtractionPrompt = (input: { url?: string; rawText?: string; companyHint?: string }): string => `
Extract a job posting into the required schema.
Company hint: ${input.companyHint ?? "none"}
URL: ${input.url ?? "none"}

Job text:
${input.rawText ?? "No raw text provided."}
`;

export const scoringSystemPrompt = `
You are a conservative job-screen evaluator.
Rules:
- Prioritize landability and recruiter-screen realism.
- Be strict with senior title claims and hard qualification gates.
- Do not infer experience or accomplishments not present.
- Degree requirements can be major filters in traditional/new-grad contexts.
- Output valid JSON only.
`;

export const buildScoringPrompt = (params: {
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
  userProfile: UserProfile;
  scoringPolicy: unknown;
}): string => `
Evaluate this role with conservative realism.
Return:
- score breakdown categories
- total score
- recommendation (yes/selective_yes/no)
- topMatch
- mainRisk
- rationale (array)
- risks (array)
- emphasize (array)
- avoidClaiming (array)

Extracted job:
${JSON.stringify(params.extracted, null, 2)}

Rule evaluation:
${JSON.stringify(params.rules, null, 2)}

User profile:
${JSON.stringify(params.userProfile, null, 2)}

Scoring policy:
${JSON.stringify(params.scoringPolicy, null, 2)}
`;

export const resumeSelectionSystemPrompt = `
Choose one resume type: SWE, SIE, or EARLY_CAREER.
Rules:
- Use role shape and expected recruiter screen.
- Do not choose based only on title.
- EARLY_CAREER is for explicit junior pipeline pitch, not low score fallback.
- Output valid JSON only.
`;

export const buildResumeSelectionPrompt = (params: {
  extracted: ExtractedJobData;
  score: ScoreBreakdown;
  topMatch: string;
  mainRisk: string;
  userProfile: UserProfile;
}): string => `
Select the best resume profile and explain why.
Return:
{
  "recommendedResume": "SWE|SIE|EARLY_CAREER",
  "confidence": number 0-1,
  "rationale": string[]
}

Job:
${JSON.stringify(params.extracted, null, 2)}

Score:
${JSON.stringify(params.score, null, 2)}

Top match: ${params.topMatch}
Main risk: ${params.mainRisk}

User profile:
${JSON.stringify(params.userProfile, null, 2)}
`;

/** Shared across all asset-generation prompts — keep in sync with product expectations. */
export const ASSET_GROUNDING_RULES = `
Grounding and honesty (non-negotiable):
- Use ONLY claims supportable from the provided user profile and extracted job data.
- Do NOT invent years of experience, titles, team size, leadership scope, production scale, or domain expertise.
- Do NOT claim technologies for the candidate unless they appear in the user profile (strengths, projects, recurring story) or are clearly framed as "the role uses X" rather than "I shipped X at scale".
- Do NOT oversell fit because the role scored well; acknowledge gaps where rules/risks flag them.
- Do NOT fabricate company facts not present in the posting.
- Keep language direct, human, and textbox-usable — not corporate fluff, not repetitive hype, not "thrilled to synergize".
- Prefer short sentences. Avoid em dashes stacked for fake polish.
`.trim();

export const buildResumeAngleBlock = (resume: ResumeType): string => {
  if (resume === "SWE") {
    return `
Resume angle: SWE (product engineering).
Emphasize: backend-leaning full-stack product work, APIs, internal tools, TypeScript/Node/React where profile supports it, shipping product features, pragmatic product tradeoffs.
Avoid: sounding like pure SRE/infra ownership or design-first craft unless the profile supports it.
`.trim();
  }
  if (resume === "SIE") {
    return `
Resume angle: SIE / implementation-adjacent.
Emphasize: hands-on implementation, integrations, delivery timelines, cross-functional collaboration, technical onboarding with stakeholders, translating requirements to workable technical plans, bridging technical and business needs.
Avoid: claiming deep proprietary domain expertise not in the profile.
`.trim();
  }
  return `
Resume angle: EARLY_CAREER.
Emphasize: strong fundamentals, learning velocity, practical shipping from projects/training, full-stack project work, growth mindset, mentorship-friendly tone.
Avoid: sounding artificially senior, claiming staff-level scope, or implying long industry tenure.
`.trim();
};

export const buildAssetJobContextJson = (job: JobRecord): string =>
  JSON.stringify(
    {
      extracted: job.extracted,
      rules: job.rules,
      score: job.score,
      recommendation: job.recommendation,
      recommendedResume: job.recommendedResume,
      resumeRationale: job.resumeRationale,
      topMatch: job.topMatch,
      mainRisk: job.mainRisk,
      rationale: job.rationale,
      risks: job.risks,
      salaryAsk: job.salaryAsk,
    },
    null,
    2,
  );

export const coverLetterAssetSystemPrompt = `
You write short, textbox-style cover letters for software job applications.
${ASSET_GROUNDING_RULES}
Output valid JSON only with a single key "coverLetter" (string, under ~220 words unless the posting demands slightly more).
`.trim();

export const buildCoverLetterAssetUserPrompt = (params: { job: JobRecord; userProfile: UserProfile }): string => `
${buildResumeAngleBlock(params.job.recommendedResume)}

User profile:
${JSON.stringify(params.userProfile, null, 2)}

Job + evaluation context:
${buildAssetJobContextJson(params.job)}

Write the cover letter. Reference the company and role concretely. Do not restate the entire job description.
`.trim();

export const whyCompanyAssetSystemPrompt = `
You write a concise "Why this company?" answer for an application form.
${ASSET_GROUNDING_RULES}
Ground the answer in the company name, role title, and specific problems/responsibilities/stack mentioned in the posting — not generic startup enthusiasm.
Output valid JSON only: { "whyCompany": string } (2–5 short sentences).
`.trim();

export const buildWhyCompanyAssetUserPrompt = (params: { job: JobRecord; userProfile: UserProfile }): string => `
${buildResumeAngleBlock(params.job.recommendedResume)}

User profile:
${JSON.stringify(params.userProfile, null, 2)}

Job + evaluation context:
${buildAssetJobContextJson(params.job)}
`.trim();

export const talkingPointsAssetSystemPrompt = `
You produce 3–5 practical talking points the candidate could use in a screen or recruiter call.
${ASSET_GROUNDING_RULES}
Each point: one sentence, concrete, tied to profile evidence and (lightly) to this role's needs where overlap exists.
Output valid JSON: { "talkingPoints": string[] } with length 3–5.
`.trim();

export const buildTalkingPointsAssetUserPrompt = (params: { job: JobRecord; userProfile: UserProfile }): string => `
${buildResumeAngleBlock(params.job.recommendedResume)}

User profile:
${JSON.stringify(params.userProfile, null, 2)}

Job + evaluation context:
${buildAssetJobContextJson(params.job)}
`.trim();

export const tailoredBulletsAssetSystemPrompt = `
You produce 3–5 resume bullet CANDIDATES (not final resume lines) adapted from the user's real projects and strengths.
${ASSET_GROUNDING_RULES}
Bullets should be past-tense, outcome-leaning where the profile already mentions outcomes — otherwise stay capability-focused without inventing metrics.
Output valid JSON: { "tailoredBulletCandidates": string[] } with length 3–5.
`.trim();

export const buildTailoredBulletsAssetUserPrompt = (params: { job: JobRecord; userProfile: UserProfile }): string => `
${buildResumeAngleBlock(params.job.recommendedResume)}

User profile:
${JSON.stringify(params.userProfile, null, 2)}

Job + evaluation context:
${buildAssetJobContextJson(params.job)}
`.trim();

export const applicationStrategyAssetSystemPrompt = `
You produce application strategy guidance: what to emphasize, what to avoid claiming, and a very short recruiter follow-up line.
${ASSET_GROUNDING_RULES}
The "avoidClaiming" list MUST explicitly warn against overclaiming wherever rules/score/risks indicate realistic recruiter-screen risk (examples: degree gates, sponsorship/citizenship, clearance, seniority overreach, stack mismatch, domain mismatch, traditional pipeline mismatch).
Output valid JSON:
{
  "emphasize": string[],
  "avoidClaiming": string[],
  "recruiterReplyDraft": string
}
Use 3–6 items in each array when risks warrant it; fewer if the role is clean. recruiterReplyDraft: one or two short sentences max, practical tone.
`.trim();

export const buildApplicationStrategyAssetUserPrompt = (params: { job: JobRecord; userProfile: UserProfile }): string => `
${buildResumeAngleBlock(params.job.recommendedResume)}

User profile:
${JSON.stringify(params.userProfile, null, 2)}

Job + evaluation context:
${buildAssetJobContextJson(params.job)}
`.trim();

