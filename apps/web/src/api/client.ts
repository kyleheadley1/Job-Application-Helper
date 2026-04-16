import type { JobRecord, JobStatus } from "../types/job";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return (await response.json()) as T;
};

export const api = {
  triage: (payload: { url?: string; rawText?: string; companyHint?: string; fullPrep?: boolean }) =>
    request<JobRecord>("/jobs/triage", { method: "POST", body: JSON.stringify(payload) }),
  listJobs: (query = "") => request<{ items: JobRecord[]; total: number }>(`/jobs${query}`),
  getJob: (id: string) => request<JobRecord & { statusHistory?: unknown[] }>(`/jobs/${id}`),
  updateStatus: (id: string, status: JobStatus, note?: string) =>
    request<JobRecord>(`/jobs/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, note }) }),
  regenerateAssets: (id: string, force = true) =>
    request<JobRecord>(`/jobs/${id}/generate-assets`, { method: "POST", body: JSON.stringify({ force }) }),
};
