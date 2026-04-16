import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import type { JobRecord } from "../types/job";
import { ScoreBadge } from "../components/ScoreBadge";
import { StatusBadge } from "../components/StatusBadge";
import { JsonPanel } from "../components/JsonPanel";

export const JobResultPage = () => {
  const { id = "" } = useParams();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("cover");

  useEffect(() => {
    api.getJob(id).then(setJob).catch((err) => setError(err.message));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!job) return <p>Loading...</p>;

  return (
    <section className="stack">
      <header className="rowBetween">
        <div>
          <h2>
            {job.extracted.company} - {job.extracted.title}
          </h2>
          <p className="muted">{job.topMatch}</p>
        </div>
        <div className="row">
          <ScoreBadge score={job.score.total} />
          <StatusBadge status={job.status} />
        </div>
      </header>

      <div className="grid cols2">
        <article className="card">
          <h3>Decision</h3>
          <p>Apply: {job.recommendation}</p>
          <p>Salary ask: {job.salaryAsk.number ?? "N/A"} ({job.salaryAsk.rangeMin ?? "-"} - {job.salaryAsk.rangeMax ?? "-"})</p>
          <p>Recommended resume: {job.recommendedResume}</p>
          <p>Main risk: {job.mainRisk}</p>
          <ul>{job.rationale.map((item) => <li key={item}>{item}</li>)}</ul>
        </article>
        <article className="card">
          <h3>Score Breakdown</h3>
          <ul>
            <li>Stack: {job.score.stackFit}/25</li>
            <li>Level: {job.score.levelFit}/15</li>
            <li>Domain: {job.score.domainFit}/10</li>
            <li>Story: {job.score.resumeStoryClarity}/15</li>
            <li>Functional: {job.score.functionalOverlap}/10</li>
            <li>Recruiter: {job.score.recruiterFriendliness}/15</li>
            <li>Career value: {job.score.careerValue}/10</li>
          </ul>
          <h4>Hard-rule flags</h4>
          <ul>{job.rules.notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </article>
      </div>

      <div className="tabs">
        <button onClick={() => setTab("cover")}>Cover Letter</button>
        <button onClick={() => setTab("why")}>Why Company</button>
        <button onClick={() => setTab("points")}>Talking Points</button>
        <button onClick={() => setTab("bullets")}>Bullet Candidates</button>
        <button onClick={() => setTab("raw")}>Raw Extraction</button>
      </div>
      <article className="card">
        {tab === "cover" ? <p>{job.generated.coverLetter ?? "Not generated"}</p> : null}
        {tab === "why" ? <p>{job.generated.whyCompany ?? "Not generated"}</p> : null}
        {tab === "points" ? (
          <ul>{(job.generated.talkingPoints ?? []).map((item) => <li key={item}>{item}</li>)}</ul>
        ) : null}
        {tab === "bullets" ? (
          <ul>{(job.generated.tailoredBulletCandidates ?? []).map((item) => <li key={item}>{item}</li>)}</ul>
        ) : null}
        {tab === "raw" ? <JsonPanel value={job.extracted} /> : null}
      </article>
    </section>
  );
};
