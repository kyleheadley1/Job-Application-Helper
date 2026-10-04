import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { AlertPlatform, TopJobRecord, TopJobsSyncStats, TopJobsSyncStatus } from "../types/topJob";
import { ScoreBadge } from "../components/ScoreBadge";
import { companyDisplayLabel, formatAvailableIn, formatPostedAgo } from "../lib/jobDisplay";
import { resolveDisplayTitle } from "../lib/roleTitleDisplay";
import {
  postedRecencyTooltip,
  readTopJobsSortMode,
  sortTopJobs,
  TOP_JOBS_SORT_LABELS,
  type TopJobsSortMode,
  writeTopJobsSortMode,
} from "../lib/topJobsSort";

function companyCell(job: TopJobRecord): string {
  return companyDisplayLabel(job.extracted) || "Unknown Company";
}

function roleCell(job: TopJobRecord): string {
  return resolveDisplayTitle(job.extracted);
}

function companyKey(job: TopJobRecord): string {
  return companyCell(job).trim().toLowerCase();
}

function resumeLabel(job: TopJobRecord): string {
  return job.recommendedResume ?? "BASE";
}

const SOURCE_LABEL: Record<AlertPlatform, string> = {
  linkedin: "LinkedIn",
  indeed: "Indeed",
  ziprecruiter: "ZipRecruiter",
  remotehunter: "Remote Hunter",
};

function sourceLabel(source: string): string {
  const platform = source.replace(/_alert$/, "") as AlertPlatform;
  return SOURCE_LABEL[platform] ?? source;
}

function SourceBadge({ source }: { source: string }) {
  return <span className="pill neutral">{sourceLabel(source)}</span>;
}

