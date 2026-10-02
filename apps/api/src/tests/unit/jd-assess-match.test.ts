import { describe, expect, it } from "vitest";
import { assessJdMatch, isScoreable } from "../../services/gmail/jdRecovery/assessJdMatch.js";

const TEXT = "We are hiring engineers to build healthcare software. ".repeat(20);

const posting = (over: Partial<{ company: string; title: string; requisitionId: string; url: string; text: string }>) => ({
  url: "https://example.com/job/1",
  text: TEXT,
  ...over,
});

describe("assessJdMatch", () => {
  it("is exact when the email's req ID appears on the posting and the company matches", () => {
    const m = assessJdMatch({
      company: "UnitedHealth Group",
      role: "Associate Software Engineer",
      requisitionId: "2389186",
      source: "serper",
      posting: posting({ company: "UnitedHealth Group", title: "Associate Software Engineer", requisitionId: "2389186" }),
    });
    expect(m.level).toBe("exact");
    expect(isScoreable(m.level)).toBe(true);
  });

  it("is high for an email link with matching company and near-identical title", () => {
    const m = assessJdMatch({
      company: "Acme",
      role: "Software Engineer, Platform",
      source: "email_link",
      posting: posting({ company: "Acme", title: "Software Engineer - Platform" }),
    });
    expect(m.level).toBe("high");
  });

  it("is only low for a Serper hit without req ID proof, so it is not scored", () => {
    const m = assessJdMatch({
      company: "Acme",
      role: "Software Engineer",
      source: "serper",
      posting: posting({ company: "Acme", title: "Software Engineer" }),
    });
    expect(m.level).toBe("low");
    expect(isScoreable(m.level)).toBe(false);
  });

  it("rejects a similar opening with a different req ID", () => {
    const m = assessJdMatch({
      company: "UnitedHealth Group",
      role: "Associate Software Engineer",
      requisitionId: "2389186",
      source: "serper",
      posting: posting({ company: "UnitedHealth Group", title: "Associate Software Engineer", requisitionId: "2391111" }),
    });
    expect(m.level).toBe("none");
    expect(m.signals).toContain("req_id_mismatch");
  });

  it("is none for a different company or unrelated title", () => {
    expect(
      assessJdMatch({
        company: "Acme",
        role: "Software Engineer",
        source: "email_link",
        posting: posting({ company: "Globex", title: "Software Engineer" }),
      }).level,
    ).toBe("none");
    expect(
      assessJdMatch({
        company: "Acme",
        role: "Software Engineer",
        source: "email_link",
        posting: posting({ company: "Acme", title: "Account Executive" }),
      }).level,
    ).toBe("none");
  });

  it("does not match short company names by substring", () => {
    const m = assessJdMatch({
      company: "Ro",
      role: "AI Engineer",
      source: "email_link",
      posting: posting({ title: "AI Engineer", url: "https://jobs.lever.co/brex/1", text: `Product role. ${TEXT}` }),
    });
    expect(m.level).toBe("none");
  });
});

describe("assessJdMatch on company boards", () => {
  const board = (titleMatches: number, role: string | null = "Software Engineer, New Grad") =>
    assessJdMatch({
      company: "Ellipsis Labs",
      role,
      source: "ats_board",
      boardConfirmed: true,
      boardTitleMatches: titleMatches,
      posting: posting({ title: "Software Engineer - New Grad", url: "https://jobs.lever.co/ellipsislabs/1" }),
    });

  it("is high for the only near-identical title on the company's own board", () => {
    expect(board(1).level).toBe("high");
    expect(board(1).signals).toContain("company_board");
  });

  it("is low when several open jobs share the title, or the role is unknown", () => {
    expect(board(2).level).toBe("low");
    expect(board(1, null).level).toBe("low");
  });

  it("is not high on an unconfirmed board", () => {
    const m = assessJdMatch({
      company: "Ellipsis Labs",
      role: "Software Engineer - New Grad",
      source: "ats_board",
      boardConfirmed: false,
      boardTitleMatches: 1,
      posting: posting({ title: "Software Engineer - New Grad", text: `Ellipsis Labs ${TEXT}` }),
    });
    expect(m.level).toBe("low");
  });
});
