import type { CaptureStatus, CaptureView } from "../lib/api";

const STATUS_LABEL: Record<CaptureStatus, string> = {
  queued: "Saved — waiting to score",
  scoring: "Scoring…",
  complete: "Ready",
  failed: "Failed",
};

const RESUME_LABEL: Record<string, string> = {
  SWE: "SWE resume",
  SIE: "SIE resume",
  AI: "AI resume",
};

const scoreClass = (score: number, hardGate?: string) => {
  if (hardGate) return "score bad";
  if (score >= 75) return "score good";
  if (score >= 60) return "score ok";
  return "score bad";
};

type Props = {
  capture: CaptureView;
  webAppUrl: string;
  onRetry?: () => void;
  onRescore?: () => void;
};

export function CaptureCard({ capture, webAppUrl, onRetry, onRescore }: Props) {
  const { summary } = capture;
  return (
    <section className="card">
      <div className="row">
        <span className={`chip ${capture.status}`}>{STATUS_LABEL[capture.status]}</span>
        <span className="muted">{new Date(capture.createdAt).toLocaleTimeString()}</span>
      </div>

      {!summary && capture.pageTitle && <p className="title">{capture.pageTitle}</p>}

      {capture.status === "failed" && (
        <>
          <p className="error">{capture.error ?? "Scoring failed."}</p>
          {onRetry && <button onClick={onRetry}>Retry</button>}
        </>
      )}

      {summary && (
        <>
          <p className="title">
            {summary.title}
            <span className="muted"> · {summary.company}</span>
          </p>
          <div className="score-row">
            <span className={scoreClass(summary.scoreTotal, summary.hardGate)}>
              {summary.scoreTotal}
              <small>/100</small>
            </span>
            <div className="stack tight">
              {summary.recommendationLabel && <strong>{summary.recommendationLabel}</strong>}
              <span>Use: {RESUME_LABEL[summary.recommendedResume] ?? summary.recommendedResume}</span>
            </div>
          </div>
          {summary.hardGate && <p className="error">Hard gate: {summary.hardGate}</p>}
          {!summary.hardGate && summary.mainRisk && (
            <p className="muted">Main risk: {summary.mainRisk}</p>
          )}
        </>
      )}

      <div className="row">
        {capture.jobId && (
          <a href={`${webAppUrl}/jobs/${capture.jobId}`} target="_blank" rel="noreferrer">
            Open full assessment
          </a>
        )}
        {onRescore && (
          <button className="link" onClick={onRescore}>
            Re-score anyway
          </button>
        )}
      </div>
    </section>
  );
}
