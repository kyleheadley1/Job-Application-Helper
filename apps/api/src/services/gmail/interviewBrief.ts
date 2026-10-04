import { z } from "zod";
import { withLlmContext } from "../llm/llmUsage.js";
import { responsesClient } from "../llm/responsesClient.js";
import { resumeContextService } from "../resume/resumeContext.js";
import { toActiveResumeType } from "../../types/resume.js";
import { getGmailApplications, UPCOMING_LOOKBACK_DAYS, type GmailApplication } from "./gmailApplications.js";
import type { InterviewRound } from "./interviewRounds.js";
import { evaluationsRepository, type ApplicationEvaluation } from "./jdRecovery/evaluations.repository.js";

export const INTERVIEW_BRIEF_PROMPT_VERSION = "brief-v1";

export type InterviewBrief = {
  companyBio: string;
  teamNeed: string;
  strengths: Array<{ point: string; evidence: string }>;
  weakPoints: Array<{ gap: string; probe: string; answer: string }>;
  askThem: string[];
  generatedAt: string;
  promptVersion: string;
};

export type InterviewBriefResponse = {
  key: string;
  company: string;
  role: string | null;
  /** Free, from interview emails: "2nd round · technical with Jane Doe · live coding". */
  round: string | null;
  brief: InterviewBrief | null;
  reason?: "no_jd" | "llm_failed";
  prepPrompt: string;
};

const JD_CHARS = 6000;
const RESUME_CHARS = 5000;

const clipWords = (max: number) => (s: string) => {
  const words = s.trim().split(/\s+/);
  return words.length <= max ? words.join(" ") : `${words.slice(0, max).join(" ")}…`;
};
const text = (maxWords: number) => z.string().trim().min(1).transform(clipWords(maxWords));
const capped = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z.array(item).transform((a) => a.slice(0, max));

export const BriefSchema = z.object({
  companyBio: text(40),
  teamNeed: text(25),
  strengths: capped(z.object({ point: text(12), evidence: text(25) }), 3),
  weakPoints: capped(z.object({ gap: text(12), probe: text(20), answer: text(30) }), 3),
  askThem: capped(text(25), 2),
});

type BriefFields = z.infer<typeof BriefSchema>;

const SYSTEM_PROMPT = `You write a compact interview cheat sheet for a job candidate. They do full prep elsewhere; this is a 2-minute refresher.
Use ONLY the job description and the resume provided. Never invent company facts, numbers, customers, or funding; if the JD does not say, leave it out.

Return JSON only:
{
  "companyBio": string,   // <=40 words: what the company sells, to whom, stage/size if the JD says
  "teamNeed": string,     // <=25 words: what this team needs the hire to do
  "strengths": [{ "point": string, "evidence": string }],          // up to 3: a JD requirement -> concrete proof from the resume
  "weakPoints": [{ "gap": string, "probe": string, "answer": string }], // up to 3: the gap, the question an interviewer would ask, a one-line honest bridge answer
  "askThem": [string]     // 2 sharp questions specific to this role/team
}
Weak points must come from the scorer's risks listed below (rephrase, don't add new ones unless the JD clearly demands something missing from the resume). Answers are honest bridges: adjacent experience plus how you'd close the gap, never claims the resume can't back.`;

const list = (items: string[] | undefined) => (items?.length ? items.map((s) => `- ${s}`).join("\n") : "- (none)");

const scorerSignals = (e: ApplicationEvaluation) => {
  const d = e.fit?.detail;
  const b = e.fit?.breakdown;
  return {
    topMatch: d?.topMatch ?? b?.topMatch,
    mainRisk: d?.mainRisk ?? b?.mainRisk,
    rationale: d?.rationale ?? [],
    risks: d?.risks ?? b?.risks ?? [],
    requiredSkills: d?.extracted.requiredSkills ?? [],
  };
};

export const buildBriefUserPrompt = (e: ApplicationEvaluation, resumeText: string | null): string => {
  const s = scorerSignals(e);
  return [
    `Company: ${e.company}`,
    `Role: ${e.role ?? e.jd?.title ?? "(not stated)"}`,
    "",
    "Scorer findings (already decided; stay consistent):",
    `Top match: ${s.topMatch ?? "(none)"}`,
    `Main risk: ${s.mainRisk ?? "(none)"}`,
    "Why it fits:",
    list(s.rationale),
    "Risks:",
    list(s.risks),
    "Required skills:",
    list(s.requiredSkills),
    "",
    "Job description:",
    (e.jd?.text ?? "").slice(0, JD_CHARS),
    "",
    "Candidate resume:",
    resumeText ? resumeText.slice(0, RESUME_CHARS) : "(unavailable)",
  ].join("\n");
};

const EMPTY: BriefFields = { companyBio: "-", teamNeed: "-", strengths: [], weakPoints: [], askThem: [] };

