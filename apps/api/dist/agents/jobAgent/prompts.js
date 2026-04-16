export const extractionSystemPrompt = `
You extract job posting details into strict JSON.
Rules:
- Only include facts supported by the posting text.
- Never guess missing values.
- Use "unknown" or omit when uncertain.
- Keep arrays deduplicated and concise.
- Output only valid JSON.
`;
export const buildExtractionPrompt = (input) => `
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
export const buildScoringPrompt = (params) => `
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
export const buildResumeSelectionPrompt = (params) => `
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
