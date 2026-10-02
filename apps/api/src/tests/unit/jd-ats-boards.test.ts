import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => new Map<string, { boards: unknown[]; miss: boolean; checkedAt: string }>());

vi.mock("../../config/mongo.js", () => ({
  getDb: async () => ({
    collection: () => ({
      findOne: async ({ _id }: { _id: string }) => {
        const doc = cache.get(_id);
        return doc ? { _id, ...doc } : null;
      },
      replaceOne: async ({ _id }: { _id: string }, doc: { boards: unknown[]; miss: boolean; checkedAt: string }) => {
        cache.set(_id, doc);
      },
    }),
  }),
}));

import {
  boardConfirmsCompany,
  discoverBoards,
  fetchBoardJob,
  listBoard,
  slugCandidates,
  type BoardListing,
} from "../../services/gmail/jdRecovery/atsBoards.js";
import { parseLinkedInGuestHtml } from "../../services/gmail/jdRecovery/fetchPosting.js";

const LONG = "At Ellipsis Labs you will build TypeScript services and React interfaces. ".repeat(12);
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const notFound = () => new Response("{}", { status: 404 });

beforeEach(() => cache.clear());
afterEach(() => fetchMock.mockReset());

describe("board adapters", () => {
  it("lists Greenhouse jobs with content and the board name", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/jobs?content=true")
        ? json({ jobs: [{ id: 1, title: "SWE", absolute_url: "https://x/1", content: `&lt;p&gt;${LONG}&lt;/p&gt;` }] })
        : json({ name: "Jamf" }),
    );
    const l = await listBoard({ ats: "greenhouse", slug: "jamf" });
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain("https://boards-api.greenhouse.io/v1/boards/jamf/jobs?content=true");
    expect(l?.companyName).toBe("Jamf");
    expect(l?.jobs[0]?.text).toContain("TypeScript services");
  });

  it("lists Lever, Ashby, and Workable boards", async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: "a", text: "SWE", hostedUrl: "https://jobs.lever.co/x/a", descriptionPlain: LONG }]));
    expect((await listBoard({ ats: "lever", slug: "x" }))?.jobs[0]?.title).toBe("SWE");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.lever.co/v0/postings/x?mode=json");

    fetchMock.mockResolvedValueOnce(json({ jobs: [{ id: "j", title: "AI Eng", descriptionPlain: LONG }] }));
    expect((await listBoard({ ats: "ashby", slug: "y" }))?.jobs[0]?.url).toBe("https://jobs.ashbyhq.com/y/j");

    fetchMock.mockResolvedValueOnce(json({ name: "Maania", jobs: [{ title: "JS Eng", shortcode: "ABC", description: LONG }] }));
    const w = await listBoard({ ats: "workable", slug: "maania" });
    expect(fetchMock.mock.calls[2]![0]).toBe("https://apply.workable.com/api/v1/widget/accounts/maania?details=true");
    expect(w?.companyName).toBe("Maania");
  });

  it("searches SmartRecruiters and fetches full text from the posting detail", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ totalFound: 1, content: [{ id: "744", name: "SWE", refNumber: "REF9", company: { name: "Visa" } }] }),
    );
    const l = (await listBoard({ ats: "smartrecruiters", slug: "Visa" }, "Software Engineer"))!;
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://api.smartrecruiters.com/v1/companies/Visa/postings?limit=100&q=Software%20Engineer",
    );
    fetchMock.mockResolvedValueOnce(json({ name: "SWE", jobAd: { sections: { jobDescription: { title: "About", text: `<p>${LONG}</p>` } } } }));
    const p = await fetchBoardJob(l, l.jobs[0]!);
    expect(p.text).toContain("TypeScript services");
    expect(p.source).toBe("smartrecruiters");
  });

  it("POSTs Workday searches to the cxs jobs endpoint and reads the req ID", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ jobPostings: [{ title: "Associate Software Engineer", externalPath: "/job/MN/ASE_2389186", bulletFields: ["2389186"] }] }),
    );
    const l = await listBoard(
      {
        ats: "workday",
        slug: "uhg/External",
        workday: { origin: "https://uhg.wd1.myworkdayjobs.com", tenant: "uhg", site: "External" },
      },
      "2389186",
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://uhg.wd1.myworkdayjobs.com/wday/cxs/uhg/External/jobs");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ searchText: "2389186" });
    expect(l?.jobs[0]).toMatchObject({
      url: "https://uhg.wd1.myworkdayjobs.com/External/job/MN/ASE_2389186",
      requisitionId: "2389186",
    });
  });

  it("returns null for boards that don't exist", async () => {
    fetchMock.mockResolvedValueOnce(notFound());
    expect(await listBoard({ ats: "lever", slug: "nope" })).toBeNull();
  });
});

