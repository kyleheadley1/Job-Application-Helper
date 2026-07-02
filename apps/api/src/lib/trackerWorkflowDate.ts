import type { JobRecord, JobStatus } from "../types/job.js";
import { appliedAtIso } from "./trackerAutoArchive.js";

const APPLIED_PIPELINE_STATUSES = new Set<JobStatus>([
  "applied",
  "interviewing",
  "assessment",
  "offer",
  "rejected",
  "closed",
  "lapsed",
]);

const discussedFromSpreadsheet = (job: JobRecord): string =>
  (job.trackerSpreadsheet?.discussed ?? "").trim();

/** Parse spreadsheet "Discussed" cell — mirrors web trackerDisplayDate. */
export const parseDiscussedDate = (raw: string): Date | null => {
  const text = raw.trim();
  if (!text) return null;

  const weekOf = text.match(/^week of\s+([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{2}|\d{4}))?$/i);
  if (weekOf) {
    const now = new Date();
    const year =
      weekOf[3] === undefined
        ? now.getFullYear()
        : weekOf[3].length === 2
          ? 2000 + Number(weekOf[3])
          : Number(weekOf[3]);
    const t = new Date(`${weekOf[1]} ${weekOf[2]}, ${year}`);
    if (!Number.isNaN(t.getTime())) return t;
  }

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
      yearRaw === undefined
        ? new Date().getFullYear()
        : yearRaw.length === 2
          ? 2000 + Number(yearRaw)
          : Number(yearRaw);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(d.getTime())) return d;
  }

  const t = new Date(text);
  if (!Number.isNaN(t.getTime())) return t;
  return null;
};

/**
 * Best-effort apply / workflow date for shortlist freshness:
 * 1) status-history appliedAt when in applied pipeline
 * 2) parsed spreadsheet Discussed date
 * 3) createdAt
 */
export const resolveTrackerActivityDate = (job: JobRecord): string => {
  if (APPLIED_PIPELINE_STATUSES.has(job.status)) {
    const applied = appliedAtIso(job);
    if (applied) return applied;
  }

  const discussedRaw = discussedFromSpreadsheet(job);
  if (discussedRaw) {
    const parsed = parseDiscussedDate(discussedRaw);
    if (parsed) return parsed.toISOString();
  }

  return job.createdAt;
};
