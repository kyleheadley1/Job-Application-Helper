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
  const [scoreBand, setScoreBand] = useState("");
  const [shortlistOnly, setShortlistOnly] = useState(false);

  const scoreBounds =
    scoreBand === "80"
      ? { minScore: "80" }
      : scoreBand === "70"
        ? { minScore: "70", maxScore: "79" }
        : scoreBand === "65"
          ? { minScore: "65", maxScore: "69" }
          : scoreBand === "0"
            ? { maxScore: "64" }
            : {};

  const query = useMemo(
    () =>
      queryString({
        status,
        company,
        resume,
        shortlist: shortlistOnly ? true : undefined,
        ...scoreBounds,
      }),
    [status, company, resume, shortlistOnly, scoreBand],
  );

  useEffect(() => {
    api.listJobs(query).then((res) => setJobs(res.items));
  }, [query]);

  return (
    <section className="stack">
      <h2>Tracker</h2>
      <FilterBar
        status={status}
        onStatusChange={setStatus}
        company={company}
        onCompanyChange={setCompany}
        resume={resume}
        onResumeChange={setResume}
        scoreBand={scoreBand}
        onScoreBandChange={setScoreBand}
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
