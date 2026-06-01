import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { JobRecord } from "../types/job";
import { ScoreBadge } from "../components/ScoreBadge";
import { StatusBadge } from "../components/StatusBadge";
import { JsonPanel } from "../components/JsonPanel";
import { jobHeaderLabel, salaryAskLabel } from "../lib/jobDisplay";
import { buildKeyRisks, decisionSummaryLine, selectTopFits } from "../lib/resultSummary";
import {
  formatDuration,
  progressForPhase,
  readStoredTriageTiming,
  writeStoredTriageTiming,
  type TriageProgressPhase,
  type TriageTimingPayload,
} from "../lib/triageTiming";

type AssetTab = "cover" | "why" | "points" | "bullets" | "raw";

function tabHasContent(job: JobRecord, tab: AssetTab): boolean {
  if (tab === "raw") return true;
  if (tab === "cover") return Boolean(job.generated.coverLetter?.trim());
  if (tab === "why") return Boolean(job.generated.whyCompany?.trim());
  if (tab === "points") return (job.generated.talkingPoints?.length ?? 0) > 0;
  if (tab === "bullets") return (job.generated.tailoredBulletCandidates?.length ?? 0) > 0;
  return false;
}

function renderTextParagraphs(text: string, fallback = "Not generated") {
  const parts = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return <p>{fallback}</p>;
  return parts.map((p) => <p key={p}>{p}</p>);
}

export const JobResultPage = () => {
  const { id = "" } = useParams();
  const location = useLocation();
  const navTiming = (location.state as { triageTiming?: TriageTimingPayload } | undefined)?.triageTiming;
  const [job, setJob] = useState<JobRecord | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<AssetTab>("cover");
  const [tracked, setTracked] = useState(false);
  const [canConfirmApplied, setCanConfirmApplied] = useState(false);
  const [busyConfirm, setBusyConfirm] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState("");
  const [assetBusy, setAssetBusy] = useState(false);
  const [assetMsg, setAssetMsg] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(navTiming?.startedAt ?? null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [finishedMs, setFinishedMs] = useState<number | null>(null);
  const [progressPhase, setProgressPhase] = useState<TriageProgressPhase>("idle");

  useEffect(() => {
    if (!id) return;
    const stored = readStoredTriageTiming(id);
    if (stored) {
      setStartedAt(stored.startedAt);
      setFinishedMs(stored.finishedMs);
      setProgressPhase("result_ready");
    } else if (navTiming?.startedAt) {
      setStartedAt(navTiming.startedAt);
      setFinishedMs(null);
      setProgressPhase("result_fetch_in_flight");
    }
  }, [id, navTiming?.startedAt]);

  useEffect(() => {
    if (!startedAt || finishedMs !== null || !!job) return;
    const update = () => setElapsedMs(Date.now() - startedAt);
    update();
    const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, [startedAt, finishedMs, job]);

  useEffect(() => {
    setProgressPhase("result_fetch_in_flight");
    api
      .getJob(id)
      .then((data) => {
        setJob(data);
        setTracked(Boolean(data.tracked));
        setCanConfirmApplied(Boolean(data.canConfirmApplied));
        setProgressPhase("result_ready");
        if (startedAt && finishedMs === null) {
          const done = Date.now() - startedAt;
          setFinishedMs(done);
          setElapsedMs(done);
          writeStoredTriageTiming(data.id, { startedAt, finishedMs: done });
        }
      })
      .catch((err) => setError(err.message));
  }, [id, startedAt, finishedMs]);

  const ensureAssets = async (nextTab: AssetTab) => {
    if (!job || nextTab === "raw" || tabHasContent(job, nextTab) || assetBusy) return;
    setAssetBusy(true);
    setAssetMsg("Generating assets...");
    try {
      const updated = await api.regenerateAssets(job.id, false);
      setJob(updated);
      setAssetMsg("Assets generated.");
    } catch (err) {
      setAssetMsg(err instanceof Error ? err.message : "Asset generation failed.");
    } finally {
      setAssetBusy(false);
    }
  };

  const openTab = async (nextTab: AssetTab) => {
    setTab(nextTab);
    await ensureAssets(nextTab);
  };

  const confirmApplied = async () => {
    if (!job) return;
    setBusyConfirm(true);
    setConfirmMsg("");
    try {
      const saved = await api.confirmApplied(job.id);
      setJob(saved);
      setTracked(true);
      setCanConfirmApplied(false);
      setConfirmMsg("Confirmed and added to tracker.");
    } catch (err) {
      setConfirmMsg(err instanceof Error ? err.message : "Could not confirm applied.");
    } finally {
      setBusyConfirm(false);
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!job) {
    return (
      <section className="stack">
        {startedAt ? (
          <article className="card triageTiming">
            <p className="muted">Thinking...</p>
            <div className="triageProgressTrack" aria-hidden>
              <div className="triageProgressFill" style={{ width: `${progressForPhase(progressPhase)}%` }} />
            </div>
            <p className="muted">Elapsed: {formatDuration(elapsedMs)}</p>
          </article>
        ) : (
          <p>Loading...</p>
        )}
      </section>
    );
  }
  const topFits = selectTopFits(job, 2);
  const topRisks = buildKeyRisks(job, 5);
  const hardRules = job.rules.hardRuleNotes ?? [];
  const summaryLine = decisionSummaryLine(job);
  return (
    <section className="stack">
      <header className="rowBetween">
        <div>
          <h2>{jobHeaderLabel(job.extracted)}</h2>
          <p className="muted">{summaryLine}</p>
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
          {!tracked ? (
            <p className="muted">Not added to tracker yet. It is saved only after you confirm you applied.</p>
          ) : (
            <p className="muted">In tracker.</p>
          )}
          {!tracked && canConfirmApplied ? (
            <button onClick={confirmApplied} disabled={busyConfirm}>
              {busyConfirm ? "Confirming..." : "Confirm I applied"}
            </button>
          ) : null}
          {confirmMsg ? <p className="muted">{confirmMsg}</p> : null}
          <p>Salary ask: {salaryAskLabel(job) || "N/A"}</p>
          {finishedMs !== null ? <p className="muted">Finished in {formatDuration(finishedMs)}</p> : null}
          <p>Recommended resume: {job.recommendedResume}</p>
          <h4>Why consider</h4>
          <ul>{topFits.map((item) => <li key={item}>{item}</li>)}</ul>
          <h4>Key risks</h4>
          <ul>{topRisks.map((item) => <li key={item}>{item}</li>)}</ul>
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
          {hardRules.length ? (
            <ul>{hardRules.map((note) => <li key={note}>{note}</li>)}</ul>
          ) : (
            <p className="muted">None identified.</p>
          )}
        </article>
      </div>

      <div className="tabs">
        <button onClick={() => void openTab("cover")}>Cover Letter</button>
        <button onClick={() => void openTab("why")}>Why Company</button>
        <button onClick={() => void openTab("points")}>Talking Points</button>
        <button onClick={() => void openTab("bullets")}>Bullet Candidates</button>
        <button onClick={() => void openTab("raw")}>Raw Extraction</button>
      </div>
      {assetMsg ? <p className="muted">{assetMsg}</p> : null}
      <article className="card">
        {tab === "cover" ? renderTextParagraphs(job.generated.coverLetter ?? "", "Not generated") : null}
        {tab === "why" ? renderTextParagraphs(job.generated.whyCompany ?? "", "Not generated") : null}
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
