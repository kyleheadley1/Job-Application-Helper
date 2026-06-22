import type { DiscoveredListing } from "../../types/topJob.js";

export type JSearchSearchParams = {
  query: string;
  country?: string;
  datePosted?: string;
  workFromHome?: boolean;
  location?: string;
  jobRequirements?: string;
  numPages?: number;
};

type JSearchJob = {
  job_id?: string;
  employer_name?: string;
  job_title?: string;
  job_description?: string;
  job_apply_link?: string;
  job_google_link?: string;
  job_posted_at_datetime_utc?: string;
  job_posted_at_timestamp?: number;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_is_remote?: boolean;
};

type JSearchResponse = {
  status?: string;
  data?: JSearchJob[];
  message?: string;
};

const JSEARCH_HOST = "jsearch.p.rapidapi.com";

export class JSearchQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JSearchQuotaError";
  }
}

const stripHtml = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toIsoDate = (job: JSearchJob): string => {
  if (job.job_posted_at_datetime_utc) {
    const d = new Date(job.job_posted_at_datetime_utc);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (job.job_posted_at_timestamp) {
    const d = new Date(job.job_posted_at_timestamp * 1000);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
};

export const normalizeJSearchJob = (job: JSearchJob): DiscoveredListing | null => {
  const externalId = job.job_id?.trim();
  const company = job.employer_name?.trim();
  const title = job.job_title?.trim();
  const description = stripHtml(job.job_description ?? "");
  const applyUrl = (job.job_apply_link ?? job.job_google_link ?? "").trim();

  if (!externalId || !company || !title || !description || !applyUrl) return null;

  const sourcePostedAt = toIsoDate(job);
  const locationParts = [job.job_city, job.job_state, job.job_country].filter(Boolean);
  return {
    source: "jsearch",
    externalId,
    company,
    title,
    description,
    applyUrl,
    location: locationParts.length ? locationParts.join(", ") : undefined,
    remote: job.job_is_remote ?? undefined,
    sourcePostedAt,
    sourceUpdatedAt: sourcePostedAt,
  };
};

export const fetchJSearchListings = async (
  apiKey: string,
  params: JSearchSearchParams,
): Promise<{ listings: DiscoveredListing[]; creditsUsed: number }> => {
  const searchParams = new URLSearchParams();
  searchParams.set("query", params.query);
  searchParams.set("country", params.country ?? "us");
  searchParams.set("date_posted", params.datePosted ?? "week");
  searchParams.set("num_pages", String(params.numPages ?? 2));
  if (params.workFromHome) searchParams.set("work_from_home", "true");
  if (params.location) searchParams.set("location", params.location);
  if (params.jobRequirements) searchParams.set("job_requirements", params.jobRequirements);

  const url = `https://${JSEARCH_HOST}/search?${searchParams.toString()}`;
  const response = await fetch(url, {
    headers: {
      "x-rapidapi-host": JSEARCH_HOST,
      "x-rapidapi-key": apiKey,
    },
  });

  if (response.status === 429 || response.status === 403) {
    throw new JSearchQuotaError(`JSearch quota or auth error: ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`JSearch request failed: ${response.status}`);
  }

  const body = (await response.json()) as JSearchResponse;
  if (/quota|limit|exceeded/i.test(body.message ?? "")) {
    throw new JSearchQuotaError(body.message ?? "JSearch quota exceeded");
  }

  const listings = (body.data ?? [])
    .map(normalizeJSearchJob)
    .filter((l): l is DiscoveredListing => l !== null);

  return { listings, creditsUsed: params.numPages ?? 2 };
};

export const DEFAULT_JSEARCH_PROFILES: JSearchSearchParams[] = [
  {
    query: "entry level software engineer typescript",
    country: "us",
    datePosted: "week",
    workFromHome: true,
    jobRequirements: "under_3_years_experience,no_experience,no_degree",
  },
  {
    query: "junior full stack engineer",
    country: "us",
    datePosted: "week",
    location: "New York, NY",
    jobRequirements: "under_3_years_experience,no_experience,no_degree",
  },
];
