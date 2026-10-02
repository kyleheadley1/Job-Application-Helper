import { describe, expect, it } from "vitest";
import { buildSearchQuery, prefilterEmail } from "../../services/gmail/gmailClassifier.js";
import {
  decodeBase64Url,
  extractBodyText,
  MAX_BODY_CHARS,
  parseGmailMessage,
  type GmailRawMessage,
} from "../../services/gmail/gmailClient.js";

const b64url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

const email = (over: Partial<{ from: string; subject: string; snippet: string; body: string }>) => ({
  from: "someone@example.com",
  subject: "",
  snippet: "",
  body: "",
  ...over,
});

describe("prefilterEmail", () => {
  it("keeps ATS sender mail", () => {
    expect(
      prefilterEmail(email({ from: "Acme <no-reply@us.greenhouse-mail.io>", subject: "Update from Acme" })),
    ).toEqual({ keep: true, reason: "ats_sender" });
  });

  it("keeps application phrases from company domains", () => {
    expect(
      prefilterEmail(
        email({
          from: "careers@acme.com",
          subject: "Thank you for applying to Acme",
          body: "We've received your application for Software Engineer.",
        }),
      ),
    ).toEqual({ keep: true, reason: "application_phrase" });
  });

  it("keeps rejection wording", () => {
    expect(
      prefilterEmail(
        email({
          from: "talent@acme.com",
          subject: "Your application to Acme",
          body: "Unfortunately, we have decided to move forward with other candidates.",
        }),
      ).keep,
    ).toBe(true);
  });

  it("drops job alerts even from ATS/job-board senders", () => {
    expect(
      prefilterEmail(
        email({ from: "jobalerts-noreply@linkedin.com", subject: "New jobs for you: Software Engineer" }),
      ),
    ).toEqual({ keep: false, reason: "job_alert_or_newsletter" });
  });

  it("drops ATS marketing without an application phrase", () => {
    expect(
      prefilterEmail(
        email({
          from: "news@linkedin.com",
          subject: "Your week on LinkedIn",
          body: "See who viewed your profile and people also viewed.",
        }),
      ),
    ).toEqual({ keep: false, reason: "ats_marketing" });
  });

  it("drops unrelated mail", () => {
    expect(
      prefilterEmail(email({ from: "friend@gmail.com", subject: "Dinner Friday?", body: "Want to grab food?" })),
    ).toEqual({ keep: false, reason: "no_application_signal" });
  });

  it("keeps calendar invites from company domains but not from personal addresses", () => {
    const subject = "Invitation: Jane Doe and Alex Smith @ Mon Sep 28, 2026 3pm - 3:30pm (EDT)";
    expect(prefilterEmail(email({ from: "Rush Moody <rush@sesolabor.com>", subject }))).toEqual({
      keep: true,
      reason: "calendar_invite",
    });
    expect(prefilterEmail(email({ from: "friend@gmail.com", subject: "Invitation: Dinner @ Fri 7pm" }))).toEqual({
      keep: false,
      reason: "no_application_signal",
    });
  });

  it("keeps invites Gmail relabels for new senders, and updated invites", () => {
    const from = "Lauren Stein <lauren@axle.insure>";
    for (const subject of [
      "Invitation from an unknown sender: Interview with Axle @ Tue Oct 6, 2026 10:45am - 11am (EDT) (jane@gmail.com)",
      "Updated invitation from an unknown sender: Interview with Axle @ Tue Oct 6, 2026 11am - 11:15am (EDT)",
      "Updated invitation with note: Interview with Axle @ Tue Oct 6, 2026",
    ]) {
      expect(prefilterEmail(email({ from, subject }))).toEqual({ keep: true, reason: "calendar_invite" });
    }
    expect(prefilterEmail(email({ from, subject: "Accepted: Interview with Axle @ Tue Oct 6" })).keep).toBe(false);
  });
});

describe("buildSearchQuery", () => {
  it("bounds by the requested window", () => {
    expect(buildSearchQuery(7)).toMatch(/^newer_than:7d /);
  });
});

describe("Gmail body decoding", () => {
  it("decodes base64url including url-safe characters", () => {
    const text = "Role: Engineer ~ ü?>>";
    expect(decodeBase64Url(b64url(text))).toBe(text);
  });

  it("prefers text/plain in multipart messages", () => {
    const body = extractBodyText({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("Plain version") } },
        { mimeType: "text/html", body: { data: b64url("<p>HTML version</p>") } },
      ],
    });
    expect(body).toBe("Plain version");
  });

  it("falls back to stripped HTML when no text part exists", () => {
    const body = extractBodyText({
      mimeType: "text/html",
      body: {
        data: b64url(
          "<html><head><style>.x{color:red}</style></head><body><p>Thanks for applying&nbsp;to <b>Acme</b></p></body></html>",
        ),
      },
    });
    expect(body).toContain("Thanks for applying to Acme");
    expect(body).not.toContain("<");
    expect(body).not.toContain("color:red");
  });

  it("parses headers, date, and truncates long bodies", () => {
    const raw: GmailRawMessage = {
      id: "m1",
      threadId: "t1",
      internalDate: String(Date.UTC(2026, 8, 28, 12, 0, 0)),
      snippet: "snippet",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: "Acme <jobs@acme.com>" },
          { name: "Subject", value: "Application received" },
        ],
        body: { data: b64url("x".repeat(MAX_BODY_CHARS + 500)) },
      },
    };
    const parsed = parseGmailMessage(raw);
    expect(parsed).toMatchObject({
      id: "m1",
      threadId: "t1",
      from: "Acme <jobs@acme.com>",
      subject: "Application received",
      date: "2026-09-28T12:00:00.000Z",
    });
    expect(parsed.body.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
  });
});
