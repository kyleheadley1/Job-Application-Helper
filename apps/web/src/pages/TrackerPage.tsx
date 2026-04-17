import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { JobRecord } from "../types/job";
import { ScoreBadge } from "../components/ScoreBadge";
import { FilterBar } from "../components/FilterBar";

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
      <table className="table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Role</th>
            <th>Score</th>
            <th>Recommendation</th>
            <th>Resume</th>
            <th>Top Match</th>
            <th>Main Risk</th>
            <th>Salary Ask</th>
            <th>Status</th>
            <th>Shortlist</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>
                <Link to={`/jobs/${job.id}`}>{job.extracted.company}</Link>
              </td>
              <td>{job.extracted.title}</td>
              <td>
                <ScoreBadge score={job.score.total} />
              </td>
              <td>{job.recommendation}</td>
              <td>{job.recommendedResume}</td>
              <td>{job.topMatch}</td>
              <td>{job.mainRisk}</td>
              <td>{job.salaryAsk.number ?? "N/A"}</td>
              <td>{job.status}</td>
              <td>{job.tracker.shortlist ? "yes" : "no"}</td>
              <td>{new Date(job.updatedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
