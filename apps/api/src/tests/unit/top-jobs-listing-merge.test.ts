import { describe, expect, it } from "vitest";
import {
  filterListingsByMaxAge,
  mergeDiscoveredListings,
  resolveDiscoverySourceLabel,
} from "../../services/topJobs/listingMerge.js";
import type { DiscoveredListing } from "../../types/topJob.js";

const listing = (overrides: Partial<DiscoveredListing> & Pick<DiscoveredListing, "externalId">): DiscoveredListing => ({
  source: "jsearch",
  company: "Acme",
  title: "Engineer",
  description: "x".repeat(200),
  applyUrl: "https://example.com/job",
  sourcePostedAt: "2026-06-15T12:00:00.000Z",
  sourceUpdatedAt: "2026-06-15T12:00:00.000Z",
  ...overrides,
});

describe("listingMerge", () => {
  const now = new Date("2026-06-22T12:00:00.000Z").getTime();

  it("filters listings older than max age", () => {
    const fresh = listing({ externalId: "1", sourcePostedAt: "2026-06-20T12:00:00.000Z" });
    const stale = listing({ externalId: "2", sourcePostedAt: "2026-06-01T12:00:00.000Z" });
    const out = filterListingsByMaxAge([fresh, stale], 14, now);
    expect(out.map((l) => l.externalId)).toEqual(["1"]);
  });

  it("merges feeds and prefers jsearch on duplicate apply URL", () => {
    const jb = listing({
      externalId: "jb-1",
      source: "jobsbase",
      applyUrl: "https://example.com/same",
      title: "From Jobs Base",
    });
    const js = listing({
      externalId: "js-1",
      source: "jsearch",
      applyUrl: "https://example.com/same",
      title: "From JSearch",
    });
    const merged = mergeDiscoveredListings([js], [jb]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("jsearch");
    expect(merged[0]?.title).toBe("From JSearch");
  });

  it("labels mixed source when both feeds contribute unique listings", () => {
    expect(resolveDiscoverySourceLabel(2, 3)).toBe("mixed");
    expect(resolveDiscoverySourceLabel(0, 3)).toBe("jobsbase");
    expect(resolveDiscoverySourceLabel(4, 0)).toBe("jsearch");
  });
});
