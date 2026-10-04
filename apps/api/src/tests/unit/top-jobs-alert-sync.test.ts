import { describe, expect, it, vi } from "vitest";
import type { JobRecord } from "../../types/job.js";
import type { AlertListingDoc } from "../../services/topJobs/alertListings.repository.js";
import { resolveAlertJd, type AlertJd, type AlertJdDeps } from "../../services/topJobs/alertJd.js";
import { emptySyncStats, isKnownRole, processAlertListings, type ProcessDeps } from "../../services/topJobs/topJobsSync.js";
import type { FetchedPosting } from "../../services/gmail/jdRecovery/fetchPosting.js";

const JD_TEXT =
  "Software Engineer at Acme. Build TypeScript and React features with Node.js APIs and PostgreSQL. ".repeat(8);

const listing = (over: Partial<AlertListingDoc> = {}): AlertListingDoc => ({
  _id: `${(over.company ?? "acme").toLowerCase()}|${(over.title ?? "Software Engineer").toLowerCase()}`,
  company: "Acme",
  title: "Software Engineer",
  location: "Remote",
  platforms: ["linkedin"],
  links: [{ platform: "linkedin", url: "https://www.linkedin.com/jobs/view/4012345678", externalId: "4012345678" }],
  emailIds: ["m1"],
  firstSeenAt: "2026-10-01T12:00:00.000Z",
  lastSeenAt: "2026-10-01T12:00:00.000Z",
  status: "pending",
  ...over,
});

const posting = (over: Partial<FetchedPosting> = {}): FetchedPosting => ({
  url: "https://www.linkedin.com/jobs/view/4012345678",
  source: "linkedin",
  title: "Software Engineer",
  company: "Acme",
  text: JD_TEXT,
  ...over,
});

const okJd = (l: AlertListingDoc): AlertJd => ({
  ok: true,
  posting: posting({ title: l.title, company: l.company }),
  platform: l.links[0]?.platform ?? "linkedin",
  alertUrl: l.links[0]?.url ?? null,
  viaSearch: false,
  serperQueries: 0,
});

const scored = (total: number) => ({ score: { total } }) as unknown as JobRecord;

const makeDeps = (over: Partial<ProcessDeps> = {}) => {
  const calls: string[] = [];
  const outcomes = new Map<string, string>();
  const deps: ProcessDeps = {
    known: [],
    maxTriages: 15,
    minScore: 70,
    resolveJd: vi.fn(async (l) => {
      calls.push(`jd:${l.company}`);
      return okJd(l);
    }),
    triage: vi.fn(async (l) => {
      calls.push(`triage:${l.company}`);
      return scored(82);
    }),
    store: vi.fn(async () => "top-1"),
    setOutcome: vi.fn(async (key, o) => {
      outcomes.set(key, o.status);
    }),
    ...over,
  };
  return { deps, calls, outcomes };
};

