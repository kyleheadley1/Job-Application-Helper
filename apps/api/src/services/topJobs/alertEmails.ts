import { z } from "zod";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import type { AlertPlatform } from "../../types/topJob.js";
import { normalizeCompany, roleTokens } from "../gmail/gmailApplications.js";
import {
  extractHtml,
  gmailClient,
  GmailRateLimitError,
  htmlToPlainText,
  parseGmailMessage,
  type ParsedEmail,
} from "../gmail/gmailClient.js";
import { unwrapLink } from "../gmail/jdRecovery/emailEvidence.js";
import { linkedinJobId } from "../gmail/jdRecovery/fetchPosting.js";
import { withLlmContext } from "../llm/llmUsage.js";
import { responsesClient } from "../llm/responsesClient.js";
import { alertListingsRepository, type NewAlertListing } from "./alertListings.repository.js";

export const MAX_ALERT_EMAILS_PER_SYNC = 60;
const ALERT_BODY_CHARS = 8000;
const MAX_ANCHORS = 120;
const MAX_ANCHOR_TEXT = 160;
const MAX_JOBS_PER_EMAIL = 40;

export const buildAlertSearchQuery = (days: number): string =>
  `newer_than:${days}d (from:(linkedin.com OR indeed.com OR indeedemail.com OR ziprecruiter.com OR remotehunter.com OR mail.remotehunter.com) OR "remote hunter") -subject:("application was sent" OR "your application" OR "applied to")`;

export const alertPlatform = (from: string): AlertPlatform | null => {
  const f = from.toLowerCase();
  if (/remote\s*-?hunter/.test(f)) return "remotehunter";
  const domain = f.match(/@([a-z0-9.-]+)/)?.[1] ?? "";
  if (/(^|\.)linkedin\.com$/.test(domain)) return "linkedin";
  if (/(^|\.)(indeed|indeedemail)\.com$/.test(domain)) return "indeed";
  if (/(^|\.)ziprecruiter\.com$/.test(domain)) return "ziprecruiter";
  return null;
};

const NOT_ALERT_SUBJECT_RE =
  /application (?:was |has been )?(?:sent|submitted|received|viewed)|you applied|your application|viewed your (?:profile|application)|sent you a (?:message|connection)|\binmail\b|invitation|password|verify|security|receipt|invoice/i;

const ALERT_SUBJECT_RE =
  /\bjob alert\b|\bnew jobs?\b|\bjob matches\b|\bjobs? (?:for you|you may|matching|similar|near|picked)|\bis hiring\b|\bare hiring\b|\btop job picks\b|\brecommended (?:jobs?|for you)\b|\bapply now\b|\bopportunit(?:y|ies)\b|\broles? (?:for you|matching)|\b\d+\+? (?:new )?(?:jobs?|roles?|positions?)\b/i;

const JOB_TITLE_HINT_RE =
  /\b(engineer|developer|software|full[\s-]?stack|backend|front[\s-]?end|programmer|architect|analyst|scientist|designer|manager)\b/i;

const BLOCKED_ANCHOR_RE =
  /unsubscribe|opt-?out|privacy|preferences|email[-_]?settings|manage[-_]?(subscriptions|alerts)|\/help\b|\/legal\b|\/terms\b|cookie|app\.store|play\.google|apps\.apple/i;

export type Anchor = { href: string; text: string };

const ANCHOR_RE = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

/** LinkedIn alert links carry per-email tracking; the bare job URL is stable and opens without it. */
const canonicalHref = (href: string): string => {
  try {
    const url = new URL(href);
    if (/(^|\.)linkedin\.com$/.test(url.hostname)) {
      const id = linkedinJobId(url);
      if (id) return `https://www.linkedin.com/jobs/view/${id}`;
    }
  } catch {
    // keep as-is
  }
  return href;
};

/** Links with their visible text, de-duplicated by target; image-only links are dropped. */
export const extractAnchors = (html: string): Anchor[] => {
  const byHref = new Map<string, string[]>();
  for (const m of html.matchAll(ANCHOR_RE)) {
    const raw = m[1]!.replace(/&amp;/gi, "&").trim();
    if (!/^https?:\/\//i.test(raw) || BLOCKED_ANCHOR_RE.test(raw)) continue;
    const href = canonicalHref(unwrapLink(raw) ?? raw);
    const text = htmlToPlainText(m[2]!).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const texts = byHref.get(href) ?? [];
    if (!texts.includes(text)) texts.push(text);
    byHref.set(href, texts);
  }
  return [...byHref]
    .map(([href, texts]) => ({ href, text: texts.join(" | ").slice(0, MAX_ANCHOR_TEXT) }))
    .slice(0, MAX_ANCHORS);
};

/** Cheap gate before the LLM: a platform sender, not an application or account email, and alert-shaped. */
export const isLikelyAlert = (email: Pick<ParsedEmail, "from" | "subject">, anchors: Anchor[]): boolean => {
  if (!alertPlatform(email.from)) return false;
  if (NOT_ALERT_SUBJECT_RE.test(email.subject)) return false;
  if (ALERT_SUBJECT_RE.test(email.subject)) return true;
  return anchors.filter((a) => JOB_TITLE_HINT_RE.test(a.text)).length >= 3;
};

export const platformJobId = (url: string, platform: AlertPlatform): string | undefined => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (platform === "linkedin") return linkedinJobId(parsed);
  if (platform === "indeed") return parsed.searchParams.get("jk") ?? undefined;
  return undefined;
};

