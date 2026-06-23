import type { DiscoveredListing } from "../../types/topJob.js";

/** Drop listings older than `maxAgeDays` (by sourcePostedAt). */
export const filterListingsByMaxAge = (
  listings: DiscoveredListing[],
  maxAgeDays: number,
  nowMs = Date.now(),
): DiscoveredListing[] => {
  if (maxAgeDays <= 0) return listings;
  const cutoff = nowMs - maxAgeDays * 24 * 60 * 60 * 1000;
  return listings.filter((l) => {
    const posted = new Date(l.sourcePostedAt).getTime();
    return !Number.isNaN(posted) && posted >= cutoff;
  });
};

/** Dedupe by apply URL; prefer JSearch when the same job appears in both feeds. */
export const mergeDiscoveredListings = (
  jsearch: DiscoveredListing[],
  jobsbase: DiscoveredListing[],
): DiscoveredListing[] => {
  const byUrl = new Map<string, DiscoveredListing>();

  const upsert = (listing: DiscoveredListing): void => {
    const key = listing.applyUrl.trim().toLowerCase();
    if (!key) return;
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, listing);
      return;
    }
    if (listing.source === "jsearch" && existing.source !== "jsearch") {
      byUrl.set(key, listing);
      return;
    }
    if (listing.source === existing.source) {
      const newer =
        listing.sourcePostedAt.localeCompare(existing.sourcePostedAt) > 0 ? listing : existing;
      byUrl.set(key, newer);
    }
  };

  for (const l of jobsbase) upsert(l);
  for (const l of jsearch) upsert(l);

  return [...byUrl.values()];
};

export const resolveDiscoverySourceLabel = (
  jsearchCount: number,
  jobsbaseCount: number,
): "jsearch" | "jobsbase" | "mixed" => {
  if (jsearchCount > 0 && jobsbaseCount > 0) return "mixed";
  if (jsearchCount > 0) return "jsearch";
  return "jobsbase";
};
