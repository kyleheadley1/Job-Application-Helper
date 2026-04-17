import type { ExtractedJobData, JobRecord } from '../../types/job.js';
import type { ResumeType } from '../../types/resume.js';
import type { RuleEvaluation, ScoreBreakdown } from '../../types/scoring.js';
import type { UserProfile } from '../../types/userProfile.js';

export const extractionSystemPrompt = `
You extract job posting details into ONE flat JSON object (no wrapper keys like "job" or "data").
Rules:
- Only include facts supported by the posting text.
- Never guess missing values.
- Use "unknown" or omit when uncertain.
- Keep arrays deduplicated and concise (strings only inside arrays).
- Output only valid JSON.

Required shape (field names must match exactly):
- company: non-empty string
- title: non-empty string
- url: OPTIONAL. Omit this key entirely unless you have a valid absolute http(s) URL from the input. Never use null, "", "none", or placeholders.
- location: OPTIONAL string only. If you include it, it must be a single human-readable line (e.g. "Remote (US)", "Hybrid — New York, NY"). Never return an object or array for location.
- remoteType: optional enum string: "remote" | "hybrid" | "onsite" | "unknown"
- locationIsCommutable: optional boolean
- salary, seniority, visaRequirement, etc.: only when clearly supported; use numbers for salary min/max.
- yearsExperience: if present, MUST be an object like { "raw": "2+", "min": 2, "max": 4 } — never a bare number or bare string at the top level.
- degreeRequirement: if present, MUST be an object like { "raw": "Bachelor's required", "level": "required" } — never a bare string.
- stack, requiredSkills, preferredSkills, domainTags, responsibilities, requirements: arrays of strings (empty arrays allowed).
`.trim();

export const buildExtractionPrompt = (input: {
  url?: string;
  rawText?: string;
  companyHint?: string;
}): string => `
Extract a job posting into the required schema.
Company hint: ${input.companyHint ?? 'none'}
URL: ${input.url ?? 'none'}

Job text:
${input.rawText ?? 'No raw text provided.'}
`;

export const scoringSystemPrompt = `
You are a conservative job-screen evaluator.
Rules:
- Prioritize landability and recruiter-screen realism.
- Be strict with senior title claims and hard qualification gates.
- Do not infer experience or accomplishments not present.
- Degree requirements can be major filters in traditional/new-grad contexts.
- Output ONE flat JSON object with ONLY the keys listed in the user message — no extra keys, no nested wrapper, no markdown.
`.trim();

export const buildScoringPrompt = (params: {
  extracted: ExtractedJobData;
  rules: RuleEvaluation;
  userProfile: UserProfile;
  scoringPolicy: unknown;
}): string =>
  `
Evaluate this role with conservative realism.

Return EXACTLY these keys (and no others):
{
  "score": {
    "stackFit": number (0-25),
    "levelFit": number (0-15),
    "domainFit": number (0-10),
    "resumeStoryClarity": number (0-15),
    "functionalOverlap": number (0-10),
    "recruiterFriendliness": number (0-15),
    "careerValue": number (0-10),
    "total": number (0-100)
  },
  "recommendation": "yes" | "selective_yes" | "no",
  "topMatch": string (one short sentence; never boolean),
  "mainRisk": string (one short sentence; never boolean),
  "rationale": string[],
  "risks": string[]
}

Notes:
- "score.total" must equal the sum of the seven category scores (integer math).
- "topMatch" and "mainRisk" must be human-readable strings, not booleans or numbers.

Extracted job:
${JSON.stringify(params.extracted, null, 2)}

Rule evaluation:
${JSON.stringify(params.rules, null, 2)}

User profile:
${JSON.stringify(params.userProfile, null, 2)}

Scoring policy:
${JSON.stringify(params.scoringPolicy, null, 2)}
`.trim();

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

