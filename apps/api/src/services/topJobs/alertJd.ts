import { logger } from "../../lib/logger.js";
import type { AlertPlatform } from "../../types/topJob.js";
import { normalizeCompany } from "../gmail/gmailApplications.js";
import { fetchPosting, PostingFetchError, type FetchedPosting } from "../gmail/jdRecovery/fetchPosting.js";
import { ATS_SITE_FILTER, rankSerperResults } from "../gmail/jdRecovery/runRecovery.js";
import { serperClient, serperUsageRepository } from "../gmail/jdRecovery/serperClient.js";
import { normalizeForMatch, strictTitleSimilarity, titleInText } from "../gmail/jdRecovery/titleMatch.js";
import type { AlertListingDoc } from "./alertListings.repository.js";

/** Job pages on these hosts sit behind bot protection, so only a search for the employer's posting works. */
const BOT_BLOCKED_HOST_RE = /(^|\.)(indeed|indeedemail|ziprecruiter)\.com$/i;
const PLATFORM_ORDER: AlertPlatform[] = ["linkedin", "remotehunter", "indeed", "ziprecruiter"];
const SERPER_RESULTS_TRIED = 2;
const TITLE_MATCH_MIN = 0.6;
const HEAD_CHARS = 3000;

export type AlertJd =
  | { ok: true; posting: FetchedPosting; platform: AlertPlatform; alertUrl: string | null; viaSearch: boolean; serperQueries: number }
  | { ok: false; reason: string; serperQueries: number; closed?: boolean };

export type AlertJdDeps = {
  fetch: (url: string) => Promise<FetchedPosting>;
  search: (query: string) => Promise<Array<{ title: string; link: string }>>;
  searchBudgetLeft: () => Promise<boolean>;
  recordSearch: (key: string) => Promise<void>;
};

const defaultDeps: AlertJdDeps = {
  fetch: fetchPosting,
  search: (q) => serperClient.search(q),
  searchBudgetLeft: async () => {
    if (!serperClient.isConfigured()) return false;
    const usage = await serperUsageRepository.get();
    return usage.queries < usage.cap;
  },
  recordSearch: (key) => serperUsageRepository.record(`alert:${key}`, 1),
};

const isBotBlocked = (url: string): boolean => {
  try {
    return BOT_BLOCKED_HOST_RE.test(new URL(url).hostname);
  } catch {
    return true;
  }
};

/** The fetched page is for this role: same title, and (for search hits) the same employer. */
export const postingMatchesListing = (
  listing: Pick<AlertListingDoc, "title" | "company">,
  posting: Pick<FetchedPosting, "title" | "company" | "text">,
  requireCompany: boolean,
): boolean => {
  const head = normalizeForMatch(posting.text.slice(0, HEAD_CHARS));
  const titleOk =
    (posting.title ? strictTitleSimilarity(listing.title, posting.title) >= TITLE_MATCH_MIN : false) ||
    titleInText(listing.title, head);
  if (!titleOk) return false;
  if (!requireCompany) return true;
  const company = normalizeCompany(listing.company);
  if (!company) return false;
  return (
    (posting.company ? normalizeCompany(posting.company) === company : false) ||
    ` ${normalizeForMatch(posting.text)} `.includes(` ${company} `)
  );
};

export const orderedLinks = (listing: Pick<AlertListingDoc, "links">): AlertListingDoc["links"] =>
  [...listing.links].sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));

export const resolveAlertJd = async (listing: AlertListingDoc, deps: AlertJdDeps = defaultDeps): Promise<AlertJd> => {
  const links = orderedLinks(listing);
  const notes: string[] = [];

  for (const link of links) {
    if (isBotBlocked(link.url)) continue;
    try {
      const posting = await deps.fetch(link.url);
      if (postingMatchesListing(listing, posting, false)) {
        return { ok: true, posting, platform: link.platform, alertUrl: link.url, viaSearch: false, serperQueries: 0 };
      }
      notes.push(`${link.platform}: different role`);
    } catch (error) {
      if (error instanceof PostingFetchError && error.reason === "closed") {
        return { ok: false, reason: "closed", serperQueries: 0, closed: true };
      }
      notes.push(`${link.platform}: ${error instanceof Error ? error.message.slice(0, 80) : "error"}`);
    }
  }

  if (!(await deps.searchBudgetLeft())) {
    return { ok: false, reason: notes.length ? notes.join("; ") : "no fetchable link and no search budget", serperQueries: 0 };
  }

  const query = `"${listing.company}" "${listing.title}" ${ATS_SITE_FILTER}`;
  try {
    const results = await deps.search(query);
    await deps.recordSearch(listing._id);
    for (const url of rankSerperResults(results).slice(0, SERPER_RESULTS_TRIED)) {
      try {
        const posting = await deps.fetch(url);
        if (postingMatchesListing(listing, posting, true)) {
          const first = links[0];
          return {
            ok: true,
            posting,
            platform: first?.platform ?? listing.platforms[0] ?? "linkedin",
            alertUrl: first?.url ?? null,
            viaSearch: true,
            serperQueries: 1,
          };
        }
      } catch {
        // try the next result
      }
    }
    return { ok: false, reason: "search found no matching posting", serperQueries: 1 };
  } catch (error) {
    logger.warn("Alert JD search failed", { key: listing._id, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, reason: "search failed", serperQueries: 0 };
  }
};
