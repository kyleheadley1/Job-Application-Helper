import type { ParsedEmail } from "../gmailClient.js";
import { unwrapLink } from "./emailEvidence.js";

export type AtsKind = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workable" | "workday";

export type WorkdaySite = { origin: string; tenant: string; site: string };

/** Board identity. For Workday the slug is `tenant/site`. */
export type BoardRef = { ats: AtsKind; slug: string; workday?: WorkdaySite };

export type AtsHints = {
  /** Boards named by the application's own emails (trusted as the right company). */
  boards: BoardRef[];
  /** ATS seen in sender addresses without a slug; used to order slug guessing. */
  atsOnly: AtsKind[];
  /** Company email domain roots, e.g. `teleskope` from `jobs@teleskope.ai`. */
  senderRoots: string[];
};

const SENDER_ATS: Array<[RegExp, AtsKind]> = [
  [/(^|\.)greenhouse(-mail)?\.io$/, "greenhouse"],
  [/(^|\.)lever\.co$/, "lever"],
  [/(^|\.)ashbyhq\.com$/, "ashby"],
  [/(^|\.)myworkday(jobs)?\.com$/, "workday"],
  [/(^|\.)smartrecruiters\.com$/, "smartrecruiters"],
  [/(^|\.)workable(mail)?\.com$/, "workable"],
];

const NON_COMPANY_DOMAIN_RE =
  /(^|\.)(gmail|googlemail|outlook|hotmail|yahoo|icloud|linkedin|indeed|indeedemail|glassdoor|ziprecruiter|greenhouse|greenhouse-mail|lever|ashbyhq|myworkday|myworkdayjobs|smartrecruiters|workable|workablemail|icims|jobvite|taleo|successfactors|bamboohr|breezy|recruitee|jazzhr|dover|wellfound|handshake|joinhandshake|google|amazonses|sendgrid|mailgun|mandrillapp|hubspot|salesforce)\.[a-z.]+$/i;

const GENERIC_SUBDOMAIN_RE = /^(mail|email|e|careers|jobs|talent|recruiting|notifications?|noreply|no-reply|hr|people|hello|team|info|news)$/i;
const SECOND_LEVEL_TLD_RE = /^(co|com|org|net|ac|gov)$/i;
const LOCALE_RE = /^[a-z]{2}-[A-Z]{2}$/;

export const senderDomain = (from: string): string | undefined =>
  from.match(/@([a-z0-9.-]+\.[a-z]{2,})/i)?.[1]?.toLowerCase();

/** `jobs.teleskope.ai` -> `teleskope`; `careers.acme.co.uk` -> `acme`. */
export const domainRoot = (domain: string): string | undefined => {
  const parts = domain.toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) return undefined;
  let idx = parts.length - 2;
  if (parts.length >= 3 && SECOND_LEVEL_TLD_RE.test(parts[idx]!)) idx -= 1;
  const root = parts[idx];
  return root && !GENERIC_SUBDOMAIN_RE.test(root) ? root : undefined;
};

/** Board named by a URL, including candidate-portal and login links. */
export type BoardHint = Omit<BoardRef, "slug"> & { slug?: string };

export const boardFromUrl = (raw: string): BoardHint | undefined => {
  let url: URL;
  try {
    url = new URL(unwrapLink(raw) ?? raw);
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  const first = segments[0];

  if (/^(job-boards|boards)(\.eu)?\.greenhouse\.io$/.test(host)) {
    const forParam = url.searchParams.get("for");
    if (forParam) return { ats: "greenhouse", slug: forParam };
    if (first && first !== "embed") return { ats: "greenhouse", slug: first };
    return undefined;
  }
  if (host === "jobs.lever.co" && first) return { ats: "lever", slug: first };
  if (host === "jobs.ashbyhq.com" && first) return { ats: "ashby", slug: first };
  if (/^(jobs|careers)\.smartrecruiters\.com$/.test(host) && first) return { ats: "smartrecruiters", slug: first };
  if (host === "apply.workable.com" && first && first !== "api") return { ats: "workable", slug: first };
  if (/\.myworkdayjobs\.com$/.test(host)) {
    const tenant = host.split(".")[0]!;
    const site = segments.find((s) => !LOCALE_RE.test(s) && s !== "wday" && s !== "cxs");
    if (!site) return undefined;
    return { ats: "workday", slug: `${tenant}/${site}`, workday: { origin: url.origin, tenant, site } };
  }
  if (url.searchParams.has("gh_jid")) return { ats: "greenhouse" };
  return undefined;
};

const boardKey = (b: BoardRef) => `${b.ats}:${b.slug.toLowerCase()}`;

export const detectAtsHints = (emails: Pick<ParsedEmail, "from" | "links">[]): AtsHints => {
  const boards = new Map<string, BoardRef>();
  const atsOnly = new Set<AtsKind>();
  const senderRoots = new Set<string>();

  for (const email of emails) {
    const domain = senderDomain(email.from);
    if (domain) {
      const ats = SENDER_ATS.find(([re]) => re.test(domain))?.[1];
      if (ats) atsOnly.add(ats);
      else if (!NON_COMPANY_DOMAIN_RE.test(domain)) {
        const root = domainRoot(domain);
        if (root) senderRoots.add(root);
      }
    }
    for (const link of email.links) {
      const board = boardFromUrl(link);
      if (!board) continue;
      if (board.slug) boards.set(boardKey(board as BoardRef), board as BoardRef);
      else atsOnly.add(board.ats);
    }
  }
  for (const b of boards.values()) atsOnly.delete(b.ats);
  return { boards: [...boards.values()], atsOnly: [...atsOnly], senderRoots: [...senderRoots] };
};
