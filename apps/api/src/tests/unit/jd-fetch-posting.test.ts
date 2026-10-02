import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPosting,
  parseJsonLdJobPosting,
  PostingFetchError,
  workdayApiUrl,
} from "../../services/gmail/jdRecovery/fetchPosting.js";

const LONG = "You will build TypeScript services and React interfaces for our platform. ".repeat(15);

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => fetchMock.mockReset());

describe("fetchPosting adapters", () => {
  it("maps Greenhouse board URLs to the boards API and decodes escaped HTML", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ title: "Software Engineer", content: `&lt;p&gt;${LONG}&lt;/p&gt;`, requisition_id: "REQ-77" }),
    );
    const p = await fetchPosting("https://boards.greenhouse.io/acme/jobs/4567890");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://boards-api.greenhouse.io/v1/boards/acme/jobs/4567890");
    expect(p.source).toBe("greenhouse");
    expect(p.requisitionId).toBe("REQ-77");
    expect(p.text).not.toContain("<p>");
    expect(p.text).toContain("TypeScript services");
  });

  it("maps Lever URLs to the postings API", async () => {
    fetchMock.mockResolvedValueOnce(json({ text: "Backend Engineer", descriptionPlain: LONG, lists: [] }));
    const p = await fetchPosting("https://jobs.lever.co/acme/abc-123");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.lever.co/v0/postings/acme/abc-123");
    expect(p.title).toBe("Backend Engineer");
  });

  it("finds Ashby jobs by id on the posting-api board", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ jobs: [{ id: "other", title: "X" }, { id: "job-1", title: "AI Engineer", descriptionPlain: LONG }] }),
    );
    const p = await fetchPosting("https://jobs.ashbyhq.com/acme/job-1");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.ashbyhq.com/posting-api/job-board/acme");
    expect(p.title).toBe("AI Engineer");
  });

  it("maps Workday URLs to the cxs endpoint and reads jobReqId", async () => {
    const url = new URL(
      "https://uhg.wd1.myworkdayjobs.com/en-US/External/job/Eden-Prairie-MN/Associate-Software-Engineer_2389186",
    );
    expect(workdayApiUrl(url)).toBe(
      "https://uhg.wd1.myworkdayjobs.com/wday/cxs/uhg/External/job/Eden-Prairie-MN/Associate-Software-Engineer_2389186",
    );
    fetchMock.mockResolvedValueOnce(
      json({
        jobPostingInfo: { title: "Associate Software Engineer", jobDescription: `<p>${LONG}</p>`, jobReqId: "2389186" },
        hiringOrganization: { name: "UnitedHealth Group" },
      }),
    );
    const p = await fetchPosting(url.toString());
    expect(p.requisitionId).toBe("2389186");
    expect(p.company).toBe("UnitedHealth Group");
  });

  it("parses JSON-LD JobPosting on generic pages, including @graph", async () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@graph": [
        { "@type": "Organization", name: "Acme" },
        {
          "@type": "JobPosting",
          title: "Full Stack Engineer",
          description: `<p>${LONG}</p>`,
          hiringOrganization: { name: "Acme" },
          identifier: { name: "Acme", value: "R12345" },
          datePosted: "2026-09-01",
        },
      ],
    })}</script></head><body>nav</body></html>`;
    expect(parseJsonLdJobPosting(html)?.requisitionId).toBe("R12345");
    fetchMock.mockResolvedValueOnce(new Response(html, { status: 200 }));
    const p = await fetchPosting("https://acme.com/careers/jobs/12345");
    expect(p.source).toBe("careers");
    expect(p.title).toBe("Full Stack Engineer");
    expect(p.datePosted).toBe("2026-09-01");
  });

  it("treats short, closed, and 404 pages as failures", async () => {
    fetchMock.mockResolvedValueOnce(json({ text: "Engineer", descriptionPlain: "Short." }));
    await expect(fetchPosting("https://jobs.lever.co/acme/a")).rejects.toMatchObject({ reason: "too_short" });

    fetchMock.mockResolvedValueOnce(
      json({ text: "Engineer", descriptionPlain: `This job is no longer available. ${LONG}` }),
    );
    await expect(fetchPosting("https://jobs.lever.co/acme/b")).rejects.toMatchObject({ reason: "closed" });

    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect(fetchPosting("https://jobs.lever.co/acme/c")).rejects.toBeInstanceOf(PostingFetchError);
  });
});
