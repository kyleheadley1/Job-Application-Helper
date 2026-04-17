import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import type { JobRecord, JobStatus } from "../types/job";
import { JsonPanel } from "../components/JsonPanel";

const statuses: JobStatus[] = [
  "to_review",
  "applied",
  "skip",
  "rejected",
  "interviewing",
  "assessment",
  "closed",
  "offer",
];

export const RoleDetailPage = () => {
  const { id = "" } = useParams();
  const [job, setJob] = useState<(JobRecord & { statusHistory?: unknown[] }) | null>(null);
  const [status, setStatus] = useState<JobStatus>("to_review");
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    api.getJob(id).then((data) => {
      setJob(data);
      setStatus(data.status);
      setNotes(data.tracker.notes ?? "");
    });
  }, [id]);

  if (!job) return <p>Loading...</p>;

  const saveStatus = async () => {
    const updated = await api.updateStatus(job.id, status, note);
    setJob({ ...job, ...updated });
    setNotes(updated.tracker.notes ?? notes);
    setNote("");
  };

  const saveNotes = async () => {
    const updated = await api.updateNotes(job.id, notes);
    setJob({ ...job, ...updated });
  };

  return (
    <section className="stack">
      <h2>Role Detail</h2>
      <div className="card">
        <h3>
          {job.extracted.company} - {job.extracted.title}
        </h3>
        <p>
          Score: <strong>{job.score.total}</strong> | Recommendation: <strong>{job.recommendation}</strong> | Resume:{" "}
          <strong>{job.recommendedResume}</strong>
        </p>
        <p>
          Top match: {job.topMatch}
          <br />
          Main risk: {job.mainRisk}
        </p>
        <div className="row">
          <select value={status} onChange={(e) => setStatus(e.target.value as JobStatus)}>
            {statuses.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <input placeholder="Status note" value={note} onChange={(e) => setNote(e.target.value)} />
          <button onClick={saveStatus}>Update status</button>
        </div>
        <div className="stack">
          <label htmlFor="notes">Tracker notes</label>
          <textarea id="notes" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div>
            <button onClick={saveNotes}>Save notes</button>
          </div>
        </div>
      </div>
      <div className="grid cols2">
        <article className="card">
          <h4>Extracted Job Data</h4>
          <JsonPanel value={job.extracted} />
        </article>
        <article className="card">
          <h4>Rules + Score</h4>
          <JsonPanel value={{ rules: job.rules, score: job.score, recommendation: job.recommendation }} />
        </article>
      </div>
      <article className="card">
        <h4>Generated Assets</h4>
        <JsonPanel value={job.generated} />
      </article>
      <article className="card">
        <h4>Score History</h4>
        <JsonPanel value={job.scoreHistory ?? []} />
      </article>
      <article className="card">
        <h4>Status History</h4>
        <JsonPanel value={job.statusHistory ?? []} />
      </article>
    </section>
  );
};