/** Reduce copy-paste repetition across assets for the same job. */
export const ASSET_EVIDENCE_DIVERSITY = `
Evidence rotation (important):
- Use BOTH flagship projects where they add distinct proof — do not repeat the same opening project sentence across paragraphs or bullets unless necessary.
- Match the angle to this job's shape: integrations / customer delivery / workshops for SIE; product ambiguity + internal tools for SWE; fundamentals + mentorship + learning velocity for EARLY_CAREER.
- At most one asset section should lead with the same flagship project name; vary which project anchors bullets vs. cover letter when both are relevant.
`.trim();

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
  if (resume === 'SWE') {
    return `
Resume angle: SWE (product engineering).
Emphasize: backend-leaning full-stack product work, APIs, internal tools, TypeScript/Node/React where profile supports it, shipping product features, pragmatic product tradeoffs.
Avoid: sounding like pure SRE/infra ownership or design-first craft unless the profile supports it.
`.trim();
  }
  if (resume === 'SIE') {
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
Formatting:
- Start with a normal greeting ("Hello {company} team", "Dear hiring team", etc.).
- Never begin with a raw job-description header line (e.g. "{company} — {title}" copied from the posting).
Output valid JSON only with a single key "coverLetter" (string, under ~220 words unless the posting demands slightly more).
`.trim();

export const buildCoverLetterAssetUserPrompt = (params: {
  job: JobRecord;
  userProfile: UserProfile;
}): string =>
  `
${buildResumeAngleBlock(params.job.recommendedResume)}

${ASSET_EVIDENCE_DIVERSITY}

User profile:
${JSON.stringify(params.userProfile, null, 2)}

Job + evaluation context:
${buildAssetJobContextJson(params.job)}

Write the cover letter. Reference the company and role concretely. Do not restate the entire job description.
${
  params.job.recommendation === 'no'
    ? '\nTone: candid about fit risks the evaluation already flagged, still respectful — this is likely a stretch application.\n'
    : ''
}
`.trim();

export const whyCompanyAssetSystemPrompt = `
You write a concise "Why this company?" answer for an application form.
${ASSET_GROUNDING_RULES}
Ground the answer in the company name, role title, and specific problems/responsibilities/stack mentioned in the posting — not generic startup enthusiasm.
Output valid JSON only: { "whyCompany": string }.
Length: 2–5 short sentences. Prefer line breaks (actual newline characters inside the JSON string) between sentences so the answer is scannable — especially for customer-facing / solutions / integration roles.
`.trim();

export const buildWhyCompanyAssetUserPrompt = (params: {
  job: JobRecord;
  userProfile: UserProfile;
}): string =>
  `
${buildResumeAngleBlock(params.job.recommendedResume)}

${ASSET_EVIDENCE_DIVERSITY}

User profile:
${JSON.stringify(params.userProfile, null, 2)}

Job + evaluation context:
${buildAssetJobContextJson(params.job)}
${
  params.job.recommendedResume === 'SIE'
    ? `\nFor this SIE / implementation-forward angle: keep each sentence short; separate sentences with newline characters inside the JSON string (not one dense block paragraph).\n`
    : ''
}
`.trim();

export const talkingPointsAssetSystemPrompt = `
You produce 3–5 practical talking points the candidate could use in a screen or recruiter call.
${ASSET_GROUNDING_RULES}
Each point: one sentence, concrete, tied to profile evidence and (lightly) to this role's needs where overlap exists.
Output valid JSON: { "talkingPoints": string[] } with length 3–5.
`.trim();

export const buildTalkingPointsAssetUserPrompt = (params: {
  job: JobRecord;
  userProfile: UserProfile;
}): string =>
  `
${buildResumeAngleBlock(params.job.recommendedResume)}

${ASSET_EVIDENCE_DIVERSITY}

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

export const buildTailoredBulletsAssetUserPrompt = (params: {
  job: JobRecord;
  userProfile: UserProfile;
}): string =>
  `
${buildResumeAngleBlock(params.job.recommendedResume)}

${ASSET_EVIDENCE_DIVERSITY}

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

export const buildApplicationStrategyAssetUserPrompt = (params: {
  job: JobRecord;
  userProfile: UserProfile;
}): string =>
  `
${buildResumeAngleBlock(params.job.recommendedResume)}

${ASSET_EVIDENCE_DIVERSITY}

User profile:
${JSON.stringify(params.userProfile, null, 2)}

Job + evaluation context:
${buildAssetJobContextJson(params.job)}
`.trim();