describe("processAlertListings", () => {
  it("runs free filters before any fetch or scoring", async () => {
    const { deps, calls, outcomes } = makeDeps({ known: [{ company: "Beta Inc", title: "Software Engineer" }] });
    const stats = emptySyncStats();
    await processAlertListings(
      [
        listing({ company: "Senior Co", title: "Senior Software Engineer" }),
        listing({ company: "Beta", title: "Software Engineer" }),
        listing({ company: "Acme" }),
      ],
      deps,
      stats,
    );
    expect(calls).toEqual(["jd:Acme", "triage:Acme"]);
    expect([...outcomes.values()]).toEqual(["filtered", "duplicate", "stored"]);
    expect(stats).toMatchObject({ fetched: 3, skippedExisting: 1, triaged: 1, stored: 1, bySource: { linkedin: 1 } });
  });

  it("collapses the same role seen again in one run and respects the scoring cap", async () => {
    const { deps, calls } = makeDeps({ maxTriages: 2 });
    const stats = emptySyncStats();
    await processAlertListings(
      [
        listing({ company: "Acme", _id: "a" }),
        listing({ company: "Acme Inc.", _id: "b", platforms: ["indeed"] }),
        listing({ company: "Gamma", _id: "c" }),
        listing({ company: "Delta", _id: "d" }),
      ],
      deps,
      stats,
    );
    expect(calls.filter((c) => c.startsWith("triage"))).toEqual(["triage:Acme", "triage:Gamma"]);
    expect(stats.skippedExisting).toBe(1);
    expect(deps.setOutcome).not.toHaveBeenCalledWith("d", expect.anything());
  });

  it("records missing postings and low scores without storing them", async () => {
    const { deps, outcomes } = makeDeps({
      resolveJd: vi.fn(async (l: AlertListingDoc): Promise<AlertJd> =>
        l.company === "NoJd" ? { ok: false, reason: "search found no matching posting", serperQueries: 1 } : okJd(l),
      ),
      triage: vi.fn(async () => scored(55)),
    });
    const stats = emptySyncStats();
    await processAlertListings([listing({ company: "NoJd", _id: "x" }), listing({ company: "Low", _id: "y" })], deps, stats);
    expect(outcomes.get("x")).toBe("jd_unavailable");
    expect(outcomes.get("y")).toBe("below_min");
    expect(deps.store).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ jdUnavailable: 1, belowMinScore: 1, serperQueries: 1 });
  });

  it("drops roles outside remote/NYC before fetching when the alert names a place", async () => {
    const { deps, calls, outcomes } = makeDeps();
    const stats = emptySyncStats();
    await processAlertListings(
      [
        listing({ company: "Parasail", _id: "p", location: "San Mateo, CA (On-site)" }),
        listing({ company: "Nyco", _id: "n", location: "New York, NY (Hybrid)" }),
      ],
      deps,
      stats,
    );
    expect(outcomes.get("p")).toBe("filtered");
    expect(calls).toEqual(["jd:Nyco", "triage:Nyco"]);
    expect(stats.locationFiltered).toBe(1);
  });

  it("drops roles whose posting page or scorer places them outside remote/NYC", async () => {
    const { deps, calls, outcomes } = makeDeps({
      resolveJd: vi.fn(async (l: AlertListingDoc): Promise<AlertJd> => {
        const jd = okJd(l);
        if (jd.ok && l.company === "Mitre") jd.posting.location = "Bedford, MA";
        return jd;
      }),
      triage: vi.fn(async (l) =>
        ({
          score: { total: 85 },
          extracted: l.company === "Vague" ? { location: "Austin, TX", remoteType: "onsite" } : { remoteType: "remote" },
        }) as unknown as JobRecord,
      ),
    });
    const stats = emptySyncStats();
    await processAlertListings(
      [
        listing({ company: "Mitre", _id: "m", location: "United States" }),
        listing({ company: "Vague", _id: "v", location: null }),
        listing({ company: "Remoteco", _id: "r", location: null }),
      ],
      deps,
      stats,
    );
    expect(calls).not.toContain("triage:Mitre");
    expect(outcomes.get("m")).toBe("filtered");
    expect(outcomes.get("v")).toBe("filtered");
    expect(outcomes.get("r")).toBe("stored");
    expect(stats.locationFiltered).toBe(2);
  });

  it("skips postings that are no longer accepting applications", async () => {
    const { deps, calls, outcomes } = makeDeps({
      resolveJd: vi.fn(async (l: AlertListingDoc): Promise<AlertJd> => {
        const jd = okJd(l);
        if (jd.ok) jd.posting.closed = true;
        return jd;
      }),
    });
    const stats = emptySyncStats();
    await processAlertListings([listing({ company: "Fonzi", _id: "f", location: "New York, NY" })], deps, stats);
    expect(deps.resolveJd).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    expect(outcomes.get("f")).toBe("filtered");
    expect(stats.closed).toBe(1);
  });

  it("matches known roles by employer and close title", () => {
    const known = [{ company: "Acme, Inc.", title: "Software Engineer II" }];
    expect(isKnownRole("Acme", "Software Engineer II", known)).toBe(true);
    expect(isKnownRole("Acme", "Data Analyst", known)).toBe(false);
    expect(isKnownRole("Other", "Software Engineer II", known)).toBe(false);
  });
});

describe("resolveAlertJd", () => {
  const deps = (over: Partial<AlertJdDeps> = {}): AlertJdDeps => ({
    fetch: vi.fn(async (url: string) => posting({ url })),
    search: vi.fn(async () => [{ title: "Acme - Software Engineer", link: "https://job-boards.greenhouse.io/acme/jobs/123" }]),
    searchBudgetLeft: vi.fn(async () => true),
    recordSearch: vi.fn(async () => undefined),
    ...over,
  });

  it("reads LinkedIn directly without a search credit", async () => {
    const d = deps();
    const jd = await resolveAlertJd(listing(), d);
    expect(jd).toMatchObject({ ok: true, platform: "linkedin", viaSearch: false, serperQueries: 0 });
    expect(d.search).not.toHaveBeenCalled();
  });

  it("skips bot-blocked Indeed pages and finds the employer posting by search", async () => {
    const d = deps();
    const jd = await resolveAlertJd(
      listing({ platforms: ["indeed"], links: [{ platform: "indeed", url: "https://www.indeed.com/rc/clk?jk=abc" }] }),
      d,
    );
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(d.fetch).toHaveBeenCalledWith("https://job-boards.greenhouse.io/acme/jobs/123");
    expect(jd).toMatchObject({ ok: true, platform: "indeed", viaSearch: true, serperQueries: 1 });
    expect(d.recordSearch).toHaveBeenCalledTimes(1);
  });

  it("rejects a search hit for a different employer", async () => {
    const d = deps({ fetch: vi.fn(async (url: string) => posting({ url, company: "Other Corp", text: JD_TEXT.replace(/Acme/g, "Other Corp") })) });
    const jd = await resolveAlertJd(listing({ links: [] }), d);
    expect(jd).toMatchObject({ ok: false, serperQueries: 1 });
  });

  it("gives up without spending a credit when the search budget is gone", async () => {
    const d = deps({ searchBudgetLeft: vi.fn(async () => false) });
    const jd = await resolveAlertJd(listing({ links: [] }), d);
    expect(jd).toMatchObject({ ok: false, serperQueries: 0 });
    expect(d.search).not.toHaveBeenCalled();
  });
});
