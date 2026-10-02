import { appliedAtIso } from "../../lib/trackerAutoArchive.js";
import type { JobRecord, JobStatus } from "../../types/job.js";
import { jobsRepository } from "../jobs/jobs.repository.js";
import { isAtsSender, isFreemailSender, type EmailEventType } from "./gmailClassifier.js";
import { gmailMessagesRepository, type StoredGmailMessage } from "./gmailMessages.repository.js";
import { buildInterviewRounds, type InterviewRound } from "./interviewRounds.js";

export type ApplicationStatus = "applied" | "assessment" | "interviewing" | "rejected" | "offer";

export type AppliedAtSource = "email" | "tracker" | "estimated";

export type ApplicationEmail = {
  id: string;
  subject: string;
  from: string;
  date: string;
  eventType: EmailEventType;
  gmailUrl: string;
  /** Interview round this email belongs to. */
  round?: number;
};

export type GmailApplication = {
  key: string;
  company: string;
  role: string | null;
  /**
   * First "applied" email, else the tracker's applied date, else the earliest email (the application
   * happened on or before it). Later status emails only move lastUpdateAt.
   */
  appliedAt: string;
  appliedAtKnown: boolean;
  appliedAtSource: AppliedAtSource;
  status: ApplicationStatus;
  /** Most advanced stage reached, ignoring a later rejection (interview → rejected stays "interviewing"). */
  furthestStage: Exclude<ApplicationStatus, "rejected">;
  /** Interview rounds in order; the last one is the furthest round reached. */
  interviewRounds: InterviewRound[];
  /** Still open with an upcoming interview or recent interview activity, as opposed to merely having interviewed. */
  activelyInterviewing: boolean;
  lastUpdateAt: string;
  emails: ApplicationEmail[];
  trackerJobId?: string;
  trackerStatus?: JobStatus;
  trackerTitle?: string;
  suggestedStatus?: JobStatus;
};

const EVENT_TO_STATUS: Record<Exclude<EmailEventType, "other">, ApplicationStatus> = {
  applied: "applied",
  rejected: "rejected",
  interview: "interviewing",
  assessment: "assessment",
  offer: "offer",
};

const STAGE_RANK: Record<GmailApplication["furthestStage"], number> = {
  applied: 0,
  assessment: 1,
  interviewing: 2,
  offer: 3,
};

/** Same-timestamp tie-break: the more advanced/final event wins. */
const EVENT_WEIGHT: Record<EmailEventType, number> = {
  other: 0,
  applied: 1,
  assessment: 2,
  interview: 3,
  rejected: 4,
  offer: 5,
};

const COMPANY_SUFFIX_RE =
  /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|technologies|technology|labs|group|holdings|hq)\b\.?/g;

export const normalizeCompany = (name: string): string =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\(.*?\)/g, " ")
    .replace(COMPANY_SUFFIX_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const ROLE_STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "for", "to", "in", "at", "with", "on", "i", "ii", "iii", "1", "2", "3",
  "remote", "hybrid", "onsite", "us", "usa", "new", "grad", "position", "role",
]);

const ROLE_SYNONYMS: Record<string, string> = {
  sr: "senior",
  jr: "junior",
  swe: "software engineer",
  sde: "software development engineer",
  dev: "developer",
  eng: "engineer",
  fullstack: "full stack",
  "full-stack": "full stack",
};

