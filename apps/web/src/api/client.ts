import type { JobRecord, JobStatus } from "../types/job";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const text = await response.text();
  if (!response.ok) {
    let suffix = "";
    try {
      const body = JSON.parse(text) as { message?: string; detail?: string; issues?: unknown };
      if (body.message) suffix = `: ${body.message}`;
      if (body.detail) suffix += ` — ${body.detail}`;
      if (body.issues) suffix += ` ${JSON.stringify(body.issues)}`;
    } catch {
      if (text.trim()) suffix = `: ${text.slice(0, 500)}`;
    }
    throw new Error(`API error: ${response.status}${suffix}`);
  }
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
};

const fetchCsv = async (path: string): Promise<string> => {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.text();
};

export const api = {
  triage: (payload: { url?: string; rawText?: string; companyHint?: string; fullPrep?: boolean }) =>
    request<JobRecord & { tracked?: boolean; canConfirmApplied?: boolean }>("/jobs/triage", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listJobs: (query = "") =>
    request<{ items: JobRecord[]; total: number; totalAll?: number }>(`/jobs${query}`),
  getJob: (id: string) =>
    request<JobRecord & { statusHistory?: unknown[]; tracked?: boolean; canConfirmApplied?: boolean }>(
      `/jobs/${id}`,
    ),
  confirmApplied: (id: string) => request<JobRecord>(`/jobs/${id}/confirm-applied`, { method: "POST" }),
  updateStatus: (id: string, status: JobStatus, note?: string) =>
    request<JobRecord>(`/jobs/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, note }) }),
  updateNotes: (id: string, notes: string) =>
    request<JobRecord>(`/jobs/${id}/notes`, { method: "PATCH", body: JSON.stringify({ notes }) }),
  deleteJob: async (id: string) => {
    const response = await fetch(`${API_BASE}/jobs/${id}`, { method: "DELETE" });
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
  },
  exportJobs: (query = "") =>
    request<{
      rows: Array<{
        Company: string;
        Role: string;
        "Latest Score": number;
        "Recommended Action": string;
        "Salary Ask": string;
        "Top Match": string;
        "Main Risk": string;
        Resume: JobRecord["recommendedResume"];
        "Status / Outcome": string;
        Shortlist: boolean;
        Notes: string;
        "Created At": string;
        "Updated At": string;
      }>;
      total: number;
    }>(`/jobs/export${query}`),
  exportJobsCsv: (query = "") => fetchCsv(`/jobs/export${query}${query ? "&" : "?"}format=csv`),
  regenerateAssets: (id: string, force = false) =>
    request<JobRecord>(`/jobs/${id}/generate-assets`, { method: "POST", body: JSON.stringify({ force }) }),
};
