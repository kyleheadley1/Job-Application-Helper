import type { DiscoveredListing } from "../../types/topJob.js";

const JOBS_BASE_URL = "https://jobsbase.io/api/v1/jobs";

type JobsBaseJob = {
  id?: string | number;
  company?: string;
  title?: string;
  description?: string;
  apply_url?: string;
  url?: string;
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
  const applyUrl = (job.apply_url ?? job.url ?? "").trim();
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
    location: job.location?.trim(),
    remote: job.workplace?.toLowerCase() === "remote",
    sourcePostedAt,
    sourceUpdatedAt: job.updated_at ? new Date(job.updated_at).toISOString() : sourcePostedAt,
  };
};

export const fetchJobsBaseListings = async (): Promise<DiscoveredListing[]> => {
  const params = new URLSearchParams({
    q: "software engineer typescript",
    workplace: "remote",
    seniority_level: "entry,internship",
    country: "US",
    posted_within: "30d",
    sort: "posted_at",
    limit: "100",
  });

  const response = await fetch(`${JOBS_BASE_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Jobs Base request failed: ${response.status}`);
  }

  const body = (await response.json()) as JobsBaseResponse;
  const raw = body.jobs ?? body.data ?? body.items ?? [];
  return raw.map(normalizeJobsBaseJob).filter((l): l is DiscoveredListing => l !== null);
};
