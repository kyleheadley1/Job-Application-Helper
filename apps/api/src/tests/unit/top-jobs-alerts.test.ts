import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GmailRawMessage } from "../../services/gmail/gmailClient.js";

const runStructuredMock = vi.fn();
const rawInbox = new Map<string, GmailRawMessage>();
const processed = new Set<string>();
const upserted: unknown[] = [];
const marked: Array<{ _id: string; listings: number }> = [];

vi.mock("../../services/llm/responsesClient.js", () => ({
  responsesClient: { runStructured: (...args: unknown[]) => runStructuredMock(...args) },
}));

vi.mock("../../services/gmail/gmailClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/gmail/gmailClient.js")>();
  return {
    ...actual,
    gmailClient: {
      listMessageIds: vi.fn(async () => [...rawInbox.keys()]),
      getRawMessage: vi.fn(async (id: string) => rawInbox.get(id)!),
    },
  };
});

vi.mock("../../services/topJobs/alertListings.repository.js", () => ({
  alertListingsRepository: {
    processedMessageIds: vi.fn(async (ids: string[]) => new Set(ids.filter((id) => processed.has(id)))),
    markMessageProcessed: vi.fn(async (doc: { _id: string; listings: number }) => {
      processed.add(doc._id);
      marked.push(doc);
    }),
    upsertListing: vi.fn(async (l: unknown) => {
      upserted.push(l);
    }),
  },
}));

const {
  alertPlatform,
  buildAlertSearchQuery,
  extractAnchors,
  ingestAlertEmails,
  isLikelyAlert,
  listingKey,
  platformJobId,
  toAlertListings,
} = await import("../../services/topJobs/alertEmails.js");

const b64 = (s: string) => Buffer.from(s).toString("base64url");

const rawEmail = (id: string, from: string, subject: string, html: string): GmailRawMessage => ({
  id,
  threadId: `t-${id}`,
  internalDate: String(Date.parse("2026-10-01T12:00:00Z")),
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: from },
      { name: "Subject", value: subject },
    ],
    parts: [{ mimeType: "text/html", body: { data: b64(html) } }],
  },
});

const LINKEDIN_HTML = `
  <a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&amp;refId=x"><img src="logo.png"></a>
  <a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&amp;refId=x">Software Engineer</a>
  <a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&amp;refId=x">Acme · New York, NY</a>
  <a href="https://www.linkedin.com/comm/jobs/view/4098765432/">Full Stack Developer</a>
  <a href="https://www.linkedin.com/comm/jobs/unsubscribe?x=1">Unsubscribe</a>`;