function lastRunSummary(stats: TopJobsSyncStats): string {
  const parts = [
    `${stats.alertEmails} new alert email${stats.alertEmails === 1 ? "" : "s"} (${stats.listingsParsed} roles)`,
    `${stats.fetched} checked`,
    `${stats.triaged} scored`,
    `${stats.stored} added`,
  ];
  if (stats.skippedExisting) parts.push(`${stats.skippedExisting} already seen or applied`);
  if (stats.belowMinScore) parts.push(`${stats.belowMinScore} below 70`);
  if (stats.jdUnavailable) parts.push(`${stats.jdUnavailable} no readable posting`);
  if (stats.serperQueries) parts.push(`${stats.serperQueries} search credit${stats.serperQueries === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export function TopJobsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<TopJobRecord[]>([]);
  const [status, setStatus] = useState<TopJobsSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<TopJobsSortMode>(() => readTopJobsSortMode());
  const [scoreBusyId, setScoreBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [jobsRes, statusRes] = await Promise.all([
        api.listTopJobs(),
        api.getTopJobsSyncStatus(),
      ]);
      setItems(jobsRes.items);
      setStatus(statusRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Top Jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    writeTopJobsSortMode(sortMode);
  }, [sortMode]);

  const sortedItems = useMemo(() => sortTopJobs(items, sortMode), [items, sortMode]);

  const multiPostingEmployers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const j of sortedItems) {
      const k = companyKey(j);
      if (!k) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const multi = new Set<string>();
    for (const [k, n] of counts) {
      if (n >= 2) multi.add(k);
    }
    return multi;
  }, [sortedItems]);

  const refreshBlocked =
    status !== null && !status.canManualRefresh && !syncing;
  const refreshTitle = refreshBlocked
    ? `On cooldown — available ${formatAvailableIn(status.manualRefreshAvailableAt)}`
    : "Read new alert emails and score their roles";

  const handleRefresh = async () => {
    setSyncing(true);
    setError(null);
    try {
      await api.syncTopJobs();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handlePromote = async (id: string) => {
    try {
      const job = await api.promoteTopJob(id);
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, promotedToJobId: job.id } : item)),
      );
      navigate(`/jobs/${job.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add to tracker");
    }
  };

  const handleViewScore = async (job: TopJobRecord) => {
    setScoreBusyId(job.id);
    setError(null);
    try {
      if (job.promotedToJobId) {
        navigate(`/jobs/${job.promotedToJobId}`);
        return;
      }
      const promoted = await api.promoteTopJob(job.id);
      setItems((prev) =>
        prev.map((item) => (item.id === job.id ? { ...item, promotedToJobId: promoted.id } : item)),
      );
      navigate(`/jobs/${promoted.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open score view");
    } finally {
      setScoreBusyId(null);
    }
  };

  return (
    <section className="panel">
      <div className="row spread">
        <div>
          <h2>Top Jobs</h2>
          <p className="muted">
            Roles from your LinkedIn, Indeed, ZipRecruiter, and Remote Hunter job-alert emails, scored ≥70
            and not already in the tracker or applied to. Default order: fit × recency.
          </p>
          {status && (
            <p className="muted">
              Last synced: {status.lastSyncAt ? formatPostedAgo(status.lastSyncAt) : "Never"}
              {status.pendingListings > 0 && <> · {status.pendingListings} roles queued for the next run</>}
              {status.lastSyncStats && <> · Last run: {lastRunSummary(status.lastSyncStats)}</>}
            </p>
          )}
          {status && !status.gmailConnected && (
            <p className="error-text">
              Gmail isn&apos;t connected. Connect it on the <Link to="/">Dashboard</Link> so Top Jobs can read
              your job-alert emails.
            </p>
          )}
          {status && status.gmailConnected && !status.serperConfigured && (
            <p className="muted">
              SERPER_API_KEY isn&apos;t set, so Indeed and ZipRecruiter roles (whose pages block automated
              reads) are skipped. LinkedIn and Remote Hunter roles still work.
            </p>
          )}
        </div>
        <div className="row">
          <label className="row">
            <span className="muted">Sort by</span>
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value as TopJobsSortMode)}>
              {(Object.keys(TOP_JOBS_SORT_LABELS) as TopJobsSortMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {TOP_JOBS_SORT_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => void handleRefresh()}
            disabled={syncing || refreshBlocked}
            title={refreshTitle}
          >
            {syncing ? "Syncing…" : refreshBlocked ? "On cooldown" : "Refresh"}
          </button>
        </div>
      </div>

      {refreshBlocked && status.manualRefreshAvailableAt && (
        <p className="muted">
          Manual refresh on cooldown ({status.manualRefreshCooldownMin} min) — available{" "}
          {formatAvailableIn(status.manualRefreshAvailableAt)}.
          {" "}
          For local dev, set <code>TOP_JOBS_MANUAL_REFRESH_COOLDOWN_MIN=1</code> in <code>.env</code> and restart the API.
        </p>
      )}
      {status?.lastSyncError && <p className="error-text">Last sync error: {status.lastSyncError}</p>}
      {error && <p className="error-text">{error}</p>}

      {loading ? (
        <p>Loading…</p>
      ) : sortedItems.length === 0 ? (
        <p>No top jobs yet. Click Refresh to read your job-alert emails and score their roles.</p>
      ) : (
        <div className="tracker-wrap">
          <table className="tracker-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Role</th>
                <th>Score</th>
                <th>Resume</th>
                <th>Source</th>
                <th>Alerted</th>
                <th>Top match</th>
                <th>Main risk</th>
                <th>Apply</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((job) => (
                <tr key={job.id}>
                  <td>
                    <div className="tracker-company-primary">
                      <span>{companyCell(job)}</span>
                      {multiPostingEmployers.has(companyKey(job)) && roleCell(job) ? (
                        <span className="tracker-role-subtitle" title={roleCell(job)}>
                          {roleCell(job)}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <Link to={`/top-jobs/${job.id}`}>{roleCell(job) || "Untitled role"}</Link>
                  </td>
                  <td>
                    <ScoreBadge score={job.score.total} />
                  </td>
                  <td>
                    <span className="tracker-resume">{resumeLabel(job)}</span>
                  </td>
                  <td>
                    <SourceBadge source={job.source} />
                  </td>
                  <td
                    className="top-jobs-posted"
                    title={postedRecencyTooltip(job.sourcePostedAt)}
                  >
                    {formatPostedAgo(job.sourcePostedAt)}
                  </td>
                  <td className="truncate-cell">{job.topMatch}</td>
                  <td className="truncate-cell">{job.mainRisk}</td>
                  <td>
                    <a href={job.applyUrl} target="_blank" rel="noopener noreferrer">
                      Apply →
                    </a>
                  </td>
                  <td>
                    <div className="row">
                      <button
                        type="button"
                        className="tracker-assets-inline"
                        title="Full scoring breakdown"
                        disabled={scoreBusyId === job.id}
                        onClick={() => void handleViewScore(job)}
                      >
                        {scoreBusyId === job.id ? "…" : "Score"}
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => void handlePromote(job.id)}>
                        Add to Tracker
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function TopJobDetailPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const [job, setJob] = useState<TopJobRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scoreBusy, setScoreBusy] = useState(false);

  useEffect(() => {
    api
      .getTopJob(id)
      .then(setJob)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [id]);

  const openScoreView = async () => {
    if (!job) return;
    setScoreBusy(true);
    try {
      if (job.promotedToJobId) {
        navigate(`/jobs/${job.promotedToJobId}`);
        return;
      }
      const promoted = await api.promoteTopJob(job.id);
      setJob({ ...job, promotedToJobId: promoted.id });
      navigate(`/jobs/${promoted.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open score view");
    } finally {
      setScoreBusy(false);
    }
  };

  if (error) return <p className="error-text">{error}</p>;
  if (!job) return <p>Loading…</p>;

  return (
    <section className="panel">
      <div className="row spread">
        <h2>
          {companyDisplayLabel(job.extracted)} — {resolveDisplayTitle(job.extracted)}
        </h2>
        <ScoreBadge score={job.score.total} />
      </div>
      <p className="muted">
        <SourceBadge source={job.source} /> alert{" "}
        <span className="top-jobs-posted" title={postedRecencyTooltip(job.sourcePostedAt)}>
          {formatPostedAgo(job.sourcePostedAt)}
        </span>
      </p>
      <p>
        <strong>Recommended resume:</strong>{" "}
        <span className="tracker-resume">{resumeLabel(job)}</span>
      </p>
      <p>
        <strong>Top match:</strong> {job.topMatch}
      </p>
      <p>
        <strong>Main risk:</strong> {job.mainRisk}
      </p>
      {job.rationale.length > 0 && (
        <ul>
          {job.rationale.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <div className="row">
        <a href={job.applyUrl} target="_blank" rel="noopener noreferrer" className="btn">
          Apply →
        </a>
        <button type="button" className="btn" disabled={scoreBusy} onClick={() => void openScoreView()}>
          {scoreBusy ? "Opening…" : "View Score"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const promoted = await api.promoteTopJob(job.id);
            navigate(`/jobs/${promoted.id}`);
          }}
        >
          Add to Tracker
        </button>
        <Link to="/top-jobs">Back to Top Jobs</Link>
      </div>
    </section>
  );
}