describe("slug guessing and the collision guard", () => {
  it("orders slug candidates: joined, hyphenated, raw, sender roots, first word", () => {
    expect(slugCandidates("Ellipsis Labs", ["ellipsislabs"])).toEqual(["ellipsis", "ellipsislabs"]);
    expect(slugCandidates("Maania Consultancy Services")).toEqual([
      "maaniaconsultancyservices",
      "maania-consultancy-services",
      "maania",
    ]);
  });

  const listing = (slug: string, companyName?: string, text = LONG): BoardListing => ({
    ref: { ats: "lever", slug },
    companyName,
    jobs: [{ id: "1", title: "SWE", url: "u", text }],
  });

  it("requires a matching board name, sender domain, or exact slug plus a mention", () => {
    expect(boardConfirmsCompany(listing("herald", "Herald News Corp"), "Herald")).toBe(false);
    expect(boardConfirmsCompany(listing("unitedhealth", "UnitedHealth Group Inc"), "UnitedHealth Group")).toBe(true);
    expect(boardConfirmsCompany(listing("teleskope"), "Teleskope Inc", { senderRoots: ["teleskope"] })).toBe(true);
    expect(boardConfirmsCompany(listing("ellipsislabs"), "Ellipsis Labs")).toBe(true);
    expect(boardConfirmsCompany(listing("ellipsis", undefined, "At Ellipsis Health we care. ".repeat(30)), "Ellipsis Labs")).toBe(false);
    expect(boardConfirmsCompany(listing("palantir", undefined, "At Palantir we build. " + LONG), "Palantir")).toBe(true);
    expect(boardConfirmsCompany(listing("palantir", undefined, "Generic text. ".repeat(50)), "Palantir")).toBe(false);
  });

  it("probes guessed slugs, keeps only confirmed boards, and caches misses", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "https://boards-api.greenhouse.io/v1/boards/palantir/jobs?content=true") {
        return json({ jobs: [{ id: 1, title: "SWE", absolute_url: "https://x/1", content: LONG }] });
      }
      if (url === "https://boards-api.greenhouse.io/v1/boards/palantir") return json({ name: "Palantir Technologies" });
      return notFound();
    });
    const found = await discoverBoards({ company: "Palantir", senderRoots: [] });
    expect(found.map((l) => l.ref)).toEqual([{ ats: "greenhouse", slug: "palantir" }]);
    expect(cache.get("palantir")).toMatchObject({ miss: false });

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(notFound());
    expect(await discoverBoards({ company: "Nowhere Co", senderRoots: [] })).toEqual([]);
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(cache.get("nowhere")).toMatchObject({ miss: true });
    await discoverBoards({ company: "Nowhere Co", senderRoots: [] });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("probes only the hinted ATS when the sender names one", async () => {
    fetchMock.mockResolvedValue(notFound());
    await discoverBoards({ company: "Jamf", senderRoots: [], preferAts: ["greenhouse"] });
    expect(fetchMock.mock.calls.every((c) => String(c[0]).includes("greenhouse"))).toBe(true);
  });
});

describe("LinkedIn guest posting", () => {
  it("parses title, company, and description", () => {
    const html = `<h2 class="top-card-layout__title font-sans">Junior Software Engineer</h2>
      <a class="topcard__org-name-link topcard__flavor--black-link" href="x">KGS Technology Group</a>
      <div class="show-more-less-html__markup relative">${LONG}</div>`;
    const p = parseLinkedInGuestHtml(html);
    expect(p).toMatchObject({ title: "Junior Software Engineer", company: "KGS Technology Group" });
    expect(p.text).toContain("TypeScript services");
  });
});
