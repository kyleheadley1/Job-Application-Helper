import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { formatDuration, progressForPhase, type TriageProgressPhase } from "../lib/triageTiming";

export const AddJobPage = () => {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [rawText, setRawText] = useState("");
  const [companyHint, setCompanyHint] = useState("");
  const [fullPrep, setFullPrep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [progressPhase, setProgressPhase] = useState<TriageProgressPhase>("idle");

  useEffect(() => {
    if (!busy || !startedAt) return;
    const update = () => setElapsedMs(Date.now() - startedAt);
    update();
    const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, [busy, startedAt]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setProgressPhase("submitted");
    const start = Date.now();
    setStartedAt(start);
    setElapsedMs(0);
    try {
      setProgressPhase("triage_request_in_flight");
      const job = await api.triage({ url: url || undefined, rawText: rawText || undefined, companyHint, fullPrep });
      setProgressPhase("triage_response_received");
      navigate(`/jobs/${job.id}`, {
        state: {
          triageTiming: { startedAt: start },
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to triage role");
    } finally {
      setBusy(false);
      setProgressPhase("idle");
    }
  };

  return (
    <section>
      <h2>Add Job</h2>
      <p className="muted">Paste a job URL or JD text. Triage stays conservative and screen-realistic.</p>
      <form className="card" onSubmit={onSubmit}>
        <label>
          Job URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
        </label>
        <label>
          Pasted JD text
          <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={10} />
        </label>
        <label>
          Company hint (optional)
          <input value={companyHint} onChange={(e) => setCompanyHint(e.target.value)} />
        </label>
        <label className="checkboxRow">
          <input type="checkbox" checked={fullPrep} onChange={(e) => setFullPrep(e.target.checked)} />
          Full apply prep
        </label>
        {busy && startedAt ? (
          <div className="triageTiming">
            <p className="muted">Thinking...</p>
            <div className="triageProgressTrack" aria-hidden>
              <div
                className="triageProgressFill"
                style={{ width: `${progressForPhase(progressPhase)}%` }}
              />
            </div>
            <p className="muted">Elapsed: {formatDuration(elapsedMs)}</p>
          </div>
        ) : null}
        <button disabled={busy}>{busy ? "Scoring..." : "Run triage"}</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </section>
  );
};
