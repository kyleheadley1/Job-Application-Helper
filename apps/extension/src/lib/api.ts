import { loadSettings } from "./settings";

export type CaptureMethod = "selection" | "jsonld" | "container" | "paste";
export type CaptureStatus = "queued" | "scoring" | "complete" | "failed";

export type CaptureSummary = {
  company: string;
  title: string;
  scoreTotal: number;
  recommendation: string;
  recommendationLabel?: string;
  recommendedResume: string;
  hardGate?: string;
  mainRisk?: string;
};

export type CaptureView = {
  id: string;
  status: CaptureStatus;
  error?: string;
  jobId?: string;
  sourceUrl?: string;
  pageTitle?: string;
  captureMethod: CaptureMethod;
  createdAt: string;
  updatedAt: string;
  summary?: CaptureSummary;
  deduped?: boolean;
};

export type CreateCaptureInput = {
  sourceUrl?: string;
  pageTitle?: string;
  jdText: string;
  captureMethod: CaptureMethod;
  force?: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const { apiBaseUrl, token } = await loadSettings();
  if (!token) {
    throw new ApiError("Add your extension token in Settings first.", 401);
  }
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(`Can't reach the API at ${apiBaseUrl}. Is npm run dev running?`, 0);
  }
  const text = await response.text();
  const body = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const issues = Array.isArray(body.issues)
      ? (body.issues as Array<{ message?: string }>).map((i) => i.message).filter(Boolean).join("; ")
      : "";
    const message =
      issues || (typeof body.message === "string" ? body.message : `Request failed (${response.status})`);
    throw new ApiError(message, response.status);
  }
  return body as T;
};

export const api = {
  createCapture: (input: CreateCaptureInput) =>
    request<CaptureView>("/job-captures", { method: "POST", body: JSON.stringify(input) }),
  getCapture: (id: string) => request<CaptureView>(`/job-captures/${encodeURIComponent(id)}`),
  listCaptures: (limit = 8) =>
    request<{ items: CaptureView[] }>(`/job-captures?limit=${limit}`),
};
