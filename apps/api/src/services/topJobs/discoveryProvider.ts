import { env } from "../../config/env.js";
import type { DiscoveredListing, TopJobSource } from "../../types/topJob.js";
import { logger } from "../../lib/logger.js";
import {
  DEFAULT_JSEARCH_PROFILES,
  fetchJSearchListings,
  JSearchQuotaError,
  type JSearchSearchParams,
} from "./jsearchClient.js";
import { fetchJobsBaseListings } from "./jobsBaseClient.js";
import {
  filterListingsByMaxAge,
  mergeDiscoveredListings,
  resolveDiscoverySourceLabel,
} from "./listingMerge.js";

export type DiscoveryFetchResult = {
  listings: DiscoveredListing[];
  source: TopJobSource | "mixed";
  jsearchCreditsUsed: number;
  jsearchCount: number;
  jobsbaseCount: number;
};

const fetchFromJSearch = async (options: {
  jsearchCreditsUsedThisMonth: number;
  numPages: number;
  datePosted: string;
}): Promise<{ listings: DiscoveredListing[]; creditsUsed: number }> => {
  if (!env.rapidApiKey) {
    return { listings: [], creditsUsed: 0 };
  }

  const profiles: JSearchSearchParams[] = DEFAULT_JSEARCH_PROFILES.map((p) => ({
    ...p,
    numPages: options.numPages,
    datePosted: options.datePosted,
  }));

  const all: DiscoveredListing[] = [];
  let creditsUsed = 0;

  for (const profile of profiles) {
    if (
      options.jsearchCreditsUsedThisMonth + creditsUsed + options.numPages >
      env.jsearchMonthlyCap
    ) {
      break;
    }
    const result = await fetchJSearchListings(env.rapidApiKey, profile);
    all.push(...result.listings);
    creditsUsed += result.creditsUsed;
  }

  return { listings: all, creditsUsed };
};

export const fetchDiscoveredListings = async (options?: {
  forceSource?: "jsearch" | "jobsbase" | "auto";
  jsearchCreditsUsedThisMonth?: number;
  numPages?: number;
  datePosted?: string;
}): Promise<DiscoveryFetchResult> => {
  const mode = options?.forceSource ?? env.topJobsSource;
  const creditsUsedSoFar = options?.jsearchCreditsUsedThisMonth ?? 0;
  const numPages = options?.numPages ?? env.jsearchNumPages;
  const datePosted = options?.datePosted ?? env.jsearchDatePosted;
  const maxAgeDays = env.topJobsListingMaxAgeDays;

  let jsearchListings: DiscoveredListing[] = [];
  let jobsbaseListings: DiscoveredListing[] = [];
  let jsearchCreditsUsed = 0;

  const wantJSearch = mode === "auto" || mode === "jsearch";
  const wantJobsBase = mode === "auto" || mode === "jobsbase";

  const jsearchPromise =
    wantJSearch && env.rapidApiKey && creditsUsedSoFar < env.jsearchMonthlyCap
      ? fetchFromJSearch({ jsearchCreditsUsedThisMonth: creditsUsedSoFar, numPages, datePosted }).catch(
          (error) => {
            if (error instanceof JSearchQuotaError) {
              logger.warn("JSearch quota exhausted during discovery", {
                message: error.message,
              });
              return { listings: [], creditsUsed: 0 };
            }
            throw error;
          },
        )
      : Promise.resolve({ listings: [], creditsUsed: 0 });

  const jobsbasePromise = wantJobsBase
    ? fetchJobsBaseListings().catch((error) => {
        logger.warn("Jobs Base discovery failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        return [] as DiscoveredListing[];
      })
    : Promise.resolve([] as DiscoveredListing[]);

  if (wantJSearch && !env.rapidApiKey) {
    logger.warn("RAPIDAPI_KEY not set; skipping JSearch in discovery");
  }

  const [jsearchResult, jobsbaseResult] = await Promise.all([jsearchPromise, jobsbasePromise]);
  jsearchListings = jsearchResult.listings;
  jsearchCreditsUsed = jsearchResult.creditsUsed;
  jobsbaseListings = jobsbaseResult;

  const merged =
    mode === "jsearch"
      ? jsearchListings
      : mode === "jobsbase"
        ? jobsbaseListings
        : mergeDiscoveredListings(jsearchListings, jobsbaseListings);

  const listings = filterListingsByMaxAge(merged, maxAgeDays);

  const jsearchCount = listings.filter((l) => l.source === "jsearch").length;
  const jobsbaseCount = listings.filter((l) => l.source === "jobsbase").length;

  return {
    listings,
    source: resolveDiscoverySourceLabel(jsearchCount, jobsbaseCount),
    jsearchCreditsUsed,
    jsearchCount,
    jobsbaseCount,
  };
};