describe("alert email parsing", () => {
  it("detects the platform from the sender", () => {
    expect(alertPlatform("LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>")).toBe("linkedin");
    expect(alertPlatform("Indeed <alert@indeed.com>")).toBe("indeed");
    expect(alertPlatform("Indeed <donotreply@match.indeedemail.com>")).toBe("indeed");
    expect(alertPlatform("ZipRecruiter <alerts@ziprecruiter.com>")).toBe("ziprecruiter");
    expect(alertPlatform("Remote Hunter <hello@mail.example.io>")).toBe("remotehunter");
    expect(alertPlatform("RemoteHunter <notifications@mail.remotehunter.com>")).toBe("remotehunter");
    expect(alertPlatform("Acme <no-reply@greenhouse.io>")).toBeNull();
  });

  it("builds a query over the alert senders that skips application confirmations", () => {
    const q = buildAlertSearchQuery(14);
    expect(q).toMatch(/^newer_than:14d /);
    expect(q).toContain("ziprecruiter.com");
    expect(q).toContain('-subject:("application was sent"');
  });

  it("pairs link text with the link, merging repeats and dropping image-only and blocked links", () => {
    const anchors = extractAnchors(LINKEDIN_HTML);
    expect(anchors).toHaveLength(2);
    expect(anchors[0]!.text).toBe("Software Engineer | Acme · New York, NY");
    expect(anchors[0]!.href).not.toContain("trackingId");
    expect(anchors.some((a) => /unsubscribe/i.test(a.href))).toBe(false);
  });

  it("unwraps redirect links", () => {
    const anchors = extractAnchors(
      `<a href="https://click.example.com/r?url=${encodeURIComponent("https://jobs.lever.co/acme/123")}">Backend Engineer</a>`,
    );
    expect(anchors[0]!.href).toBe("https://jobs.lever.co/acme/123");
  });

  it("gates on alert-shaped emails before spending an LLM call", () => {
    const from = "LinkedIn <jobalerts-noreply@linkedin.com>";
    expect(isLikelyAlert({ from, subject: "“software engineer”: Acme and 9 more new jobs" }, [])).toBe(true);
    expect(isLikelyAlert({ from, subject: "Kyle, your application was sent to Acme" }, [])).toBe(false);
    expect(
      isLikelyAlert(
        { from: "RemoteHunter <notifications@mail.remotehunter.com>", subject: "Kyle, Here Are Your Latest Remote Job Matches" },
        [],
      ),
    ).toBe(true);
    expect(isLikelyAlert({ from, subject: "Jane sent you a message" }, [])).toBe(false);
    const titles = ["Software Engineer", "Backend Developer", "Frontend Engineer"].map((text, i) => ({
      href: `https://x/${i}`,
      text,
    }));
    expect(isLikelyAlert({ from, subject: "Picked for Kyle" }, titles)).toBe(true);
    expect(isLikelyAlert({ from: "friend@gmail.com", subject: "New jobs for you" }, titles)).toBe(false);
  });

  it("reads platform job ids", () => {
    expect(platformJobId("https://www.linkedin.com/comm/jobs/view/4012345678", "linkedin")).toBe("4012345678");
    expect(platformJobId("https://www.indeed.com/rc/clk?jk=abc123&from=ja", "indeed")).toBe("abc123");
    expect(platformJobId("https://www.ziprecruiter.com/km/xyz", "ziprecruiter")).toBeUndefined();
  });

  it("maps LLM items to listings by link index, keyed by company and title", () => {
    const anchors = extractAnchors(LINKEDIN_HTML);
    const listings = toAlertListings(
      [
        { title: "Software Engineer", company: "Acme", location: "New York, NY", link: 0 },
        { title: "Software Engineer", company: "Acme Inc.", location: null, link: 0 },
        { title: "Full Stack Developer", company: "Beta", link: 1 },
        { title: "Platform Engineer", company: "Gamma", link: null },
        { title: "Unknown Title", company: "Delta", link: 1 },
      ],
      anchors,
      { id: "m1", date: "2026-10-01T12:00:00.000Z" },
      "linkedin",
    );
    expect(listings.map((l) => l.company)).toEqual(["Acme", "Beta", "Gamma"]);
    expect(listings[0]).toMatchObject({ externalId: "4012345678", key: listingKey("Acme", "Software Engineer") });
    expect(listings[2]).toMatchObject({ url: null, externalId: undefined });
    expect(listingKey("Acme, Inc.", "Engineer, Software")).toBe(listingKey("acme", "software engineer"));
  });
});

describe("ingestAlertEmails", () => {
  beforeEach(() => {
    rawInbox.clear();
    processed.clear();
    upserted.length = 0;
    marked.length = 0;
    runStructuredMock.mockReset();
  });

  it("parses each alert once, skips non-alerts without the LLM, and retries failed parses", async () => {
    rawInbox.set("a1", rawEmail("a1", "LinkedIn <jobalerts-noreply@linkedin.com>", "New jobs for you", LINKEDIN_HTML));
    rawInbox.set("n1", rawEmail("n1", "LinkedIn <messages-noreply@linkedin.com>", "Jane sent you a message", "<p>hi</p>"));
    runStructuredMock.mockResolvedValue({
      success: true,
      data: { jobs: [{ title: "Software Engineer", company: "Acme", location: "New York, NY", link: 0 }] },
    });

    const first = await ingestAlertEmails(14, 60);
    expect(first).toEqual({ alertEmails: 1, listingsParsed: 1, rateLimited: false });
    expect(runStructuredMock).toHaveBeenCalledTimes(1);
    expect(marked.map((m) => m._id).sort()).toEqual(["a1", "n1"]);

    const second = await ingestAlertEmails(14, 60);
    expect(second.alertEmails).toBe(0);
    expect(runStructuredMock).toHaveBeenCalledTimes(1);

    rawInbox.set("a2", rawEmail("a2", "Indeed <alert@indeed.com>", "Job alert: software engineer", "<a href='https://www.indeed.com/rc/clk?jk=1'>Software Engineer</a>"));
    runStructuredMock.mockResolvedValueOnce({ success: false, data: { jobs: [] } });
    await ingestAlertEmails(14, 60);
    expect(processed.has("a2")).toBe(false);
  });
});
