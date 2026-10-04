import { getDb } from "../../config/mongo.js";
import { isAtsSender } from "./gmailClassifier.js";
import { gmailClient, type ReplyHeaders } from "./gmailClient.js";
import type { GmailApplication } from "./gmailApplications.js";

const NO_REPLY_RE = /\bno[-_.]?reply\b|\bdo[-_.]?not[-_.]?reply\b|\bnotifications?@|\bmailer-daemon\b/i;
const ADDRESS_RE = /<([^>]+)>|([^\s<>,;]+@[^\s<>,;]+)/;

export const emailAddress = (header: string): string | null => {
  const m = header.match(ADDRESS_RE);
  return (m?.[1] ?? m?.[2] ?? "").trim().toLowerCase() || null;
};

/** ATS systems and no-reply senders can't receive a reply, so you have to enter a person's address. */
export const isUnreplyable = (header: string): boolean => NO_REPLY_RE.test(header) || isAtsSender(header);

export type ReplyTarget = {
  emailId: string;
  threadId: string;
  /** Empty when the thread only has automated senders; you fill it in before creating the draft. */
  to: string;
  subject: string;
  inReplyTo: string;
  references: string;
};

/**
 * The newest email in the application that came from a person, else the newest email at all.
 * `preferEmailId` pins the thread (the request being answered, the interview being thanked for).
 */
export const pickReplyEmail = (app: GmailApplication, preferEmailId?: string): string | undefined => {
  if (preferEmailId && app.emails.some((e) => e.id === preferEmailId)) return preferEmailId;
  return (app.emails.find((e) => !isUnreplyable(e.from)) ?? app.emails[0])?.id;
};

export const toReplyTarget = (emailId: string, h: ReplyHeaders): ReplyTarget => {
  const replyTo = h.replyTo && !isUnreplyable(h.replyTo) ? h.replyTo : "";
  const from = h.from && !isUnreplyable(h.from) ? h.from : "";
  const subject = h.subject.trim();
  return {
    emailId,
    threadId: h.threadId,
    to: emailAddress(replyTo || from) ?? "",
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject || "Following up"}`,
    inReplyTo: h.messageId,
    references: [h.references, h.messageId].filter(Boolean).join(" ").trim(),
  };
};

export const resolveReplyTarget = async (app: GmailApplication, preferEmailId?: string): Promise<ReplyTarget> => {
  const emailId = pickReplyEmail(app, preferEmailId);
  if (!emailId) throw new Error(`No emails found for ${app.company}`);
  return toReplyTarget(emailId, await gmailClient.getReplyHeaders(emailId));
};

const encodeHeader = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

/** RFC 2822 plain-text reply, base64url-encoded for the Gmail API. */
export const buildReplyRaw = (input: { to: string; subject: string; inReplyTo?: string; references?: string; body: string }) => {
  const headers = [
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
    ...(input.references ? [`References: ${input.references}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${input.body.replace(/\r?\n/g, "\r\n")}`, "utf8").toString(
    "base64url",
  );
};

const VALID_TO_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export class InvalidRecipientError extends Error {}

export type OutboxEntry = {
  at: string;
  source: "next_steps" | "assistant";
  sourceId: string;
  kind: string;
  appKey: string;
  to: string;
  threadId: string;
  draftId: string;
};

/** Creates a reply draft in the application's thread with exactly the text you approved; never sends. */
export const createReplyDraft = async (input: {
  target: ReplyTarget;
  to: string;
  body: string;
  log: Omit<OutboxEntry, "at" | "to" | "threadId" | "draftId">;
}): Promise<OutboxEntry> => {
  const to = input.to.trim().toLowerCase();
  if (!VALID_TO_RE.test(to)) throw new InvalidRecipientError("Enter one valid email address to reply to.");
  if (isUnreplyable(to)) throw new InvalidRecipientError("That address doesn't accept replies; use a person's email.");
  if (!input.body.trim()) throw new InvalidRecipientError("The draft is empty.");
  const raw = buildReplyRaw({
    to,
    subject: input.target.subject,
    inReplyTo: input.target.inReplyTo,
    references: input.target.references,
    body: input.body.trim(),
  });
  const { draftId, threadId } = await gmailClient.createDraft(raw, input.target.threadId);
  const entry: OutboxEntry = { ...input.log, at: new Date().toISOString(), to, threadId, draftId };
  const db = await getDb();
  await db.collection<OutboxEntry>("gmail_outbox").insertOne({ ...entry });
  return entry;
};

export const GMAIL_DRAFTS_URL = "https://mail.google.com/mail/u/0/#drafts";
