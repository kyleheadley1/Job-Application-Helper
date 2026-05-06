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

/** Smoothly approaches ~92% while waiting for server completion. */
export const computeVisualProgress = (elapsedMs: number): number => {
  const eased = 100 * (1 - Math.exp(-Math.max(0, elapsedMs) / 6000));
  return Math.min(92, Math.max(5, eased));
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
