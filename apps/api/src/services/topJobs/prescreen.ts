import { z } from "zod";
import { userProfile } from "../../config/userProfile.js";
import type { UserProfile } from "../../types/userProfile.js";
import { withLlmContext } from "../llm/llmUsage.js";
import { responsesClient, type StructuredCallResult } from "../llm/responsesClient.js";
import type { AlertListingDoc } from "./alertListings.repository.js";

export const PRESCREEN_VERDICTS = ["score", "maybe", "skip"] as const;
export type PrescreenVerdict = (typeof PRESCREEN_VERDICTS)[number];
export type Prescreen = { verdict: PrescreenVerdict; at: string };

/** Keeps each call small; a normal day's alerts fit in one batch. */
const BATCH_SIZE = 80;

const PrescreenSchema = z.object({
  picks: z.array(z.object({ i: z.number().int(), v: z.enum(PRESCREEN_VERDICTS) })),
});
type PrescreenOutput = z.infer<typeof PrescreenSchema>;

const SYSTEM_PROMPT = `You triage job-alert roles for one candidate before a costly full scoring step. You only see title, company, and location.

Return JSON only: {"picks":[{"i":<number>,"v":"score"|"maybe"|"skip"}]} with one entry per role.

- score: the title clearly matches the candidate's target roles and level.
- maybe: plausible but unclear (generic title, adjacent field, level unknown).
- skip: clearly wrong field (sales, support, non-software), clearly too senior (staff, principal, director, manager of managers, 8+ years implied), or a hard constraint is obviously violated.

Be strict with "score": the candidate can only afford to fully score about 3 roles a day.`;

export const profileSummary = (p: UserProfile): string =>
  [
    `Headline: ${p.headline}`,
    `Target roles: ${p.targetRoles.join("; ")}`,
    `Strengths: ${p.strengths.slice(0, 8).join("; ")}`,
    `Weaker areas: ${p.weakerAreas.slice(0, 5).join("; ")}`,
    p.screeningYears ?? p.estimatedProfessionalYears
      ? `Experience: about ${p.screeningYears ?? p.estimatedProfessionalYears} years`
      : "",
    `Location: remote or NYC metro only`,
    p.hardConstraints.length ? `Hard constraints: ${p.hardConstraints.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

export type PrescreenDeps = {
  run: (systemPrompt: string, userPrompt: string) => Promise<StructuredCallResult<PrescreenOutput>>;
  save: (key: string, prescreen: Prescreen) => Promise<void>;
  profile?: string;
};

const defaultRun: PrescreenDeps["run"] = (systemPrompt, userPrompt) =>
  withLlmContext({ feature: "top_jobs" }, () =>
    responsesClient.runStructured({
      systemPrompt,
      userPrompt,
      schema: PrescreenSchema,
      fallback: () => ({ picks: [] }),
      reasoningEffort: "low",
    }),
  );

/**
 * One cheap batched call labels roles that haven't been screened yet. Roles the model leaves out
 * become "maybe"; a failed call labels nothing, so those roles are retried on the next run.
 */
export const prescreenListings = async (
  listings: AlertListingDoc[],
  deps: Pick<PrescreenDeps, "save"> & Partial<PrescreenDeps>,
  now = new Date(),
): Promise<void> => {
  const run = deps.run ?? defaultRun;
  const profile = deps.profile ?? profileSummary(userProfile);
  const todo = listings.filter((l) => !l.prescreen);
  for (let start = 0; start < todo.length; start += BATCH_SIZE) {
    const batch = todo.slice(start, start + BATCH_SIZE);
    const lines = batch.map((l, i) => `${i + 1}. ${l.title} | ${l.company} | ${l.location ?? "location not given"}`);
    const result = await run(SYSTEM_PROMPT, `Candidate:\n${profile}\n\nRoles:\n${lines.join("\n")}`);
    if (!result.success) continue;
    const verdicts = new Map(result.data.picks.map((p) => [p.i, p.v]));
    for (const [i, listing] of batch.entries()) {
      const prescreen: Prescreen = { verdict: verdicts.get(i + 1) ?? "maybe", at: now.toISOString() };
      listing.prescreen = prescreen;
      await deps.save(listing._id, prescreen);
    }
  }
};
