import { describe, expect, it, vi } from "vitest";

const createDraft = vi.fn(async (_raw: string, threadId?: string) => ({ draftId: "d1", threadId: threadId ?? "" }));
const insertOne = vi.fn(async () => ({}));

vi.mock("../../services/gmail/gmailClient.js", async (orig) => {
  const actual = (await orig()) as { gmailClient: Record<string, unknown> };
  return { ...actual, gmailClient: { ...actual.gmailClient, createDraft } };
});
vi.mock("../../config/mongo.js", () => ({ getDb: async () => ({ collection: () => ({ insertOne }) }) }));

const { buildReplyRaw, createReplyDraft, InvalidRecipientError, isUnreplyable, pickReplyEmail, toReplyTarget } =
  await import("../../services/gmail/replyDraft.js");
const { gmailClient } = await import("../../services/gmail/gmailClient.js");
import type { GmailApplication } from "../../services/gmail/gmailApplications.js";

const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

const headers = (over = {}) => ({
  threadId: "t1",
  from: "Jane Recruiter <jane@acme.com>",
  replyTo: "",
  subject: "Interview next steps",
  messageId: "<abc@acme.com>",
  references: "<root@acme.com>",
  ...over,
});

describe("reply drafts", () => {
  it("threads the reply: Re: subject, In-Reply-To, and References chain", () => {
    const target = toReplyTarget("m1", headers());
    expect(target).toMatchObject({
      to: "jane@acme.com",
      subject: "Re: Interview next steps",
      inReplyTo: "<abc@acme.com>",
      references: "<root@acme.com> <abc@acme.com>",
      threadId: "t1",
    });
    const raw = decode(buildReplyRaw({ ...target, body: "Thanks!\nBest," }));
    expect(raw).toContain("To: jane@acme.com\r\n");
    expect(raw).toContain("In-Reply-To: <abc@acme.com>\r\n");
    expect(raw).toContain("References: <root@acme.com> <abc@acme.com>\r\n");
    expect(raw).toMatch(/\r\n\r\nThanks!\r\nBest,$/);
  });

  it("leaves the recipient empty for ATS and no-reply senders, preferring a human Reply-To", () => {
    expect(toReplyTarget("m", headers({ from: "Greenhouse <no-reply@greenhouse.io>" })).to).toBe("");
    expect(
      toReplyTarget("m", headers({ from: "no-reply@us.greenhouse-mail.io", replyTo: "Sam <sam@acme.com>" })).to,
    ).toBe("sam@acme.com");
    expect(isUnreplyable("notifications@lever.co")).toBe(true);
    expect(isUnreplyable("jane@acme.com")).toBe(false);
  });

  it("replies to the pinned email's thread, else the newest email from a person", () => {
    const app = {
      emails: [
        { id: "new-ats", from: "no-reply@myworkday.com" },
        { id: "human", from: "Jane <jane@acme.com>" },
      ],
    } as unknown as GmailApplication;
    expect(pickReplyEmail(app)).toBe("human");
    expect(pickReplyEmail(app, "new-ats")).toBe("new-ats");
    expect(pickReplyEmail(app, "unknown")).toBe("human");
  });

  it("creates the draft in the thread with the approved text and logs it", async () => {
    const entry = await createReplyDraft({
      target: toReplyTarget("m1", headers()),
      to: " Jane@Acme.com ",
      body: "Thank you for your time today.",
      log: { source: "next_steps", sourceId: "s1", kind: "thank_you", appKey: "acme::se" },
    });
    expect(createDraft).toHaveBeenCalledWith(expect.any(String), "t1");
    expect(decode(createDraft.mock.calls[0]![0])).toContain("Thank you for your time today.");
    expect(entry).toMatchObject({ to: "jane@acme.com", draftId: "d1", threadId: "t1" });
    expect(insertOne).toHaveBeenCalledTimes(1);
  });

  it("refuses invalid or no-reply recipients and empty drafts", async () => {
    const base = { target: toReplyTarget("m1", headers()), log: { source: "next_steps" as const, sourceId: "s", kind: "k", appKey: "a" } };
    await expect(createReplyDraft({ ...base, to: "not-an-email", body: "x" })).rejects.toBeInstanceOf(InvalidRecipientError);
    await expect(createReplyDraft({ ...base, to: "no-reply@acme.com", body: "x" })).rejects.toBeInstanceOf(InvalidRecipientError);
    await expect(createReplyDraft({ ...base, to: "a@b.com, c@d.com", body: "x" })).rejects.toBeInstanceOf(InvalidRecipientError);
    await expect(createReplyDraft({ ...base, to: "jane@acme.com", body: "  " })).rejects.toBeInstanceOf(InvalidRecipientError);
  });

  it("has no way to send mail", () => {
    expect(Object.keys(gmailClient).filter((k) => /send/i.test(k))).toEqual([]);
  });
});
