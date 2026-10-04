import { describe, expect, it } from "vitest";
import {
  preFilterListing,
  preFilterListings,
  preFilterTitle,
  sortListingsByPostedDesc,
} from "../../services/topJobs/preFilter.js";
import type { DiscoveredListing } from "../../types/topJob.js";

const baseListing = (overrides: Partial<DiscoveredListing> = {}): DiscoveredListing => ({
  source: "linkedin_alert",
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

describe("preFilterTitle", () => {
  it("applies the title rules without needing a description", () => {
    expect(preFilterTitle("Software Engineer").pass).toBe(true);
    expect(preFilterTitle("Senior Software Engineer").reason).toBe("seniority_overreach");
    expect(preFilterTitle("Distinguished Software Engineer (Remote)").reason).toBe("seniority_overreach");
    expect(preFilterTitle("Site Reliability Engineer").reason).toBe("title_denylist");
    expect(preFilterTitle("Account Manager").pass).toBe(false);
  });
});
