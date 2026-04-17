import type { JobRecord, TrackerSpreadsheetFields } from "../types/job";

/** Salary for display (internal structured fields). */
export function salaryAskLabel(job: JobRecord): string {
  const s = job.salaryAsk;
  if (typeof s.number === "number") return String(s.number);
  if (typeof s.rangeMin === "number" || typeof s.rangeMax === "number") {
    const min = typeof s.rangeMin === "number" ? String(s.rangeMin) : "";
    const max = typeof s.rangeMax === "number" ? String(s.rangeMax) : "";
    return [min, max].filter(Boolean).join(" – ");
  }
  return "";
}

/** Compact salary for dense table cells (full detail in `title` via `salaryAskLabel`). */
export function salaryAskCompact(job: JobRecord): string {
  const s = job.salaryAsk;
  const k = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
  if (typeof s.number === "number") {
    return s.number >= 1000 ? `$${k(s.number)}` : `$${s.number}`;
  }
  if (typeof s.rangeMin === "number" && typeof s.rangeMax === "number") {
    return `$${k(s.rangeMin)}–${k(s.rangeMax)}`;
  }
  if (typeof s.rangeMin === "number") return `$${k(s.rangeMin)}+`;
  if (typeof s.rangeMax === "number") return `≤$${k(s.rangeMax)}`;
  return "";
}

/** Full JD / pasted input for detail views (internal first, then seeded sheet cell). */
export function jdSourceText(job: JobRecord): string {
  const ts = job.trackerSpreadsheet ?? {};
  const fromExtracted =
    job.extracted.rawText?.trim() ||
    (job.extracted.url ? `URL: ${job.extracted.url}` : "") ||
    "";
  if (fromExtracted) return fromExtracted;
  const fromSheet = ts.jdInput !== undefined ? String(ts.jdInput) : "";
  return fromSheet.trim();
}

export function hasJdSource(job: JobRecord): boolean {
  return jdSourceText(job).length > 0;
}

export function tsOnly(job: JobRecord, key: keyof TrackerSpreadsheetFields): string {
  const ts = job.trackerSpreadsheet ?? {};
  return ts[key] !== undefined ? String(ts[key]) : "";
}

/** Compact timestamp for tracker list cells (full ISO in `title`). */
export function formatUpdatedAtCompact(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "2-digit";
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

const APPLICATION_STATUSES = new Set<JobRecord["status"]>([
  "applied",
  "interviewing",
  "assessment",
  "offer",
  "rejected",
]);

function earliestValidIso(values: Array<string | undefined>): string {
  const times = values
    .map((iso) => {
      if (!iso) return Number.NaN;
      const t = new Date(iso).getTime();
      return Number.isFinite(t) ? t : Number.NaN;
    })
    .filter((t) => Number.isFinite(t));
  if (!times.length) return "";
  return new Date(Math.min(...times)).toISOString();
}

function appliedAtIso(job: JobRecord): string {
  if (!APPLICATION_STATUSES.has(job.status)) return "";
  const fromHistory = earliestValidIso(
    (job.statusHistory ?? [])
      .filter((h) => APPLICATION_STATUSES.has(h.toStatus))
      .map((h) => h.createdAt),
  );
  return fromHistory || job.createdAt;
}

/**
 * Workflow date shown in tracker list:
 * - applied pipeline statuses => first application-related timestamp
 * - otherwise => earliest scored/added timestamp
 */
export function trackerListDateIso(job: JobRecord): string {
  const applied = appliedAtIso(job);
  if (applied) return applied;
  const scoredAt = earliestValidIso((job.scoreHistory ?? []).map((s) => s.scoredAt));
  return scoredAt || job.createdAt;
}
