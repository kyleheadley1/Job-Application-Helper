import { describe, expect, it } from "vitest";
import { boardFromUrl, detectAtsHints, domainRoot } from "../../services/gmail/jdRecovery/atsHints.js";

describe("boardFromUrl", () => {
  it("reads tenant and site from a Workday login link", () => {
    expect(boardFromUrl("https://uhg.wd1.myworkdayjobs.com/en-US/External/login")).toEqual({
      ats: "workday",
      slug: "uhg/External",
      workday: { origin: "https://uhg.wd1.myworkdayjobs.com", tenant: "uhg", site: "External" },
    });
  });

  it("reads board slugs from ATS links, including the Greenhouse embed `for` param", () => {
    expect(boardFromUrl("https://boards.greenhouse.io/embed/job_app?for=figma&token=123")).toMatchObject({
      ats: "greenhouse",
      slug: "figma",
    });
    expect(boardFromUrl("https://job-boards.greenhouse.io/jamf/jobs/555")).toMatchObject({ slug: "jamf" });
    expect(boardFromUrl("https://jobs.lever.co/palantir/abc")).toMatchObject({ ats: "lever", slug: "palantir" });
    expect(boardFromUrl("https://jobs.ashbyhq.com/ellipsis/xyz")).toMatchObject({ ats: "ashby", slug: "ellipsis" });
    expect(boardFromUrl("https://apply.workable.com/maania/j/ABC123")).toMatchObject({ ats: "workable", slug: "maania" });
    expect(boardFromUrl("https://jobs.smartrecruiters.com/Visa/7444")).toMatchObject({ ats: "smartrecruiters" });
  });

  it("flags Greenhouse from a gh_jid param without a slug", () => {
    expect(boardFromUrl("https://www.acme.com/careers?gh_jid=12345")).toEqual({ ats: "greenhouse" });
  });

  it("sees through redirect wrappers", () => {
    const wrapped = `https://click.example.com/?url=${encodeURIComponent("https://jobs.lever.co/acme/1")}`;
    expect(boardFromUrl(wrapped)).toMatchObject({ ats: "lever", slug: "acme" });
  });
});

describe("detectAtsHints", () => {
  it("collects boards from links, ATS from senders, and company sender domain roots", () => {
    const hints = detectAtsHints([
      { from: "Teleskope <jobs@teleskope.ai>", links: [] },
      { from: "no-reply@us.greenhouse-mail.io", links: ["https://example.com/unsubscribe"] },
      { from: "uhg@myworkday.com", links: ["https://uhg.wd1.myworkdayjobs.com/External/login"] },
      { from: "jobs-noreply@linkedin.com", links: [] },
    ]);
    expect(hints.senderRoots).toEqual(["teleskope"]);
    expect(hints.boards.map((b) => b.slug)).toEqual(["uhg/External"]);
    expect(hints.atsOnly).toEqual(["greenhouse"]);
  });

  it("takes the registrable label from company domains", () => {
    expect(domainRoot("careers.acme.co.uk")).toBe("acme");
    expect(domainRoot("mail.figma.com")).toBe("figma");
  });
});