/** One small LLM call; null when the model call fails. */
export const generateBrief = async (e: ApplicationEvaluation): Promise<InterviewBrief | null> => {
  const resume = await resumeContextService.getContext(toActiveResumeType(e.fit?.recommendedResume));
  const result = await withLlmContext({ feature: "jd_recovery", key: e.key }, () =>
    responsesClient.runStructured({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildBriefUserPrompt(e, resume?.rawText ?? null),
      schema: BriefSchema,
      fallback: () => EMPTY,
      reasoningEffort: "low",
    }),
  );
  if (!result.success) return null;
  return { ...result.data, generatedAt: new Date().toISOString(), promptVersion: INTERVIEW_BRIEF_PROMPT_VERSION };
};

export const roundLine = (round: InterviewRound | undefined): string | null => {
  if (!round) return null;
  return [round.label, round.focus && !round.label.toLowerCase().includes(round.focus.toLowerCase()) ? round.focus : null]
    .filter(Boolean)
    .join(" · ");
};

const nextRound = (app: GmailApplication | undefined): InterviewRound | undefined => {
  const rounds = app?.interviewRounds ?? [];
  const now = Date.now();
  return rounds.find((r) => r.scheduledAt && !r.cancelled && Date.parse(r.scheduledAt) > now) ?? rounds[rounds.length - 1];
};

export const buildPrepPrompt = (input: {
  company: string;
  role: string | null;
  round: InterviewRound | undefined;
  evaluation: ApplicationEvaluation | null;
  brief: InterviewBrief | null;
}): string => {
  const { company, role, round, evaluation: e, brief } = input;
  const s = e ? scorerSignals(e) : null;
  const resume = e?.fit?.recommendedResume ? toActiveResumeType(e.fit.recommendedResume) : null;
  const when = round?.scheduledAt
    ? new Date(round.scheduledAt).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })
    : null;
  const lines = [
    `Help me prepare for an interview. I'm a software engineer interviewing for ${role ?? "a role"} at ${company}.`,
    resume ? `I applied with my ${resume} resume (attached).` : "My resume is attached.",
    "",
    "## The interview",
    `- Round: ${roundLine(round) ?? "unknown"}`,
    round?.interviewers ? `- Interviewers: ${round.interviewers}` : null,
    when ? `- When: ${when}${round?.durationMinutes ? ` (${round.durationMinutes} min)` : ""}` : null,
  ];
  if (brief) {
    lines.push(
      "",
      "## What I already know",
      `- Company: ${brief.companyBio}`,
      `- Team need: ${brief.teamNeed}`,
      "- My strengths:",
      ...brief.strengths.map((x) => `  - ${x.point}: ${x.evidence}`),
      "- My weak points:",
      ...brief.weakPoints.map((x) => `  - ${x.gap} (likely probe: ${x.probe})`),
    );
  } else if (s) {
    lines.push("", "## Scorer notes", `- Top match: ${s.topMatch ?? "-"}`, "- Risks:", ...s.risks.map((r) => `  - ${r}`));
  }
  lines.push(
    "",
    "## What I want from you",
    "1. Research the company (product, customers, recent news, engineering culture) and tell me what matters for this round.",
    "2. List the questions this round is most likely to include, with strong answers grounded in my resume.",
    "3. For each weak point, drill me: ask the hard follow-ups and critique my answers.",
    "4. Give me 2-3 STAR stories from my resume mapped to this role's requirements.",
    "5. Suggest sharp questions to ask the interviewers.",
  );
  if (e?.jd?.text) lines.push("", "## Job description", e.jd.text);
  return lines.filter((l): l is string => l !== null).join("\n");
};

/** Cached brief, generated on first request. Without a recovered JD nothing is generated, so no bio is guessed. */
export const resolveBrief = async (
  evaluation: ApplicationEvaluation | null,
  opts: { regenerate?: boolean; generate?: typeof generateBrief; save?: (key: string, b: InterviewBrief) => Promise<void> } = {},
): Promise<{ brief: InterviewBrief | null; reason?: InterviewBriefResponse["reason"] }> => {
  if (!evaluation?.jd?.text) return { brief: null, reason: "no_jd" };
  if (evaluation.interviewBrief && !opts.regenerate) return { brief: evaluation.interviewBrief };
  const brief = await (opts.generate ?? generateBrief)(evaluation);
  if (!brief) return { brief: evaluation.interviewBrief ?? null, reason: evaluation.interviewBrief ? undefined : "llm_failed" };
  await (opts.save ?? ((key, b) => evaluationsRepository.setInterviewBrief(key, b)))(evaluation.key, brief);
  return { brief };
};

export const getInterviewBrief = async (key: string, regenerate = false): Promise<InterviewBriefResponse | null> => {
  const [apps, evaluation] = await Promise.all([
    getGmailApplications(UPCOMING_LOOKBACK_DAYS),
    evaluationsRepository.findByKey(key),
  ]);
  const app = apps.find((a) => a.key === key);
  if (!app && !evaluation) return null;
  const company = app?.company ?? evaluation!.company;
  const role = app?.role ?? evaluation?.role ?? null;
  const round = nextRound(app);
  const { brief, reason } = await resolveBrief(evaluation, { regenerate });
  return {
    key,
    company,
    role,
    round: roundLine(round),
    brief,
    ...(reason ? { reason } : {}),
    prepPrompt: buildPrepPrompt({ company, role, round, evaluation, brief }),
  };
};
