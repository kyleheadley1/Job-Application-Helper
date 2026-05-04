import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import type { JobRecord } from "../types/job";
import { ScoreBadge } from "../components/ScoreBadge";
import { StatusBadge } from "../components/StatusBadge";
import { JsonPanel } from "../components/JsonPanel";
import { salaryAskLabel } from "../lib/jobDisplay";
import { buildKeyRisks, decisionSummaryLine, displayRoleTitle, selectTopFits } from "../lib/resultSummary";

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
  const [job, setJob] = useState<JobRecord | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<AssetTab>("cover");
  const [tracked, setTracked] = useState(false);
  const [canConfirmApplied, setCanConfirmApplied] = useState(false);
  const [busyConfirm, setBusyConfirm] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState("");
  const [assetBusy, setAssetBusy] = useState(false);
  const [assetMsg, setAssetMsg] = useState("");

  useEffect(() => {
    api
      .getJob(id)
      .then((data) => {
        setJob(data);
        setTracked(Boolean(data.tracked));
        setCanConfirmApplied(Boolean(data.canConfirmApplied));
      })
      .catch((err) => setError(err.message));
  }, [id]);

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
  if (!job) return <p>Loading...</p>;
  const topFits = selectTopFits(job, 2);
  const topRisks = buildKeyRisks(job, 5);
  const hardRules = job.rules.hardRuleNotes ?? [];
  const summaryLine = decisionSummaryLine(job);
  const displayTitle = displayRoleTitle(job.extracted.title);

  return (
    <section className="stack">
      <header className="rowBetween">
        <div>
          <h2>
            {job.extracted.company} - {displayTitle}
          </h2>
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
