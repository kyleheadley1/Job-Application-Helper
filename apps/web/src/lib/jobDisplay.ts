import type { ExtractedJobData, JobRecord, TrackerSpreadsheetFields } from "../types/job";
import { displayRoleTitle } from "./resultSummary";

export function jobHeaderLabel(extracted: Pick<ExtractedJobData, "company" | "title" | "employmentType">): string {
  const company = extracted.company?.trim();
  const title = displayRoleTitle(extracted.title?.trim() ?? "");
  if (company && title) return `${company} - ${title}`;
  if (title) return title;
  if (company) return company;
  return "Untitled role";
}

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

export function isAppliedPipelineStatus(status: JobRecord["status"]): boolean {
  return APPLICATION_STATUSES.has(status);
}

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

export function appliedAtIso(job: JobRecord): string {
  if (!isAppliedPipelineStatus(job.status)) return "";
  // Applied counters should only key off an explicit "applied" transition,
  // not later status transitions like "rejected" made on a different date.
  return earliestValidIso(
    (job.statusHistory ?? [])
      .filter((h) => h.toStatus === "applied")
      .map((h) => h.createdAt),
  );
}

function parseDiscussedDate(raw: string): Date | null {
  const text = raw.trim();
  if (!text) return null;

  const weekOf = text.match(/^week of\s+([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{2}|\d{4}))?$/i);
  if (weekOf) {
    const now = new Date();
    const year =
      weekOf[3] === undefined ? now.getFullYear() : weekOf[3].length === 2 ? 2000 + Number(weekOf[3]) : Number(weekOf[3]);
    const t = new Date(`${weekOf[1]} ${weekOf[2]}, ${year}`);
    if (!Number.isNaN(t.getTime())) return t;
  }

  // Excel serial dates are commonly imported as numeric strings.
  const asNum = Number(text);
  if (Number.isFinite(asNum) && asNum > 20000 && asNum < 90000) {
    const excelEpochMs = Date.UTC(1899, 11, 30);
    return new Date(excelEpochMs + Math.round(asNum) * 24 * 60 * 60 * 1000);
  }

  const mdY = text.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/);
  if (mdY) {
    const month = Number(mdY[1]);
    const day = Number(mdY[2]);
    const yearRaw = mdY[3];
    const year =
      yearRaw === undefined ? new Date().getFullYear() : yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(d.getTime())) return d;
  }

  const t = new Date(text);
  if (!Number.isNaN(t.getTime())) return t;
  return null;
}

export function formatTrackerDateCompact(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = { month: "numeric", day: "numeric" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "2-digit";
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

export type TrackerDisplayDate = {
  displayText: string;
  sortIso: string;
  source: "applied" | "discussed" | "added";
  sourceValue: string;
};

/**
 * Tracker-facing workflow date precedence:
 * 1) appliedAt (status history) when job has truly progressed to applied pipeline stage
 * 2) imported spreadsheet Discussed date (parsed when possible; raw text preserved)
 * 3) added/triaged timestamp (createdAt)
 */
export function trackerDisplayDate(job: JobRecord): TrackerDisplayDate {
  const applied = appliedAtIso(job);
  if (applied) {
    return {
      displayText: formatTrackerDateCompact(applied),
      sortIso: applied,
      source: "applied",
      sourceValue: applied,
    };
  }

  const discussedRaw = tsOnly(job, "discussed").trim();
  if (discussedRaw) {
    const parsed = parseDiscussedDate(discussedRaw);
    if (parsed) {
      const iso = parsed.toISOString();
      return {
        displayText: formatTrackerDateCompact(iso),
        sortIso: iso,
        source: "discussed",
        sourceValue: discussedRaw,
      };
    }
    return {
      displayText: discussedRaw,
      sortIso: job.createdAt,
      source: "discussed",
      sourceValue: discussedRaw,
    };
  }

  return {
    displayText: formatTrackerDateCompact(job.createdAt),
    sortIso: job.createdAt,
    source: "added",
    sourceValue: job.createdAt,
  };
}
