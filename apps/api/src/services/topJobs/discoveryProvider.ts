import { env } from "../../config/env.js";
import type { DiscoveredListing, TopJobSource } from "../../types/topJob.js";
import {
  DEFAULT_JSEARCH_PROFILES,
  fetchJSearchListings,
  JSearchQuotaError,
  type JSearchSearchParams,
} from "./jsearchClient.js";
import { fetchJobsBaseListings } from "./jobsBaseClient.js";

export type DiscoveryFetchResult = {
  listings: DiscoveredListing[];
  source: TopJobSource | "mixed";
  jsearchCreditsUsed: number;
};

export const fetchDiscoveredListings = async (options?: {
  forceSource?: "jsearch" | "jobsbase";
  jsearchCreditsUsedThisMonth?: number;
  numPages?: number;
  datePosted?: string;
}): Promise<DiscoveryFetchResult> => {
  const forceSource = options?.forceSource ?? env.topJobsSource;
  const creditsUsedSoFar = options?.jsearchCreditsUsedThisMonth ?? 0;
  const numPages = options?.numPages ?? env.jsearchNumPages;
  const datePosted = options?.datePosted ?? env.jsearchDatePosted;

  const useJobsBaseOnly = forceSource === "jobsbase";
  const canUseJSearch =
    !useJobsBaseOnly &&
    Boolean(env.rapidApiKey) &&
    creditsUsedSoFar < env.jsearchMonthlyCap;

  if (canUseJSearch && env.rapidApiKey) {
    try {
      const profiles: JSearchSearchParams[] = DEFAULT_JSEARCH_PROFILES.map((p) => ({
        ...p,
        numPages,
        datePosted,
      }));
      const all: DiscoveredListing[] = [];
      let creditsUsed = 0;
      for (const profile of profiles) {
        if (creditsUsedSoFar + creditsUsed + numPages > env.jsearchMonthlyCap) break;
        const result = await fetchJSearchListings(env.rapidApiKey, profile);
        all.push(...result.listings);
        creditsUsed += result.creditsUsed;
      }
      if (all.length > 0) {
        return { listings: all, source: "jsearch", jsearchCreditsUsed: creditsUsed };
      }
    } catch (error) {
      if (!(error instanceof JSearchQuotaError)) throw error;
    }
  }

  const listings = await fetchJobsBaseListings();
  return { listings, source: "jobsbase", jsearchCreditsUsed: 0 };
};
