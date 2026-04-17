import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { JobRecord, TrackerSpreadsheetFields } from "../types/job";
import { ScoreBadge } from "../components/ScoreBadge";
import { FilterBar } from "../components/FilterBar";

/** Canonical tracker column labels (same order as spreadsheet export). */
const TRACKER_HEADERS = [
  "Rank",
  "Discussed",
  "Company",
  "Role",
  "Latest Score",
  "Original / Alt Score",
  "Priority",
  "Recommended Action",
  "Status / Outcome",
  "Salary Ask",
  "JD Input",
  "Top Match",
  "Main Risk",
  "Notes",
  "Resume",
] as const;

const salaryAskDisplay = (job: JobRecord): string => {
  const s = job.salaryAsk;
  if (typeof s.number === "number") return String(s.number);
  if (typeof s.rangeMin === "number" || typeof s.rangeMax === "number") {
    const min = typeof s.rangeMin === "number" ? String(s.rangeMin) : "";
    const max = typeof s.rangeMax === "number" ? String(s.rangeMax) : "";
    return [min, max].filter(Boolean).join(" - ");
  }
  return "";
};

const jdDisplay = (job: JobRecord): string =>
  job.extracted.rawText?.trim() ||
  (job.extracted.url ? `URL: ${job.extracted.url}` : "") ||
  "";

/**
 * In-app tracker columns: prefer rich internal state for anything that drives logic;
 * use `trackerSpreadsheet` only where the sheet is the natural source (rank/discussed/original score)
 * or to fill gaps when internal JD text is empty.
 */
function trackerCell(job: JobRecord, header: (typeof TRACKER_HEADERS)[number]): string {
  const ts = job.trackerSpreadsheet ?? {};
  const tsOnly = (key: keyof TrackerSpreadsheetFields): string =>
    ts[key] !== undefined ? String(ts[key]) : "";

  switch (header) {
    case "Rank":
      return tsOnly("rank");
    case "Discussed":
      return tsOnly("discussed");
    case "Original / Alt Score":
      return tsOnly("originalAltScore");
    case "Company":
      return job.extracted.company || tsOnly("company");
    case "Role":
      return job.extracted.title || tsOnly("role");
    case "Latest Score":
      return String(job.score.total);
    case "Priority":
      return job.tracker.priority ?? "";
    case "Recommended Action":
      return job.tracker.recommendedAction ?? "";
    case "Status / Outcome":
      return job.tracker.statusOutcome ?? job.status;
    case "Salary Ask":
      return salaryAskDisplay(job);
    case "JD Input": {
      const internal = jdDisplay(job);
      return internal || tsOnly("jdInput");
    }
    case "Top Match":
      return job.topMatch;
    case "Main Risk":
      return job.mainRisk;
    case "Notes":
      return job.tracker.notes ?? "";
    case "Resume":
      return job.recommendedResume;
    default:
      return "";
  }
}

const queryString = (params: Record<string, string | boolean | undefined>): string => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === "") return;
    q.set(key, String(value));
  });
  const out = q.toString();
  return out ? `?${out}` : "";
};

export const TrackerPage = () => {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [status, setStatus] = useState("");
  const [company, setCompany] = useState("");
  const [resume, setResume] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [minScore, setMinScore] = useState("");
  const [shortlistOnly, setShortlistOnly] = useState(false);

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
    api.listJobs(query).then((res) => setJobs(res.items));
  }, [query]);

  return (
    <section className="stack">
      <h2>Tracker</h2>
      <div className="row">
        <button
          type="button"
          onClick={async () => {
            const out = await api.exportJobs(query);
            const blob = new Blob([JSON.stringify(out.rows, null, 2)], { type: "application/json" });
            const href = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = href;
            a.download = "jobs-export.json";
            a.click();
            URL.revokeObjectURL(href);
          }}
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={async () => {
            const csv = await api.exportJobsCsv(query);
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const href = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = href;
            a.download = "jobs-export.csv";
            a.click();
            URL.revokeObjectURL(href);
          }}
        >
          Export CSV
        </button>
      </div>
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
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              {TRACKER_HEADERS.map((h) => (
                <th key={h}>{h}</th>
              ))}
              <th>Shortlist</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                {TRACKER_HEADERS.map((h) => (
                  <td key={h}>
                    {h === "Company" ? (
                      <Link to={`/jobs/${job.id}`}>{trackerCell(job, h)}</Link>
                    ) : h === "Latest Score" ? (
                      <ScoreBadge score={job.score.total} />
                    ) : (
                      trackerCell(job, h)
                    )}
                  </td>
                ))}
                <td>{job.tracker.shortlist ? "yes" : "no"}</td>
                <td>{new Date(job.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
