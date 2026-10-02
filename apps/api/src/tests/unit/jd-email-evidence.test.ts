import { describe, expect, it } from "vitest";
import { extractLinks, type GmailMessagePart } from "../../services/gmail/gmailClient.js";
import {
  cleanRoleTitle,
  collectEmailEvidence,
  extractInlineJd,
  extractJobLinks,
  extractRequisitionId,
  unwrapLink,
} from "../../services/gmail/jdRecovery/emailEvidence.js";

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("extractLinks", () => {
  it("collects HTML hrefs (entity-decoded) and bare URLs from text", () => {
    const payload: GmailMessagePart = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("See https://jobs.lever.co/acme/abc-123. Thanks") } },
        {
          mimeType: "text/html",
          body: { data: b64url('<a href="https://x.com/r?a=1&amp;b=2">x</a><a href="mailto:a@b.c">m</a>') },
        },
      ],
    };
    expect(extractLinks(payload).sort()).toEqual(["https://jobs.lever.co/acme/abc-123", "https://x.com/r?a=1&b=2"]);
  });
});

describe("extractJobLinks", () => {
  it("unwraps redirect wrappers and strips tracking params", () => {
    const wrapped = `https://click.mail.example.com/track?url=${encodeURIComponent(
      "https://boards.greenhouse.io/acme/jobs/4567890?gh_src=email&utm_source=x",
    )}`;
    expect(unwrapLink(wrapped)).toBe("https://boards.greenhouse.io/acme/jobs/4567890");
  });

  it("keeps ATS posting links and drops unsubscribe, privacy, and login links", () => {
    const links = extractJobLinks([
      "https://boards.greenhouse.io/acme/jobs/4567890",
      "https://job-boards.greenhouse.io/acme/jobs/111222",
      "https://jobs.lever.co/acme/0f8d1c2e-1111-2222-3333-444455556666",
      "https://uhg.wd1.myworkdayjobs.com/en-US/External/job/Eden-Prairie-MN/Associate-Software-Engineer_2389186",
      "https://www.linkedin.com/jobs/view/3912345678",
      "https://www.linkedin.com/feed/",
      "https://acme.com/unsubscribe?id=1",
      "https://acme.com/privacy",
      "https://uhg.wd1.myworkdayjobs.com/External/login",
      "https://acme.com/careers/jobs/98765",
      "https://acme.com/careers",
    ]);
    expect(links.map((l) => l.kind)).toEqual(["greenhouse", "greenhouse", "lever", "workday", "linkedin", "careers"]);
  });

  it("de-duplicates links that differ only by tracking params", () => {
    const links = extractJobLinks([
      "https://jobs.lever.co/acme/abc-1234?lever-source=email",
      "https://jobs.lever.co/acme/abc-1234",
    ]);
    expect(links).toHaveLength(1);
  });
});

describe("extractRequisitionId", () => {
  it("pulls UnitedHealth's bare number next to the title", () => {
    expect(extractRequisitionId("Thank you for applying: Associate Software Engineer (2389186)", "")).toBe("2389186");
  });

  it("handles labeled and prefixed IDs", () => {
    expect(extractRequisitionId("Application received", "Requisition ID: R-0123456")).toBe("R-0123456");
    expect(extractRequisitionId("Your application for JR104233", "")).toBe("JR104233");
    expect(extractRequisitionId("Job #: 55123 Software Engineer", "")).toBe("55123");
  });

  it("handles Cisco-style 'Req. 2000087' and a trailing subject number", () => {
    expect(extractRequisitionId("Software Engineer I (Req. 2000087)", "")).toBe("2000087");
    expect(extractRequisitionId("Your application: Associate Software Engineer, 2389186", "")).toBe("2389186");
  });

  it("returns undefined when there is no ID", () => {
    expect(extractRequisitionId("Thanks for applying to Acme", "We received your application.")).toBeUndefined();
    expect(extractRequisitionId("We require 5 years", "Requirements: 3+ years")).toBeUndefined();
  });
});

describe("cleanRoleTitle", () => {
  it("strips requisition noise from role titles", () => {
    expect(cleanRoleTitle("Software Engineer I (Req. 2000087)")).toBe("Software Engineer I");
    expect(cleanRoleTitle("Associate Software Engineer (2389186)")).toBe("Associate Software Engineer");
    expect(cleanRoleTitle("Backend Engineer - JR104233")).toBe("Backend Engineer");
    expect(cleanRoleTitle("Software Engineer II, Platform")).toBe("Software Engineer II, Platform");
    expect(cleanRoleTitle("Software Engineer - 2027 New Grads")).toBe("Software Engineer - 2027 New Grads");
  });
});

describe("extractInlineJd", () => {
  const filler = "Build and ship product features with a small team. ".repeat(30);
  it("accepts long bodies with JD headings", () => {
    expect(extractInlineJd(`About the role\n${filler}\nResponsibilities\n- ship\nQualifications\n- TS`)).toBeTruthy();
  });

  it("rejects short or heading-less bodies", () => {
    expect(extractInlineJd("Responsibilities\nQualifications\nshort")).toBeUndefined();
    expect(extractInlineJd(filler)).toBeUndefined();
  });
});

describe("collectEmailEvidence", () => {
  it("merges links and req IDs across an application's emails", () => {
    const evidence = collectEmailEvidence([
      {
        id: "a",
        threadId: "t",
        date: "2026-09-20T00:00:00.000Z",
        from: "",
        subject: "Associate Software Engineer (2389186)",
        snippet: "",
        body: "",
        links: [],
      },
      {
        id: "b",
        threadId: "t",
        date: "2026-09-25T00:00:00.000Z",
        from: "",
        subject: "Update",
        snippet: "",
        body: "",
        links: ["https://boards.greenhouse.io/acme/jobs/4567890"],
      },
    ]);
    expect(evidence.requisitionId).toBe("2389186");
    expect(evidence.jobLinks).toHaveLength(1);
    expect(evidence.inlineJd).toBeUndefined();
  });
});