export const roleTokens = (role: string): string[] => {
  const expanded = role
    .toLowerCase()
    .replace(/[^a-z0-9+#\- ]+/g, " ")
    .split(/\s+/)
    .map((t) => ROLE_SYNONYMS[t] ?? t)
    .join(" ")
    .replace(/-/g, " ");
  return [...new Set(expanded.split(/\s+/).filter((t) => t && !ROLE_STOPWORDS.has(t)))];
};

export const roleSimilarity = (a: string, b: string): number => {
  const ta = new Set(roleTokens(a));
  const tb = new Set(roleTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.min(ta.size, tb.size);
};

const ROLE_MATCH_THRESHOLD = 0.6;

const gmailUrl = (threadId: string) => `https://mail.google.com/mail/u/0/#all/${threadId}`;

type Group = {
  companyKey: string;
  company: string;
  role: string | null;
  messages: StoredGmailMessage[];
};

type CompanyBucket = { company: string; roled: Group[]; unroled: StoredGmailMessage[] };

const wordPrefix = (short: string, long: string) => long.startsWith(`${short} `);

/**
 * Role-less mail (calendar invites, recruiter notes) often names the company differently
 * ("Seso Labor" vs "Seso"). Fold such a bucket into the one other company it is a word-prefix variant of.
 */
const mergeRoleLessVariants = (byCompany: Map<string, CompanyBucket>) => {
  for (const [key, bucket] of [...byCompany]) {
    if (bucket.roled.length > 0) continue;
    const targets = [...byCompany.keys()].filter(
      (other) => other !== key && byCompany.get(other)!.roled.length > 0 && (wordPrefix(other, key) || wordPrefix(key, other)),
    );
    if (targets.length !== 1) continue;
    byCompany.get(targets[0]!)!.unroled.push(...bucket.unroled);
    byCompany.delete(key);
  }
};

const SENDER_DOMAIN_RE = /@([a-z0-9.-]+\.[a-z]{2,})\s*>?\s*$/i;

/** The employer's own mail domain, or null for ATS vendors and personal mail. */
export const companySenderDomain = (from: string): string | null => {
  if (isAtsSender(from) || isFreemailSender(from)) return null;
  return from.match(SENDER_DOMAIN_RE)?.[1]?.toLowerCase() ?? null;
};

const bucketDomains = (bucket: CompanyBucket): Set<string> => {
  const domains = new Set<string>();
  for (const m of [...bucket.unroled, ...bucket.roled.flatMap((g) => g.messages)]) {
    const d = companySenderDomain(m.from);
    if (d) domains.add(d);
  }
  return domains;
};

/**
 * The classifier sometimes names the company from the sender domain ("SesolaBor" for sesolabor.com).
 * Fold a role-less bucket into the one other company that has mail from the same domain.
 */
const mergeRoleLessBySenderDomain = (byCompany: Map<string, CompanyBucket>) => {
  for (const [key, bucket] of [...byCompany]) {
    if (bucket.roled.length > 0) continue;
    const domains = bucketDomains(bucket);
    if (domains.size === 0) continue;
    const targets = [...byCompany.keys()].filter(
      (other) => other !== key && [...bucketDomains(byCompany.get(other)!)].some((d) => domains.has(d)),
    );
    if (targets.length !== 1) continue;
    byCompany.get(targets[0]!)!.unroled.push(...bucket.unroled);
    byCompany.delete(key);
  }
};

const groupMessages = (messages: StoredGmailMessage[]): Group[] => {
  const byCompany = new Map<string, CompanyBucket>();
  for (const m of messages) {
    const c = m.classification;
    if (!c?.isApplicationEmail || !c.company) continue;
    const companyKey = normalizeCompany(c.company);
    if (!companyKey) continue;
    const bucket = byCompany.get(companyKey) ?? { company: c.company, roled: [], unroled: [] };
    byCompany.set(companyKey, bucket);
    if (!c.role) {
      bucket.unroled.push(m);
      continue;
    }
    const existing = bucket.roled.find(
      (g) => g.role && roleSimilarity(g.role, c.role!) >= ROLE_MATCH_THRESHOLD,
    );
    if (existing) existing.messages.push(m);
    else bucket.roled.push({ companyKey, company: c.company, role: c.role, messages: [m] });
  }

  mergeRoleLessVariants(byCompany);
  mergeRoleLessBySenderDomain(byCompany);

  const groups: Group[] = [];
  for (const [companyKey, bucket] of byCompany) {
    if (bucket.unroled.length > 0) {
      if (bucket.roled.length === 1) bucket.roled[0]!.messages.push(...bucket.unroled);
      else groups.push({ companyKey, company: bucket.company, role: null, messages: bucket.unroled });
    }
    groups.push(...bucket.roled);
  }
  return groups;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** With no upcoming interview, interview activity this recent still counts as an active process. */
const ACTIVE_INTERVIEW_DAYS = 21;
const CLOSED: ApplicationStatus[] = ["rejected", "offer"];

const isActivelyInterviewing = (status: ApplicationStatus, rounds: InterviewRound[], now: number): boolean => {
  const last = rounds[rounds.length - 1];
  if (!last || CLOSED.includes(status)) return false;
  if (last.scheduledAt && !last.cancelled && Date.parse(last.scheduledAt) > now) return true;
  const lastActivity = Math.max(Date.parse(last.lastEmailAt), last.scheduledAt ? Date.parse(last.scheduledAt) : 0);
  return now - lastActivity <= ACTIVE_INTERVIEW_DAYS * DAY_MS;
};

const toApplication = (
  group: Group,
  now: number,
): Omit<GmailApplication, "trackerJobId" | "trackerStatus" | "trackerTitle" | "suggestedStatus"> => {
  const sorted = [...group.messages].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      EVENT_WEIGHT[a.classification!.eventType] - EVENT_WEIGHT[b.classification!.eventType],
  );
  const firstApplied = sorted.find((m) => m.classification!.eventType === "applied");
  const statusEvents = sorted.filter((m) => m.classification!.eventType !== "other");
  const latest = statusEvents[statusEvents.length - 1];
  const status: ApplicationStatus = latest
    ? EVENT_TO_STATUS[latest.classification!.eventType as Exclude<EmailEventType, "other">]
    : "applied";
  const furthestStage = statusEvents.reduce<GmailApplication["furthestStage"]>((best, m) => {
    const s = EVENT_TO_STATUS[m.classification!.eventType as Exclude<EmailEventType, "other">];
    return s !== "rejected" && STAGE_RANK[s] > STAGE_RANK[best] ? s : best;
  }, "applied");
  const interviewRounds = buildInterviewRounds(sorted.filter((m) => m.classification!.eventType === "interview"));
  const roundByEmail = new Map(interviewRounds.flatMap((r) => r.emailIds.map((id) => [id, r.number] as const)));
  return {
    key: `${group.companyKey}::${group.role ? roleTokens(group.role).join(" ") : ""}`,
    company: group.company,
    role: group.role,
    appliedAt: (firstApplied ?? sorted[0]!).date,
    appliedAtKnown: Boolean(firstApplied),
    appliedAtSource: firstApplied ? "email" : "estimated",
    status,
    furthestStage,
    interviewRounds,
    activelyInterviewing: isActivelyInterviewing(status, interviewRounds, now),
    lastUpdateAt: sorted[sorted.length - 1]!.date,
    emails: sorted
      .map((m) => ({
        id: m.id,
        subject: m.subject,
        from: m.from,
        date: m.date,
        eventType: m.classification!.eventType,
        gmailUrl: gmailUrl(m.threadId),
        ...(roundByEmail.has(m.id) ? { round: roundByEmail.get(m.id) } : {}),
      }))
      .reverse(),
  };
};

const STATUS_TO_JOB_STATUS: Record<ApplicationStatus, JobStatus> = {
  applied: "applied",
  assessment: "assessment",
  interviewing: "interviewing",
  rejected: "rejected",
  offer: "offer",
};

const PIPELINE_RANK: Partial<Record<JobStatus, number>> = {
  to_review: 0,
  skip: 0,
  lapsed: 1,
  applied: 1,
  assessment: 2,
  interviewing: 3,
};
const TERMINAL: JobStatus[] = ["rejected", "closed", "offer"];

/** Suggest a tracker change only when the email moves the role forward (or ends it). */
export const suggestTrackerStatus = (
  trackerStatus: JobStatus,
  emailStatus: ApplicationStatus,
): JobStatus | undefined => {
  const suggested = STATUS_TO_JOB_STATUS[emailStatus];
  if (suggested === trackerStatus || TERMINAL.includes(trackerStatus)) return undefined;
  if (suggested === "rejected" || suggested === "offer") return suggested;
  const from = PIPELINE_RANK[trackerStatus] ?? 0;
  const to = PIPELINE_RANK[suggested] ?? 0;
  return to > from ? suggested : undefined;
};

const trackerCompany = (job: JobRecord): string =>
  normalizeCompany(job.extracted.companyDisplayName || job.extracted.company || "");

export const matchTrackerJob = (
  app: Pick<GmailApplication, "company" | "role">,
  jobs: JobRecord[],
): JobRecord | undefined => {
  const companyKey = normalizeCompany(app.company);
  const candidates = jobs.filter((j) => trackerCompany(j) === companyKey);
  if (candidates.length === 0) return undefined;
  if (!app.role) return candidates.length === 1 ? candidates[0] : undefined;
  let best: { job: JobRecord; score: number } | undefined;
  for (const job of candidates) {
    const score = roleSimilarity(app.role, job.extracted.title ?? "");
    if (
      score >= ROLE_MATCH_THRESHOLD &&
      (!best || score > best.score || (score === best.score && job.updatedAt > best.job.updatedAt))
    ) {
      best = { job, score };
    }
  }
  return best?.job;
};

/** Without a confirmation email, the tracker's applied date beats guessing from the first (often rejection) email. */
const trackerAppliedAt = (
  app: Pick<GmailApplication, "appliedAtSource" | "lastUpdateAt">,
  job: JobRecord,
): Pick<GmailApplication, "appliedAt" | "appliedAtKnown" | "appliedAtSource"> | undefined => {
  if (app.appliedAtSource !== "estimated") return undefined;
  const iso = appliedAtIso(job);
  if (!iso || Date.parse(iso) > Date.parse(app.lastUpdateAt)) return undefined;
  return { appliedAt: iso, appliedAtKnown: true, appliedAtSource: "tracker" };
};

export const buildApplications = (
  messages: StoredGmailMessage[],
  trackerJobs: JobRecord[],
  now = Date.now(),
): GmailApplication[] =>
  groupMessages(messages)
    .map((group) => {
      const app = toApplication(group, now);
      const match = matchTrackerJob(app, trackerJobs);
      if (!match) return app;
      return {
        ...app,
        ...trackerAppliedAt(app, match),
        trackerJobId: match.id,
        trackerStatus: match.status,
        trackerTitle: match.extracted.title,
        suggestedStatus: suggestTrackerStatus(match.status, app.status),
      };
    })
    .sort((a, b) => b.lastUpdateAt.localeCompare(a.lastUpdateAt));

export type UpcomingInterview = {
  key: string;
  company: string;
  role: string | null;
  roundNumber: number;
  label: string;
  scheduledAt: string;
  durationMinutes: number | null;
  gmailUrl?: string;
};

/** Invites can be sent weeks ahead, so look further back than the dashboard window. */
export const UPCOMING_LOOKBACK_DAYS = 60;
/** An interview stays listed until it should have ended. */
const DEFAULT_INTERVIEW_MINUTES = 60;

export const upcomingInterviews = (apps: GmailApplication[], now = Date.now()): UpcomingInterview[] =>
  apps
    .filter((app) => !CLOSED.includes(app.status))
    .flatMap((app) =>
      app.interviewRounds
        .filter(
          (r) =>
            r.scheduledAt &&
            !r.cancelled &&
            Date.parse(r.scheduledAt) + (r.durationMinutes ?? DEFAULT_INTERVIEW_MINUTES) * 60_000 > now,
        )
        .map((r) => {
          const lastEmailId = r.emailIds[r.emailIds.length - 1];
          return {
            key: app.key,
            company: app.company,
            role: app.role,
            roundNumber: r.number,
            label: r.label,
            scheduledAt: r.scheduledAt!,
            durationMinutes: r.durationMinutes,
            gmailUrl: app.emails.find((e) => e.id === lastEmailId)?.gmailUrl,
          };
        }),
    )
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

export const getUpcomingInterviews = async (): Promise<UpcomingInterview[]> =>
  upcomingInterviews(await getGmailApplications(UPCOMING_LOOKBACK_DAYS));

export const getGmailApplications = async (days: number): Promise<GmailApplication[]> => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const [messages, jobs] = await Promise.all([
    gmailMessagesRepository.listApplicationMessagesSince(since),
    jobsRepository.findAll(),
  ]);
  return buildApplications(messages, jobs);
};
