import { z } from "zod";
import { env } from "../../config/env.js";
import { withLlmContext } from "../llm/llmUsage.js";
import { responsesClient } from "../llm/responsesClient.js";
import type { EmailEventType } from "./gmailClassifier.js";
import type { ParsedEmail } from "./gmailClient.js";

export const ACTION_TYPES = ["schedule", "reply", "assessment", "offer"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** What an application email asks the candidate to do. Stored on the message classification. */
export type ActionRequest = {
  needed: boolean;
  type: ActionType | null;
  /** Short imperative, e.g. "Pick a time for the technical interview". */
  summary: string | null;
  /** Response or completion deadline (UTC ISO) when the email states one. */
  deadline: string | null;
  version: number;
};

/** Bump when the prompt changes, so recent emails are re-checked. */
export const ACTION_REQUEST_VERSION = 1;

/** Rejections and plain "we received your application" notes never ask for anything. */
export const ACTION_EVENT_TYPES: EmailEventType[] = ["interview", "assessment", "offer", "other"];

const ActionSchema = z.object({
  needed: z.boolean(),
  type: z.enum(ACTION_TYPES).nullable().optional(),
  summary: z.string().trim().min(1).max(140).nullable().optional(),
  deadline: z.string().trim().min(1).nullable().optional(),
});

const NO_ACTION: z.infer<typeof ActionSchema> = { needed: false, type: null, summary: null, deadline: null };

const SYSTEM_PROMPT = `You read one email about a job application and decide whether it asks the candidate to do something before the process can continue.

Return JSON only:
{
  "needed": boolean,
  "type": "schedule" | "reply" | "assessment" | "offer" | null,
  "summary": string | null,   // <=12 words, imperative, specific: "Pick a time for the technical interview", "Send availability for a call with Jane"
  "deadline": string | null   // ISO 8601 with UTC offset only if the email states a deadline ("by Friday", "within 48 hours"); else null
}

Types:
- schedule: a booking link (Calendly, GoodTime, ATS scheduler), a request for availability, or proposed time slots to choose from.
- reply: the email asks the candidate to answer questions, confirm interest or attendance, send documents/references, or otherwise respond.
- assessment: a coding challenge, take-home, or online assessment to start or complete.
- offer: an offer or decision the candidate must accept, decline, or discuss.

needed is false for: calendar invites or confirmations with a fixed time (nothing to choose), rejections, "we received your application", status updates with no request, reminders for an interview that is already scheduled, and marketing.
Resolve relative deadlines against the email's Date in the candidate's timezone. Never invent a deadline.`;

const toUtcIso = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

export const extractActionRequest = async (
  email: ParsedEmail,
): Promise<{ action: ActionRequest; llmSucceeded: boolean }> => {
  const userPrompt = [
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    `Date: ${email.date}`,
    `Candidate timezone: ${env.userTimezone}`,
    "",
    email.body || email.snippet,
  ].join("\n");
  const result = await withLlmContext({ feature: "gmail_classify" }, () =>
    responsesClient.runStructured({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      schema: ActionSchema,
      fallback: () => ({ ...NO_ACTION }),
      reasoningEffort: env.gmailClassifyReasoningEffort,
    }),
  );
  const d = result.data;
  const needed = d.needed && Boolean(d.type);
  return {
    llmSucceeded: result.success,
    action: {
      needed,
      type: needed ? (d.type ?? null) : null,
      summary: needed ? (d.summary ?? null) : null,
      deadline: needed ? toUtcIso(d.deadline) : null,
      version: ACTION_REQUEST_VERSION,
    },
  };
};
