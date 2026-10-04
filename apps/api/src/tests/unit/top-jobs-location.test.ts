import { describe, expect, it, vi } from "vitest";
import { classifyLocation, locationFits } from "../../services/topJobs/locationFit.js";
import { recheckListedTopJobs, type RecheckDeps } from "../../services/topJobs/topJobsSync.js";
import { PostingFetchError, parseLinkedInGuestHtml } from "../../services/gmail/jdRecovery/fetchPosting.js";
import type { TopJobRecord } from "../../types/topJob.js";

describe("classifyLocation", () => {
  it.each([
    ["Remote", "fit"],
    ["United States (Remote)", "fit"],
    ["New York, NY", "fit"],
    ["New York City Metropolitan Area", "fit"],
    ["Brooklyn, NY (Hybrid)", "fit"],
    ["Jersey City, NJ", "fit"],
    ["San Mateo", "mismatch"],
    ["Bedford, MA (On-site)", "mismatch"],
    ["Bismarck, ND, US", "mismatch"],
    ["Not remote - Austin, TX", "mismatch"],
    ["United States", "unknown"],
    ["United States (On-site)", "unknown"],
    ["", "unknown"],
    [null, "unknown"],
  ] as const)("%s → %s", (loc, verdict) => {
    expect(classifyLocation(loc)).toBe(verdict);
  });
});

describe("locationFits", () => {
  it("needs positive evidence of remote or NYC", () => {
    expect(locationFits({ alertLocation: "United States" })).toBe(false);
    expect(locationFits({ alertLocation: "United States", extracted: { remoteType: "remote" } })).toBe(true);
    expect(locationFits({ extracted: { location: "San Mateo", locationIsCommutable: true } })).toBe(true);
    expect(locationFits({ extracted: { location: "Bedford, MA", remoteType: "onsite" } })).toBe(false);
    expect(locationFits({ postingLocation: "New York, NY" })).toBe(true);
  });

  it("trusts the posting's own location label over the scorer", () => {
    const scorerSaysRemote = { remoteType: "remote", locationIsCommutable: true } as const;
    expect(locationFits({ postingLocation: "San Mateo, CA", extracted: scorerSaysRemote })).toBe(false);
    expect(locationFits({ postingLocation: "United States", extracted: scorerSaysRemote })).toBe(true);
    expect(locationFits({ alertLocation: "Remote", postingLocation: "San Mateo, CA" })).toBe(true);
  });
});

describe("LinkedIn guest page", () => {
  it("reads the location and flags closed postings without failing the parse", () => {
    const open = parseLinkedInGuestHtml(
      `<span class="topcard__flavor topcard__flavor--bullet">\n New York, NY\n</span><div class="show-more-less-html__markup">JD</div>`,
    );
    expect(open).toMatchObject({ location: "New York, NY" });
    expect(open.closed).toBeUndefined();
    const closed = parseLinkedInGuestHtml(
      `<figure class="closed-job"><span>No longer accepting applications</span></figure><div class="show-more-less-html__markup">JD</div>`,
    );
    expect(closed.closed).toBe(true);
  });
});

describe("recheckListedTopJobs", () => {
  const job = (over: Partial<TopJobRecord>): TopJobRecord =>
    ({
      id: "j",
      applyUrl: "https://www.linkedin.com/jobs/view/4012345678",
      extracted: { company: "Acme", title: "Software Engineer", location: "New York, NY" },
      ...over,
    }) as TopJobRecord;

  const run = async (jobs: TopJobRecord[], fetchImpl: RecheckDeps["fetch"]) => {
    const hidden: Array<[string, string]> = [];
    const deps: RecheckDeps = {
      list: async () => jobs,
      fetch: vi.fn(fetchImpl),
      hide: async (id, reason) => {
        hidden.push([id, reason]);
      },
      markChecked: vi.fn(async () => undefined),
    };
    const retired = await recheckListedTopJobs(deps, Date.parse("2026-10-04T12:00:00Z"));
    return { retired, hidden, deps };
  };

  it("hides listed roles that are outside remote/NYC or have closed, and leaves tracker-promoted ones", async () => {
    const { retired, hidden } = await run(
      [
        job({ id: "parasail", extracted: { location: "San Mateo", locationIsCommutable: false } as TopJobRecord["extracted"] }),
        job({ id: "fonzi" }),
        job({ id: "open" }),
        job({ id: "promoted", promotedToJobId: "t1", extracted: { location: "Bedford, MA" } as TopJobRecord["extracted"] }),
      ],
      async (url) => ({ url, source: "linkedin", text: "x", closed: url.includes("fonzi") || undefined }),
    );
    expect(hidden).toEqual([["parasail", "location"]]);
    expect(retired).toBe(1);
  });

  it("treats a closed or missing posting as closed, and skips recently checked rows", async () => {
    const { hidden, deps } = await run(
      [
        job({ id: "gone" }),
        job({ id: "fresh", liveCheckedAt: "2026-10-04T06:00:00Z" }),
      ],
      async () => {
        throw new PostingFetchError("not_found", "404");
      },
    );
    expect(hidden).toEqual([["gone", "closed"]]);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  it("hides a listed role when its posting page names a place outside remote/NYC", async () => {
    const { hidden } = await run(
      [job({ id: "parasail", extracted: { remoteType: "remote", locationIsCommutable: true } as TopJobRecord["extracted"] })],
      async (url) => ({ url, source: "linkedin", text: "x", location: "San Mateo, CA" }),
    );
    expect(hidden).toEqual([["parasail", "location"]]);
  });

  it("hides a posting the page marks as closed", async () => {
    const { hidden } = await run([job({ id: "fonzi" })], async (url) => ({ url, source: "linkedin", text: "x", closed: true }));
    expect(hidden).toEqual([["fonzi", "closed"]]);
  });
});
