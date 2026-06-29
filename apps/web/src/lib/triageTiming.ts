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

/** Relative time since first scored — uses h/d for large values, not raw minutes. */
export const formatRelativeScoredAt = (iso: string, nowMs = Date.now()): string => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "unknown";
  const deltaMs = Math.max(0, nowMs - then);
  const totalMinutes = Math.floor(deltaMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours >= 1) return `${hours}h ago`;
  if (totalMinutes >= 1) return `${totalMinutes}m ago`;
  const seconds = Math.floor(deltaMs / 1000);
  return `${seconds}s ago`;
};

export const firstScoredAtIso = (job: {
  createdAt: string;
  scoreHistory?: Array<{ scoredAt: string }>;
}): string => job.scoreHistory?.[0]?.scoredAt ?? job.createdAt;

/** True when elapsed ms looks like an in-session triage run, not time-since-first-scored. */
export const isPlausibleTriageDuration = (ms: number): boolean =>
  ms >= 0 && ms <= 10 * 60 * 1000;

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