export const listingKey = (company: string, title: string): string =>
  `${normalizeCompany(company)}|${roleTokens(title).sort().join(" ")}`;

const ListingSchema = z.object({
  jobs: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(160),
        company: z.string().trim().min(1).max(120),
        location: z.string().trim().max(120).nullable().optional(),
        link: z.number().int().nonnegative().nullable().optional(),
      }),
    )
    .max(MAX_JOBS_PER_EMAIL),
});
export type ParsedAlertJob = z.infer<typeof ListingSchema>["jobs"][number];

const SYSTEM_PROMPT = `You read one job-alert email from a job board (LinkedIn, Indeed, ZipRecruiter, Remote Hunter) and list every individual job posting it recommends.

Return JSON only:
{ "jobs": [ { "title": string, "company": string, "location": string | null, "link": number | null } ] }

- title: the job title exactly as shown, without the company or location.
- company: the hiring employer, never the job board itself.
- location: as shown ("Remote", "New York, NY"), or null.
- link: the [number] of the link that opens that specific job, from the numbered link list; null if none fits.
Skip ads for courses or premium plans, "see all jobs" links, and anything that is not a single job posting. Return {"jobs": []} if the email has no job postings.`;

export const buildAlertUserPrompt = (email: ParsedEmail, anchors: Anchor[]): string =>
  [
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    "",
    "Links:",
    ...anchors.map((a, i) => `[${i}] ${a.text}`),
    "",
    "Email text:",
    email.body || email.snippet,
  ].join("\n");

export const toAlertListings = (
  jobs: ParsedAlertJob[],
  anchors: Anchor[],
  email: Pick<ParsedEmail, "id" | "date">,
  platform: AlertPlatform,
): NewAlertListing[] => {
  const out = new Map<string, NewAlertListing>();
  for (const job of jobs) {
    if (/^unknown\b/i.test(job.company) || /^unknown\b/i.test(job.title)) continue;
    const key = listingKey(job.company, job.title);
    if (!key.split("|")[0] || !key.split("|")[1] || out.has(key)) continue;
    const url = job.link != null ? (anchors[job.link]?.href ?? null) : null;
    out.set(key, {
      key,
      company: job.company,
      title: job.title,
      location: job.location ?? null,
      platform,
      url,
      externalId: url ? platformJobId(url, platform) : undefined,
      emailId: email.id,
      emailDate: email.date,
    });
  }
  return [...out.values()];
};

export const extractAlertJobs = async (
  email: ParsedEmail,
  anchors: Anchor[],
): Promise<{ jobs: ParsedAlertJob[]; llmSucceeded: boolean }> => {
  const result = await withLlmContext({ feature: "top_jobs" }, () =>
    responsesClient.runStructured({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildAlertUserPrompt(email, anchors),
      schema: ListingSchema,
      fallback: () => ({ jobs: [] }),
      reasoningEffort: env.gmailClassifyReasoningEffort,
    }),
  );
  return { jobs: result.data.jobs, llmSucceeded: result.success };
};

export type AlertIngestResult = { alertEmails: number; listingsParsed: number; rateLimited: boolean };

/** Read new alert emails and queue their roles; each email is parsed once. */
export const ingestAlertEmails = async (
  days = env.topJobsListingMaxAgeDays,
  maxEmails = MAX_ALERT_EMAILS_PER_SYNC,
): Promise<AlertIngestResult> => {
  const result: AlertIngestResult = { alertEmails: 0, listingsParsed: 0, rateLimited: false };
  const ids = await gmailClient.listMessageIds(buildAlertSearchQuery(days), 300);
  const processed = await alertListingsRepository.processedMessageIds(ids);
  const fresh = ids.filter((id) => !processed.has(id)).slice(0, maxEmails);

  for (const id of fresh) {
    try {
      const raw = await gmailClient.getRawMessage(id);
      const email = parseGmailMessage(raw, ALERT_BODY_CHARS);
      const anchors = extractAnchors(extractHtml(raw.payload));
      const platform = alertPlatform(email.from);
      if (!platform || !isLikelyAlert(email, anchors)) {
        await alertListingsRepository.markMessageProcessed({ _id: id, platform, date: email.date, listings: 0 });
        continue;
      }
      const { jobs, llmSucceeded } = await extractAlertJobs(email, anchors);
      if (!llmSucceeded) continue;
      const listings = toAlertListings(jobs, anchors, email, platform);
      for (const l of listings) await alertListingsRepository.upsertListing(l);
      await alertListingsRepository.markMessageProcessed({
        _id: id,
        platform,
        date: email.date,
        listings: listings.length,
      });
      result.alertEmails += 1;
      result.listingsParsed += listings.length;
    } catch (error) {
      if (error instanceof GmailRateLimitError) {
        result.rateLimited = true;
        break;
      }
      logger.warn("Alert email parse failed", {
        id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
};
