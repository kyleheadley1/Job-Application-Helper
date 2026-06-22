import { describe, expect, it } from "vitest";
import {
  preFilterListing,
  preFilterListings,
  sortListingsByPostedDesc,
} from "../../services/topJobs/preFilter.js";
import type { DiscoveredListing } from "../../types/topJob.js";

const baseListing = (overrides: Partial<DiscoveredListing> = {}): DiscoveredListing => ({
  source: "jsearch",
  externalId: "abc123",
  company: "Acme AI",
  title: "Junior Software Engineer",
  description:
    "Build TypeScript and React features for our platform. Remote friendly. " +
    "Work with Node.js APIs and PostgreSQL. Collaborate with product team on full stack delivery. ".repeat(3),
  applyUrl: "https://example.com/jobs/1",
  location: "Remote",
  remote: true,
  sourcePostedAt: "2026-06-01T12:00:00.000Z",
  sourceUpdatedAt: "2026-06-01T12:00:00.000Z",
  ...overrides,
});

describe("topJobs preFilter", () => {
  it("keeps entry-level engineering listings with stack overlap", () => {
    expect(preFilterListing(baseListing()).pass).toBe(true);
  });

  it("rejects senior titles", () => {
    expect(preFilterListing(baseListing({ title: "Senior Software Engineer" })).pass).toBe(false);
  });

  it("rejects unrelated titles", () => {
    expect(preFilterListing(baseListing({ title: "Data Analyst" })).pass).toBe(false);
  });

  it("rejects short descriptions", () => {
    expect(preFilterListing(baseListing({ description: "Too short" })).pass).toBe(false);
  });

  it("sorts listings by posted date descending", () => {
    const sorted = sortListingsByPostedDesc([
      baseListing({ externalId: "1", sourcePostedAt: "2026-06-01T10:00:00.000Z" }),
      baseListing({ externalId: "2", sourcePostedAt: "2026-06-03T10:00:00.000Z" }),
    ]);
    expect(sorted[0]?.externalId).toBe("2");
  });

  it("filters batch to survivors only", () => {
    const out = preFilterListings([
      baseListing({ externalId: "1" }),
      baseListing({ externalId: "2", title: "Senior Engineer" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.externalId).toBe("1");
  });
});

describe("jsearch normalize", () => {
  it("prefers job_apply_link over google link", async () => {
    const { normalizeJSearchJob } = await import("../../services/topJobs/jsearchClient.js");
    const listing = normalizeJSearchJob({
      job_id: "x1",
      employer_name: "Ooma, Inc.",
      job_title: "Software Engineer",
      job_description: "<p>Build TypeScript services for our platform with Node and React.</p>".repeat(5),
      job_apply_link: "https://apply.example.com/job",
      job_google_link: "https://google.com/jobs/xyz",
      job_posted_at_datetime_utc: "2026-06-01T08:00:00.000Z",
    });
    expect(listing?.applyUrl).toBe("https://apply.example.com/job");
    expect(listing?.company).toBe("Ooma, Inc.");
  });
});
