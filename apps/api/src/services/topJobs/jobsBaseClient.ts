import { logger } from "../../lib/logger.js";
import type { DiscoveredListing } from "../../types/topJob.js";

const JOBS_BASE_URL = "https://jobsbase.io/api/v1/jobs";

type JobsBaseJob = {
  id?: string | number;
  company?: string;
  title?: string;
  description?: string;
  apply_url?: string;
  job_url?: string;
  url?: string;
  display_location?: string;
  location?: string;
  workplace?: string;
  posted_at?: string;
  updated_at?: string;
};

type JobsBaseResponse = {
  jobs?: JobsBaseJob[];
  data?: JobsBaseJob[];
  items?: JobsBaseJob[];
};

const stripHtml = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeJobsBaseJob = (job: JobsBaseJob): DiscoveredListing | null => {
  const externalId = job.id != null ? String(job.id) : "";
  const company = job.company?.trim();
  const title = job.title?.trim();
  const description = stripHtml(job.description ?? "");
  const applyUrl = (job.apply_url ?? job.job_url ?? job.url ?? "").trim();
  const posted = job.posted_at ?? job.updated_at ?? new Date().toISOString();

  if (!externalId || !company || !title || !description || !applyUrl) return null;

  const sourcePostedAt = new Date(posted).toISOString();
  return {
    source: "jobsbase",
    externalId,
    company,
    title,
    description,
    applyUrl,
    location: (job.display_location ?? job.location)?.trim(),
    remote: job.workplace?.toLowerCase() === "remote",
    sourcePostedAt,
    sourceUpdatedAt: job.updated_at ? new Date(job.updated_at).toISOString() : sourcePostedAt,
  };
};

const fetchJobsBaseJobDetail = async (id: string): Promise<JobsBaseJob | null> => {
  const response = await fetch(`${JOBS_BASE_URL}/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Jobs Base detail failed: ${response.status}`);
  }
  return (await response.json()) as JobsBaseJob;
};

const enrichWithDescriptions = async (jobs: JobsBaseJob[]): Promise<JobsBaseJob[]> => {
  const out: JobsBaseJob[] = [];
  for (const job of jobs) {
    if (stripHtml(job.description ?? "").length >= 200) {
      out.push(job);
      continue;
    }
    const id = job.id != null ? String(job.id) : "";
    if (!id) continue;
    try {
      const detail = await fetchJobsBaseJobDetail(id);
      out.push(detail ? { ...job, ...detail } : job);
    } catch (error) {
      logger.warn("Jobs Base detail fetch failed", {
        id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
};

const searchJobsBase = async (params: URLSearchParams): Promise<JobsBaseJob[]> => {
  const response = await fetch(`${JOBS_BASE_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Jobs Base request failed: ${response.status}`);
  }
  const body = (await response.json()) as JobsBaseResponse;
  return body.jobs ?? body.data ?? body.items ?? [];
};

/** Jobs Base list responses omit descriptions — detail fetch is required for triage. */
export const fetchJobsBaseListings = async (): Promise<DiscoveredListing[]> => {
  const queries = [
    new URLSearchParams({
      q: "entry level software engineer typescript",
      workplace: "remote",
      country: "US",
      posted_within: "14d",
      sort: "posted_at",
      limit: "30",
    }),
    new URLSearchParams({
      q: "junior software engineer",
      workplace: "remote",
      country: "US",
      posted_within: "14d",
      sort: "posted_at",
      limit: "30",
    }),
    new URLSearchParams({
      q: "software engineer",
      workplace: "remote",
      sort: "posted_at",
      limit: "30",
    }),
  ];

  const seen = new Set<string>();
  const raw: JobsBaseJob[] = [];
  for (const params of queries) {
    const batch = await searchJobsBase(params);
    for (const job of batch) {
      const id = job.id != null ? String(job.id) : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      raw.push(job);
    }
    if (raw.length >= 30) break;
  }

  const enriched = await enrichWithDescriptions(raw.slice(0, 30));
  return enriched.map(normalizeJobsBaseJob).filter((l): l is DiscoveredListing => l !== null);
};
