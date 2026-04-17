import { Fragment, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { JobRecord, JobStatus } from "../types/job";
import { ScoreBadge } from "../components/ScoreBadge";
import { StatusBadge } from "../components/StatusBadge";
import { FilterBar } from "../components/FilterBar";
import {
  hasJdSource,
  salaryAskCompact,
  salaryAskLabel,
  trackerDisplayDate,
  tsOnly,
} from "../lib/jobDisplay";

const LS_SHOW_EXTRAS = "trackerShowSheetCols";
const LS_SORT_KEY = "trackerSortKey";
const LS_SORT_DIR = "trackerSortDir";

const PRIMARY_COLUMNS = [
  "company",
  "role",
  "score",
  "recommendedAction",
  "status",
  "resume",
  "topMatch",
  "mainRisk",
  "salary",
  "notes",
  "updatedAt",
] as const;

const EXTRA_COLUMNS = ["rank", "discussed", "originalAlt", "priority"] as const;

type PrimaryColumn = (typeof PRIMARY_COLUMNS)[number];
type ExtraColumn = (typeof EXTRA_COLUMNS)[number];

/** Columns that support sort (pipeline order for status — not alphabetical). */
const SORTABLE_KEYS = [
  "company",
  "role",
  "score",
  "status",
  "resume",
  "salary",
  "updatedAt",
  "rank",
  "priority",
] as const;

type TrackerSortKey = (typeof SORTABLE_KEYS)[number];

type SortDir = "asc" | "desc";

function readLs(key: string, fallback: string): string {
  if (typeof localStorage === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function isSortableKey(key: string): key is TrackerSortKey {
  return (SORTABLE_KEYS as readonly string[]).includes(key);
}

function companyCell(job: JobRecord): string {
  return job.extracted.company || tsOnly(job, "company");
}

function roleCell(job: JobRecord): string {
  return job.extracted.title || tsOnly(job, "role");
}

function statusText(job: JobRecord): string {
  return (job.tracker.statusOutcome ?? job.status).trim() || job.status;
}

function normalizeStatusText(s: string): string {
  return s.trim().toLowerCase().replace(/[_\s-]+/g, " ");
}

function statusSecondaryText(job: JobRecord): string {
  const outcome = (job.tracker.statusOutcome ?? "").trim();
  if (!outcome) return "";
  return normalizeStatusText(outcome) === normalizeStatusText(job.status) ? "" : outcome;
}

function trackerDateMs(job: JobRecord): number {
  const t = new Date(trackerDisplayDate(job).sortIso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function salarySortValue(job: JobRecord): number {
  const s = job.salaryAsk;
  if (typeof s.number === "number") return s.number;
  if (typeof s.rangeMin === "number") return s.rangeMin;
  if (typeof s.rangeMax === "number") return s.rangeMax;
  return Number.NaN;
}

function rankSortValue(job: JobRecord): number {
  const r = tsOnly(job, "rank").trim();
  if (!r) return Number.NaN;
  const n = Number(r.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Workflow / pipeline order (best progress first). */
const STATUS_ORDER: JobStatus[] = [
  "offer",
  "interviewing",
  "assessment",
  "applied",
  "to_review",
  "skip",
  "rejected",
  "closed",
];

function statusRank(s: JobStatus): number {
  const i = STATUS_ORDER.indexOf(s);
  return i === -1 ? 99 : i;
}

function compareJobs(a: JobRecord, b: JobRecord, key: TrackerSortKey, dir: SortDir): number {
  const m = dir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (key) {
    case "company":
      cmp = companyCell(a).localeCompare(companyCell(b), undefined, { sensitivity: "base" });
      break;
    case "role":
      cmp = roleCell(a).localeCompare(roleCell(b), undefined, { sensitivity: "base" });
      break;
    case "score":
      cmp = a.score.total - b.score.total;
      break;
    case "status":
      cmp = statusRank(a.status) - statusRank(b.status);
      if (cmp === 0) cmp = statusText(a).localeCompare(statusText(b), undefined, { sensitivity: "base" });
      break;
    case "resume":
      cmp = a.recommendedResume.localeCompare(b.recommendedResume);
      break;
    case "salary": {
      const va = salarySortValue(a);
      const vb = salarySortValue(b);
      const na = Number.isFinite(va) ? va : -1;
      const nb = Number.isFinite(vb) ? vb : -1;
      cmp = na - nb;
      break;
    }
    case "updatedAt":
      cmp = trackerDateMs(a) - trackerDateMs(b);
      break;
    case "rank": {
      const ra = rankSortValue(a);
      const rb = rankSortValue(b);
      cmp = (Number.isFinite(ra) ? ra : 1e9) - (Number.isFinite(rb) ? rb : 1e9);
      break;
    }
    case "priority":
      cmp = (a.tracker.priority ?? tsOnly(a, "priority")).localeCompare(
        b.tracker.priority ?? tsOnly(b, "priority"),
        undefined,
        { sensitivity: "base" },
      );
      break;
    default:
      cmp = 0;
  }
  return cmp * m;
}

function defaultDirForKey(key: TrackerSortKey): SortDir {
  if (key === "updatedAt" || key === "score" || key === "rank") return "desc";
  return "asc";
}

const queryString = (params: Record<string, string | boolean | undefined>): string => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, value]) => {
    if (value === undefined || value === "") return;
    q.set(k, String(value));
  });
  const out = q.toString();
  return out ? `?${out}` : "";
};

export const TrackerPage = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [totalAll, setTotalAll] = useState(0);
  const [status, setStatus] = useState("");
  const [company, setCompany] = useState("");
  const [resume, setResume] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [minScore, setMinScore] = useState("");
  const [shortlistOnly, setShortlistOnly] = useState(false);
  const [showExtras, setShowExtras] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(LS_SHOW_EXTRAS) === "1",
  );

  const [sortKey, setSortKey] = useState<TrackerSortKey>(() => {
    const k = readLs(LS_SORT_KEY, "updatedAt");
    return isSortableKey(k) ? k : "updatedAt";
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    const d = readLs(LS_SORT_DIR, "desc");
    return d === "asc" || d === "desc" ? d : "desc";
  });

  useEffect(() => {
    localStorage.setItem(LS_SHOW_EXTRAS, showExtras ? "1" : "0");
  }, [showExtras]);

  useEffect(() => {
    localStorage.setItem(LS_SORT_KEY, sortKey);
    localStorage.setItem(LS_SORT_DIR, sortDir);
  }, [sortKey, sortDir]);

  const query = useMemo(
    () =>
      queryString({
        status,
        company,
        resume,
        recommendation,
        minScore,
        shortlist: shortlistOnly ? true : undefined,
      }),
    [status, company, resume, recommendation, minScore, shortlistOnly],
  );

  useEffect(() => {
    api.listJobs(query).then((res) => {
      setJobs(res.items);
      setTotalAll(typeof res.totalAll === "number" ? res.totalAll : res.total);
    });
  }, [query]);

  const sortedJobs = useMemo(() => {
    const copy = [...jobs];
    copy.sort((a, b) => compareJobs(a, b, sortKey, sortDir));
    return copy;
  }, [jobs, sortKey, sortDir]);

  const shortlistInView = useMemo(
    () => jobs.filter((j) => j.tracker.shortlist).length,
    [jobs],
  );

  const exportFilename = (ext: string) => {
    const d = new Date().toISOString().slice(0, 10);
    return `tracker-export-${d}.${ext}`;
  };

  const onHeaderSort = (col: TrackerSortKey) => {
    if (col === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir(defaultDirForKey(col));
    }
  };

  const sortIndicator = (col: TrackerSortKey) => {
    if (sortKey !== col) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  const renderSortableTh = (col: TrackerSortKey, label: string, className: string) => (
    <th scope="col" className={className}>
      <button type="button" className="tracker-sort-btn" onClick={() => onHeaderSort(col)}>
        {label}
        <span className="tracker-sort-ind">{sortIndicator(col)}</span>
      </button>
    </th>
  );

  const renderPlainTh = (label: string, className: string) => (
    <th scope="col" className={className}>
      {label}
    </th>
  );

  const rowNavigate = (e: MouseEvent<HTMLTableRowElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("a,button,input,textarea,select,label")) return;
    const sel =
      typeof window !== "undefined" ? window.getSelection()?.toString().trim() ?? "" : "";
    if (sel.length > 0) return;
    const id = e.currentTarget.dataset.jobId;
    if (id) navigate(`/jobs/${id}/detail`);
  };

  const renderPrimaryCell = (job: JobRecord, col: PrimaryColumn) => {
    switch (col) {
      case "company":
        return (
          <div className="tracker-company-cell">
            <Link
              to={`/jobs/${job.id}/detail`}
              className="tracker-link"
              onClick={(e) => e.stopPropagation()}
            >
              {companyCell(job)}
            </Link>
            {hasJdSource(job) ? (
              <span className="tracker-jd-dot" title="JD on role detail">
                ●
              </span>
            ) : null}
            <Link
              to={`/jobs/${job.id}`}
              className="tracker-assets-inline"
              title="Scoring & generated assets"
              onClick={(e) => e.stopPropagation()}
            >
              Assets
            </Link>
          </div>
        );
      case "role":
        return (
          <span className="cell-lines-2" title={roleCell(job)}>
            {roleCell(job)}
          </span>
        );
      case "score":
        return <ScoreBadge score={job.score.total} compact />;
      case "recommendedAction":
        return (
          <span className="cell-lines-1 cell-lines-action" title={job.tracker.recommendedAction ?? ""}>
            {job.tracker.recommendedAction?.trim() || "—"}
          </span>
        );
      case "status":
        {
          const secondary = statusSecondaryText(job);
        return (
          <div className="tracker-status-cell">
            <StatusBadge status={job.status} />
            {secondary ? (
              <span className="cell-lines-1 muted tracker-status-text" title={secondary}>
                {secondary}
              </span>
            ) : null}
          </div>
        );
        }
      case "resume":
        return <span className="tracker-resume">{job.recommendedResume}</span>;
      case "topMatch":
        return (
          <span className="cell-lines-1" title={job.topMatch}>
            {job.topMatch?.trim() || "—"}
          </span>
        );
      case "mainRisk":
        return (
          <span className="cell-lines-main-risk" title={job.mainRisk}>
            {job.mainRisk?.trim() || "—"}
          </span>
        );
      case "salary": {
        const full = salaryAskLabel(job);
        const short = salaryAskCompact(job);
        return (
          <span className="tracker-salary-cell" title={full || "—"}>
            {short || "—"}
          </span>
        );
      }
      case "notes":
        return (
          <span className="cell-lines-1 tracker-notes-preview" title={job.tracker.notes ?? ""}>
            {(job.tracker.notes ?? "").trim() || "—"}
          </span>
        );
      case "updatedAt":
        {
          const main = trackerDisplayDate(job);
          const mainMs = new Date(main.sortIso).getTime();
          const updatedMs = new Date(job.updatedAt).getTime();
          const mainIso = Number.isFinite(mainMs) ? new Date(mainMs).toISOString() : "—";
          const updatedIso = Number.isFinite(updatedMs) ? new Date(updatedMs).toISOString() : "—";
          const source =
            main.source === "applied"
              ? "Applied"
              : main.source === "discussed"
                ? "Discussed (spreadsheet)"
                : "Added / triaged";
          const title = `${source}: ${main.sourceValue} · Workflow ISO: ${mainIso} · Last updated: ${updatedIso}`;
        return (
          <span className="muted tracker-updated" title={title}>
              {main.displayText}
          </span>
        );
        }
      default:
        return null;
    }
  };

  const renderExtraCell = (job: JobRecord, col: ExtraColumn) => {
    switch (col) {
      case "rank":
        return tsOnly(job, "rank") || "—";
      case "discussed":
        return (
          <span className="cell-lines-1" title={tsOnly(job, "discussed")}>
            {tsOnly(job, "discussed") || "—"}
          </span>
        );
      case "originalAlt":
        return (
          <span className="cell-lines-1" title={tsOnly(job, "originalAltScore")}>
            {tsOnly(job, "originalAltScore") || "—"}
          </span>
        );
      case "priority":
        return (job.tracker.priority ?? tsOnly(job, "priority")).trim() || "—";
      default:
        return "—";
    }
  };

  const headerLabel = (col: PrimaryColumn | ExtraColumn): string => {
    const map: Record<string, string> = {
      company: "Company",
      role: "Role",
      score: "Score",
      recommendedAction: "Recommended action",
      status: "Status / outcome",
      resume: "Resume",
      topMatch: "Top match",
      mainRisk: "Main risk",
      salary: "Salary ask",
      notes: "Notes",
      updatedAt: "Date",
      rank: "Rank",
      discussed: "Discussed",
      originalAlt: "Orig / alt",
      priority: "Priority",
    };
    return map[col] ?? col;
  };

  const metaLine = () => {
    const n = sortedJobs.length;
    return `${n} shown · ${shortlistInView} shortlisted · ${totalAll} total`;
  };

  return (
    <section className="tracker-page stack">
      <header className="tracker-page-header">
        <div>
          <h2 className="tracker-title">Tracker</h2>
          <p className="muted tracker-app-hint">
            Workflow view — exports still use the full canonical spreadsheet columns (order & labels).
          </p>
        </div>
        <div className="tracker-toolbar">
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              const out = await api.exportJobs(query);
              const blob = new Blob([JSON.stringify(out.rows, null, 2)], { type: "application/json" });
              const href = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = href;
              a.download = exportFilename("json");
              a.click();
              URL.revokeObjectURL(href);
            }}
          >
            Export JSON
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              const csv = await api.exportJobsCsv(query);
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
              const href = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = href;
              a.download = exportFilename("csv");
              a.click();
              URL.revokeObjectURL(href);
            }}
          >
            Export CSV
          </button>
        </div>
      </header>

      <div className="card tracker-filters-card">
        <h3 className="tracker-filters-heading">Filters</h3>
        <FilterBar
          status={status}
          onStatusChange={setStatus}
          company={company}
          onCompanyChange={setCompany}
          resume={resume}
          onResumeChange={setResume}
          recommendation={recommendation}
          onRecommendationChange={setRecommendation}
          minScore={minScore}
          onMinScoreChange={setMinScore}
          shortlistOnly={shortlistOnly}
          onShortlistChange={setShortlistOnly}
        />
        <div className="tracker-filter-footer">
          <label className="checkboxRow muted tracker-extras-toggle">
            <input
              type="checkbox"
              checked={showExtras}
              onChange={(e) => setShowExtras(e.target.checked)}
            />
            Show sheet columns (Rank, Discussed, Orig/alt, Priority)
          </label>
        </div>
      </div>

      <div className="tracker-table-section card">
        <p className="tracker-meta-summary muted">{metaLine()}</p>
        {sortedJobs.length === 0 ? (
          <div className="tracker-empty">
            <p className="tracker-empty-title">No roles match these filters.</p>
            <p className="muted">Try clearing filters or widening your search.</p>
          </div>
        ) : (
          <div className="tracker-table-scroll">
            <table className="table tracker-app-table">
              <thead>
                <tr>
                  {PRIMARY_COLUMNS.map((c, idx) => {
                    const sticky = idx === 0 ? " tracker-sticky-left" : "";
                    const cls = `tracker-col-${c}${sticky}`;
                    const label = headerLabel(c);
                    return isSortableKey(c) ? (
                      <Fragment key={c}>{renderSortableTh(c, label, cls)}</Fragment>
                    ) : (
                      <Fragment key={c}>{renderPlainTh(label, cls)}</Fragment>
                    );
                  })}
                  {showExtras
                    ? EXTRA_COLUMNS.map((c) => {
                        const cls = `tracker-col-${c}`;
                        const label = headerLabel(c);
                        return isSortableKey(c) ? (
                          <Fragment key={c}>{renderSortableTh(c, label, cls)}</Fragment>
                        ) : (
                          <Fragment key={c}>{renderPlainTh(label, cls)}</Fragment>
                        );
                      })
                    : null}
                </tr>
              </thead>
              <tbody>
                {sortedJobs.map((job) => (
                  <tr
                    key={job.id}
                    className="tracker-row"
                    data-job-id={job.id}
                    onClick={rowNavigate}
                  >
                    {PRIMARY_COLUMNS.map((c, idx) => (
                      <td
                        key={c}
                        className={`tracker-col-${c}${idx === 0 ? " tracker-sticky-left" : ""}`}
                      >
                        {renderPrimaryCell(job, c)}
                      </td>
                    ))}
                    {showExtras
                      ? EXTRA_COLUMNS.map((c) => (
                          <td key={c} className={`tracker-col-${c}`}>
                            {renderExtraCell(job, c)}
                          </td>
                        ))
                      : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};
