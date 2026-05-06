export type TriageTimingPayload = {
  startedAt: number;
};

export type StoredTriageTiming = {
  startedAt: number;
  finishedMs: number;
};

export const triageTimingStorageKey = (jobId: string): string => `triageTiming:${jobId}`;

export const formatDuration = (ms: number): string => {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
};

export type TriageProgressPhase =
  | "idle"
  | "submitted"
  | "triage_request_in_flight"
  | "triage_response_received"
  | "result_fetch_in_flight"
  | "result_ready";

/** Milestone-based progress to avoid rushing to ~90% then stalling. */
export const progressForPhase = (phase: TriageProgressPhase): number => {
  switch (phase) {
    case "submitted":
      return 8;
    case "triage_request_in_flight":
      return 45;
    case "triage_response_received":
      return 70;
    case "result_fetch_in_flight":
      return 85;
    case "result_ready":
      return 100;
    case "idle":
    default:
      return 0;
  }
};

export const readStoredTriageTiming = (jobId: string): StoredTriageTiming | null => {
  try {
    const raw = sessionStorage.getItem(triageTimingStorageKey(jobId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTriageTiming>;
    if (typeof parsed.startedAt !== "number" || typeof parsed.finishedMs !== "number") return null;
    return { startedAt: parsed.startedAt, finishedMs: parsed.finishedMs };
  } catch {
    return null;
  }
};

export const writeStoredTriageTiming = (jobId: string, value: StoredTriageTiming): void => {
  try {
    sessionStorage.setItem(triageTimingStorageKey(jobId), JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
};
