import { describe, expect, it } from "vitest";
import {
  buildApplications,
  matchTrackerJob,
  normalizeCompany,
  roleSimilarity,
  suggestTrackerStatus,
} from "../../services/gmail/gmailApplications.js";
import type { EmailEventType } from "../../services/gmail/gmailClassifier.js";
import type { StoredGmailMessage } from "../../services/gmail/gmailMessages.repository.js";
import type { JobRecord, JobStatus } from "../../types/job.js";

let seq = 0;
const msg = (
  company: string | null,
  role: string | null,
  eventType: EmailEventType,
  date: string,
  isApplicationEmail = true,
): StoredGmailMessage => {
  seq += 1;
  return {
    id: `m${seq}`,
    threadId: `t${seq}`,
    date,
    from: "jobs@example.com",
    subject: `${eventType} ${company ?? ""} ${role ?? ""}`.trim(),
    prefilterPassed: true,
    prefilterReason: "application_phrase",
    classification: { isApplicationEmail, company, role, eventType, confidence: 0.9 },
    llmSucceeded: true,
    processedAt: date,
  };
};

const job = (id: string, company: string, title: string, status: JobStatus, updatedAt = "2026-09-01T00:00:00.000Z") =>
  ({
    id,
    status,
    updatedAt,
    extracted: { company, companyDisplayName: company, title },
  }) as unknown as JobRecord;

describe("normalizeCompany / roleSimilarity", () => {
  it("strips legal suffixes and punctuation", () => {
    expect(normalizeCompany("Acme, Inc.")).toBe("acme");
    expect(normalizeCompany("Cherry Technologies")).toBe("cherry");
    expect(normalizeCompany("AT&T")).toBe(normalizeCompany("AT and T"));
  });

  it("treats abbreviations as equivalent roles", () => {
    expect(roleSimilarity("Sr. Software Engineer", "Senior Software Engineer")).toBeGreaterThanOrEqual(0.6);
    expect(roleSimilarity("Software Engineer", "Product Designer")).toBeLessThan(0.6);
  });
});

describe("buildApplications", () => {
  it("groups by company + role and uses the latest event for status", () => {
    const apps = buildApplications(
      [
        msg("Acme Inc", "Software Engineer", "applied", "2026-09-24T10:00:00.000Z"),
        msg("Acme", "Software Engineer II", "interview", "2026-09-27T10:00:00.000Z"),
        msg("Acme", "Product Designer", "applied", "2026-09-25T10:00:00.000Z"),
      ],
      [],
    );
    expect(apps).toHaveLength(2);
    const swe = apps.find((a) => a.role?.startsWith("Software"))!;
    expect(swe.status).toBe("interviewing");
    expect(swe.appliedAt).toBe("2026-09-24T10:00:00.000Z");
    expect(swe.lastUpdateAt).toBe("2026-09-27T10:00:00.000Z");
    expect(swe.emails.map((e) => e.eventType)).toEqual(["interview", "applied"]);
    expect(swe.emails[0]!.gmailUrl).toContain("mail.google.com");
  });

  it("falls back to the earliest email date when no applied event exists", () => {
    const [app] = buildApplications(
      [
        msg("Bubble", "Engineer", "rejected", "2026-09-29T10:00:00.000Z"),
        msg("Bubble", "Engineer", "other", "2026-09-26T10:00:00.000Z"),
      ],
      [],
    );
    expect(app!.appliedAt).toBe("2026-09-26T10:00:00.000Z");
    expect(app!.status).toBe("rejected");
  });

  it("ignores 'other' events when picking status", () => {
    const [app] = buildApplications(
      [
        msg("Fleetio", "Engineer", "assessment", "2026-09-25T10:00:00.000Z"),
        msg("Fleetio", "Engineer", "other", "2026-09-28T10:00:00.000Z"),
      ],
      [],
    );
    expect(app!.status).toBe("assessment");
    expect(app!.lastUpdateAt).toBe("2026-09-28T10:00:00.000Z");
  });

  it("breaks same-timestamp ties toward the more final event", () => {
    const at = "2026-09-28T10:00:00.000Z";
    const [app] = buildApplications(
      [msg("Wex", "SDE I", "rejected", at), msg("Wex", "SDE I", "applied", at)],
      [],
    );
    expect(app!.status).toBe("rejected");
  });

  it("attaches role-less emails to the company's only role", () => {
    const apps = buildApplications(
      [
        msg("WorldQuant", "Full Stack Developer", "applied", "2026-09-24T10:00:00.000Z"),
        msg("WorldQuant", null, "rejected", "2026-09-29T10:00:00.000Z"),
      ],
      [],
    );
    expect(apps).toHaveLength(1);
    expect(apps[0]!.status).toBe("rejected");
  });

  it("skips non-application and company-less messages", () => {
    expect(
      buildApplications(
        [
          msg("Acme", "Engineer", "applied", "2026-09-24T10:00:00.000Z", false),
          msg(null, "Engineer", "applied", "2026-09-24T10:00:00.000Z"),
        ],
        [],
      ),
    ).toEqual([]);
  });

  it("matches tracker jobs and suggests a status update", () => {
    const [app] = buildApplications(
      [
        msg("Acme", "Senior Software Engineer", "applied", "2026-09-24T10:00:00.000Z"),
        msg("Acme", "Sr Software Engineer", "interview", "2026-09-27T10:00:00.000Z"),
      ],
      [job("j1", "Acme Inc.", "Senior Software Engineer", "applied"), job("j2", "Other", "Engineer", "applied")],
    );
    expect(app).toMatchObject({
      trackerJobId: "j1",
      trackerStatus: "applied",
      suggestedStatus: "interviewing",
    });
  });
});

describe("matchTrackerJob", () => {
  const jobs = [
    job("a", "Acme", "Software Engineer", "applied", "2026-09-01T00:00:00.000Z"),
    job("b", "Acme", "Software Engineer", "to_review", "2026-09-10T00:00:00.000Z"),
    job("c", "Acme", "Data Analyst", "applied"),
  ];

  it("prefers the most recently updated among equal role matches", () => {
    expect(matchTrackerJob({ company: "Acme", role: "Software Engineer" }, jobs)?.id).toBe("b");
  });

  it("returns undefined for an ambiguous role-less match", () => {
    expect(matchTrackerJob({ company: "Acme", role: null }, jobs)).toBeUndefined();
  });

  it("returns the single company job when role is missing", () => {
    expect(matchTrackerJob({ company: "Solo", role: null }, [job("s", "Solo LLC", "Engineer", "applied")])?.id).toBe("s");
  });

  it("does not match unrelated roles", () => {
    expect(matchTrackerJob({ company: "Acme", role: "Product Designer" }, jobs)).toBeUndefined();
  });
});

describe("suggestTrackerStatus", () => {
  it("only moves forward in the pipeline", () => {
    expect(suggestTrackerStatus("to_review", "applied")).toBe("applied");
    expect(suggestTrackerStatus("applied", "interviewing")).toBe("interviewing");
    expect(suggestTrackerStatus("interviewing", "assessment")).toBeUndefined();
    expect(suggestTrackerStatus("applied", "applied")).toBeUndefined();
  });

  it("always suggests rejected/offer unless already terminal", () => {
    expect(suggestTrackerStatus("interviewing", "rejected")).toBe("rejected");
    expect(suggestTrackerStatus("assessment", "offer")).toBe("offer");
    expect(suggestTrackerStatus("closed", "rejected")).toBeUndefined();
    expect(suggestTrackerStatus("rejected", "interviewing")).toBeUndefined();
  });
});
