import { gmailAuth, GmailReconnectRequiredError } from "./gmailAuth.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
export const MAX_MESSAGES_PER_SYNC = 200;
export const MAX_BODY_CHARS = 4000;

export type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
};

export type GmailRawMessage = {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailMessagePart;
};

export type ParsedEmail = {
  id: string;
  threadId: string;
  /** ISO timestamp from Gmail's internalDate (when the message was received). */
  date: string;
  from: string;
  subject: string;
  snippet: string;
  body: string;
  /** Unique http(s) URLs from HTML hrefs and bare URLs in the text body. */
  links: string[];
};

export const MAX_LINKS = 200;

export const decodeBase64Url = (data: string): string =>
  Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

const ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

export const htmlToPlainText = (html: string): string =>
  html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITY_MAP[m.toLowerCase()] ?? " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const findPart = (part: GmailMessagePart | undefined, mimeType: string): GmailMessagePart | null => {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data && !part.filename) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
};

/** Prefer text/plain; fall back to stripped text/html. */
export const extractBodyText = (payload: GmailMessagePart | undefined): string => {
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return decodeBase64Url(plain.body.data).trim();
  const html = findPart(payload, "text/html");
  if (html?.body?.data) return htmlToPlainText(decodeBase64Url(html.body.data));
  return "";
};

export const extractHtml = (payload: GmailMessagePart | undefined): string => {
  const html = findPart(payload, "text/html");
  return html?.body?.data ? decodeBase64Url(html.body.data) : "";
};

const HREF_RE = /href\s*=\s*["']([^"']+)["']/gi;
const BARE_URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

const decodeHrefEntities = (href: string): string =>
  href.replace(/&amp;/gi, "&").replace(/&#x2F;/gi, "/").replace(/&#47;/g, "/").trim();

export const extractLinks = (payload: GmailMessagePart | undefined): string[] => {
  const out = new Set<string>();
  const html = findPart(payload, "text/html");
  if (html?.body?.data) {
    for (const m of decodeBase64Url(html.body.data).matchAll(HREF_RE)) {
      const href = decodeHrefEntities(m[1]!);
      if (/^https?:\/\//i.test(href)) out.add(href);
    }
  }
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) {
    for (const m of decodeBase64Url(plain.body.data).matchAll(BARE_URL_RE)) {
      out.add(m[0].replace(/[.,;:!?]+$/, ""));
    }
  }
  return [...out].slice(0, MAX_LINKS);
};

const header = (payload: GmailMessagePart | undefined, name: string): string =>
  payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

export const parseGmailMessage = (raw: GmailRawMessage, maxBodyChars = MAX_BODY_CHARS): ParsedEmail => {
  const ms = Number(raw.internalDate ?? Date.now());
  const body = extractBodyText(raw.payload).replace(/\r\n/g, "\n");
  return {
    id: raw.id,
    threadId: raw.threadId,
    date: new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString(),
    from: header(raw.payload, "From"),
    subject: header(raw.payload, "Subject"),
    snippet: raw.snippet ?? "",
    body: body.length > maxBodyChars ? body.slice(0, maxBodyChars) : body,
    links: extractLinks(raw.payload),
  };
};

/** Gmail's per-user, per-minute quota is still exhausted after backing off. */
export class GmailRateLimitError extends Error {
  readonly code = "GMAIL_RATE_LIMITED" as const;
  constructor() {
    super("Gmail's per-minute request limit was hit. Remaining emails will be picked up on the next sync.");
    this.name = "GmailRateLimitError";
  }
}

export const isRateLimitResponse = (status: number, body: string): boolean =>
  status === 429 || (status === 403 && /rateLimitExceeded|userRateLimitExceeded|quota exceeded/i.test(body));

/** Waits between retries; Gmail's quota window is one minute, so the total spans about that. */
export const RATE_LIMIT_BACKOFF_MS = [2_000, 8_000, 20_000, 35_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const gmailFetch = async <T>(path: string): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    const token = await gmailAuth.getAccessToken();
    const response = await fetch(`${GMAIL_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      await gmailAuth.markNeedsReconnect();
      throw new GmailReconnectRequiredError();
    }
    if (response.ok) return (await response.json()) as T;
    const text = await response.text().catch(() => "");
    if (isRateLimitResponse(response.status, text)) {
      const wait = RATE_LIMIT_BACKOFF_MS[attempt];
      if (wait === undefined) throw new GmailRateLimitError();
      const retryAfter = Number(response.headers.get("retry-after")) * 1000;
      await sleep(Math.max(wait, Number.isFinite(retryAfter) ? retryAfter : 0) + Math.random() * 500);
      continue;
    }
    throw new Error(`Gmail API request failed (${response.status}): ${text.slice(0, 300)}`);
  }
};

export const gmailClient = {
  async listMessageIds(query: string, max = MAX_MESSAGES_PER_SYNC): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: query,
        maxResults: String(Math.min(100, max - ids.length)),
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await gmailFetch<{
        messages?: Array<{ id: string }>;
        nextPageToken?: string;
      }>(`/messages?${params.toString()}`);
      for (const m of page.messages ?? []) ids.push(m.id);
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < max);
    return ids.slice(0, max);
  },

  /** Message ids, dates, and labels in a thread (no bodies); used to spot the candidate's own replies. */
  async getThreadMessages(threadId: string): Promise<Array<{ id: string; date: string; sent: boolean }>> {
    const thread = await gmailFetch<{ messages?: GmailRawMessage[] }>(
      `/threads/${encodeURIComponent(threadId)}?format=minimal`,
    );
    return (thread.messages ?? []).map((m) => ({
      id: m.id,
      date: new Date(Number(m.internalDate ?? 0)).toISOString(),
      sent: (m.labelIds ?? []).includes("SENT"),
    }));
  },

  async getRawMessage(id: string): Promise<GmailRawMessage> {
    return gmailFetch<GmailRawMessage>(`/messages/${encodeURIComponent(id)}?format=full`);
  },

  async getMessage(id: string, maxBodyChars = MAX_BODY_CHARS): Promise<ParsedEmail> {
    return parseGmailMessage(await this.getRawMessage(id), maxBodyChars);
  },
};
