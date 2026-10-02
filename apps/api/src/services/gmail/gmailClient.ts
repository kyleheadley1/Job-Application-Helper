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

const gmailFetch = async <T>(path: string): Promise<T> => {
  const token = await gmailAuth.getAccessToken();
  const response = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) {
    await gmailAuth.markNeedsReconnect();
    throw new GmailReconnectRequiredError();
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gmail API request failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return (await response.json()) as T;
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

  async getMessage(id: string, maxBodyChars = MAX_BODY_CHARS): Promise<ParsedEmail> {
    const raw = await gmailFetch<GmailRawMessage>(
      `/messages/${encodeURIComponent(id)}?format=full`,
    );
    return parseGmailMessage(raw, maxBodyChars);
  },
};
