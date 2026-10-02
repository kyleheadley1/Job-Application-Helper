import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type {
  ApplicationStatus,
  EvaluationSummary,
  EvaluationsResponse,
  GmailApplication,
  GmailStatus,
} from "../types/gmail";
import type { JobStatus } from "../types/job";

const WINDOW_DAYS = 7;
const AUTO_SYNC_AFTER_MS = 15 * 60 * 1000;
const RECOVERY_POLL_MS = 5000;
const SMALL_SAMPLE = 5;

const STATUS_ORDER: ApplicationStatus[] = ["applied", "assessment", "interviewing", "rejected", "offer"];

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  applied: "Applied",
  assessment: "Assessment",
  interviewing: "Interviewing",
  rejected: "Rejected",
  offer: "Offer",
};

const STATUS_PILL: Record<ApplicationStatus, string> = {
  applied: "info",
  assessment: "warn",
  interviewing: "good",
  rejected: "bad",
  offer: "good",
};

const JOB_STATUS_LABEL: Partial<Record<JobStatus, string>> = {
  to_review: "To review",
  applied: "Applied",
  skip: "Skip",
  rejected: "Rejected",
  interviewing: "Interviewing",
  assessment: "Assessment",
  closed: "Closed",
  offer: "Offer",
  lapsed: "Lapsed",
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const REASON_LABEL: Record<string, string> = {
  serper_cap_reached: "search limit reached",
  serper_not_configured: "no email link; search not configured",
  serper_no_results: "search found nothing",
  no_search_terms: "no title or req ID to search",
  no_email_evidence: "no link or JD in email",
  no_usable_posting: "links didn't load",
};

function JdMatchBadge({ evaluation }: { evaluation?: EvaluationSummary }) {
  if (!evaluation) return <span className="muted">—</span>;
  const { status, matchLevel, url, reason } = evaluation;
  const [label, pill] =
    status === "scored"
      ? matchLevel === "exact"
        ? ["Exact (req ID)", "good"]
        : ["High (email link)", "good"]
      : status === "unverified"
        ? ["Unverified", "warn"]
        : status === "fetch_failed"
          ? ["Fetch failed", "bad"]
          : ["Not found", "bad"];
  const badge = <span className={`pill ${pill}`}>{label}</span>;
  return (
    <div className="stack" style={{ gap: "0.2rem" }}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          {badge}
        </a>
      ) : (
        badge
      )}
      {reason && status !== "scored" && <span className="muted">{REASON_LABEL[reason] ?? reason}</span>}
    </div>
  );
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [applications, setApplications] = useState<GmailApplication[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [pendingRecovery, setPendingRecovery] = useState(0);
  const [evaluations, setEvaluations] = useState<EvaluationsResponse | null>(null);
  const autoSynced = useRef(false);

  const loadEvaluations = useCallback(async () => {
    const result = await api.gmailEvaluations(WINDOW_DAYS);
    setEvaluations(result);
    return result;
  }, []);

  const loadApplications = useCallback(async () => {
    const { applications: items, pendingRecovery: pending } = await api.gmailApplications(WINDOW_DAYS);
    setApplications(items);
    setPendingRecovery(pending);
    await loadEvaluations().catch(() => null);
  }, [loadEvaluations]);

  const runSync = useCallback(async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const result = await api.gmailSync(WINDOW_DAYS);
      setApplications(result.applications);
      setPendingRecovery(result.pendingRecovery);
      setStatus(await api.gmailStatus());
      if (result.llmFailures > 0) {
        setNotice({
          kind: "error",
          text: `${result.llmFailures} email(s) couldn't be classified; they'll be retried on the next sync.`,
        });
      }
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
      setStatus(await api.gmailStatus().catch(() => null));
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const flag = searchParams.get("gmail");
    if (flag) {
      setNotice(
        flag === "connected"
          ? { kind: "ok", text: "Gmail connected." }
          : { kind: "error", text: "Gmail connection failed or was cancelled. Try again." },
      );
      searchParams.delete("gmail");
      setSearchParams(searchParams, { replace: true });
    }
    // Only read the OAuth redirect flag once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const s = await api.gmailStatus();
        setStatus(s);
        if (!s.connected) return;
        await loadApplications();
        const stale = !s.lastSyncAt || Date.now() - new Date(s.lastSyncAt).getTime() > AUTO_SYNC_AFTER_MS;
        if (stale && !autoSynced.current) {
          autoSynced.current = true;
          await runSync();
        }
      } catch (error) {
        setNotice({ kind: "error", text: errorText(error) });
      }
    })();
  }, [loadApplications, runSync]);

  const recoveryRunning = evaluations?.run.running ?? false;

  useEffect(() => {
    if (!recoveryRunning) return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const result = await loadEvaluations();
          if (!result.run.running) {
            await loadApplications();
            if (result.run.error) setNotice({ kind: "error", text: `JD recovery failed: ${result.run.error}` });
          }
        } catch (error) {
          setNotice({ kind: "error", text: errorText(error) });
        }
      })();
    }, RECOVERY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [recoveryRunning, loadEvaluations, loadApplications]);

  const onRecover = async () => {
    setNotice(null);
    try {
      const result = await api.gmailRunRecovery(WINDOW_DAYS);
      if (!result.started && !result.running) {
        setNotice({ kind: "ok", text: "Nothing to recover." });
        return;
      }
      await loadEvaluations();
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    }
  };

  const onDisconnect = async () => {
    if (!window.confirm("Disconnect Gmail? Cached results stay until you reconnect.")) return;
    try {
      await api.gmailDisconnect();
      setStatus(await api.gmailStatus());
      setApplications([]);
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    }
  };

  const onUpdateTracker = async (app: GmailApplication) => {
    if (!app.trackerJobId || !app.suggestedStatus) return;
    setUpdatingKey(app.key);
    try {
      await api.updateStatus(
        app.trackerJobId,
        app.suggestedStatus,
        `From Gmail: ${app.emails[0]?.subject ?? STATUS_LABEL[app.status]}`,
      );
      await loadApplications();
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    } finally {
      setUpdatingKey(null);
    }
  };

  const counts = STATUS_ORDER.map((s) => ({
    status: s,
    count: applications.filter((a) => a.status === s).length,
  }));

  return (
    <section className="stack">
      <div className="rowBetween">
        <h2>Applications — last {WINDOW_DAYS} days</h2>
        <Link to="/addjob">+ Add a job</Link>
      </div>

      {notice && <p className={notice.kind === "error" ? "error" : "muted"}>{notice.text}</p>}

      {!status && <p className="muted">Loading…</p>}

      {status && !status.configured && (
        <div className="card stack">
          <strong>Gmail isn't set up yet</strong>
          <p className="muted">
            Create a Google Cloud OAuth client (type "Web application", Gmail API enabled) with redirect URI{" "}
            <code>http://localhost:4000/api/gmail/oauth/callback</code>, then set <code>GOOGLE_CLIENT_ID</code> and{" "}
            <code>GOOGLE_CLIENT_SECRET</code> in the root <code>.env</code> and restart the API.
          </p>
        </div>
      )}

      {status?.configured && !status.connected && (
        <div className="card stack">
          <strong>{status.needsReconnect ? "Gmail access expired" : "Connect Gmail"}</strong>
          <p className="muted">
            {status.needsReconnect
              ? "Google expired or revoked access (Testing-mode apps expire after 7 days). Reconnect to keep syncing."
              : "Read-only access. The app scans recent job-related emails to find applications and status updates."}
          </p>
          <div>
            <a href={api.gmailConnectUrl}>
              <button>{status.needsReconnect ? "Reconnect Gmail" : "Connect Gmail"}</button>
            </a>
          </div>
        </div>
      )}

      {status?.connected && (
        <>
          <div className="rowBetween">
            <span className="muted">
              {status.email ?? "Gmail"} · {status.lastSyncAt ? `last synced ${formatDateTime(status.lastSyncAt)}` : "not synced yet"}
            </span>
            <div className="row">
              <button
                className="btn-secondary"
                onClick={() => void onRecover()}
                disabled={syncing || recoveryRunning || pendingRecovery === 0}
                title="Find each application's job description and score it (newest first)"
              >
                {recoveryRunning
                  ? `Recovering JDs… (${evaluations?.run.processed ?? 0} done)`
                  : `Recover JDs (${pendingRecovery} pending)`}
              </button>
              <button onClick={() => void runSync()} disabled={syncing}>
                {syncing ? "Syncing…" : "Sync now"}
              </button>
              <button className="btn-secondary" onClick={() => void onDisconnect()} disabled={syncing}>
                Disconnect
              </button>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
            {counts.map(({ status: s, count }) => (
              <div key={s} className="card">
                <div className="muted">{STATUS_LABEL[s]}</div>
                <div style={{ fontSize: "1.8rem", fontWeight: 700 }}>{count}</div>
              </div>
            ))}
          </div>

          {evaluations && !evaluations.serper.configured && (
            <p className="muted">
              Search fallback is off: add <code>SERPER_API_KEY</code> to the root <code>.env</code> and restart the API.
              Applications whose emails include a job link still get recovered.
            </p>
          )}
          {evaluations?.serper.configured && evaluations.serper.used >= evaluations.serper.cap && (
            <p className="muted">
              Serper limit reached ({evaluations.serper.used}/{evaluations.serper.cap}). Only email links are used now.
            </p>
          )}

          {evaluations && evaluations.rubricSummary.scored > 0 && (
            <div className="card stack">
              <strong>Fit score vs outcome</strong>
              <p className="muted">
                Mean fit for applications whose exact JD was recovered and scored blind to the outcome.
                {evaluations.rubricSummary.scored < SMALL_SAMPLE * 2 &&
                  ` Only ${evaluations.rubricSummary.scored} scored so far, so treat these as anecdotes.`}
              </p>
              <table className="table">
                <thead>
                  <tr>
                    <th>Outcome</th>
                    <th>Scored</th>
                    <th>Mean fit</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluations.rubricSummary.rows
                    .filter((r) => r.count > 0)
                    .map((r) => (
                      <tr key={r.outcome}>
                        <td>{STATUS_LABEL[r.outcome]}</td>
                        <td>
                          {r.count}
                          {r.count < SMALL_SAMPLE && <span className="muted"> (small sample)</span>}
                        </td>
                        <td>{r.meanFit ?? "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            {applications.length === 0 ? (
              <p className="muted">
                {syncing ? "Scanning your inbox…" : `No application emails found in the last ${WINDOW_DAYS} days.`}
              </p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Role</th>
                    <th>Applied</th>
                    <th>Status</th>
                    <th>Last update</th>
                    <th>Fit</th>
                    <th>JD match</th>
                    <th>Tracker</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((app) => (
                    <tr key={app.key}>
                      <td>{app.company}</td>
                      <td>
                        {app.role ?? <span className="muted">Role not stated</span>}
                        <details>
                          <summary className="muted">
                            {app.emails.length} email{app.emails.length === 1 ? "" : "s"}
                          </summary>
                          <ul>
                            {app.emails.map((email) => (
                              <li key={email.id}>
                                <a href={email.gmailUrl} target="_blank" rel="noreferrer">
                                  {email.subject || "(no subject)"}
                                </a>{" "}
                                <span className="muted">
                                  · {formatDate(email.date)} · {email.eventType}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                      <td>{formatDate(app.appliedAt)}</td>
                      <td>
                        <span className={`pill ${STATUS_PILL[app.status]}`}>{STATUS_LABEL[app.status]}</span>
                      </td>
                      <td>{formatDate(app.lastUpdateAt)}</td>
                      <td>
                        {app.evaluation?.fitTotal !== undefined ? (
                          <div className="stack" style={{ gap: "0.2rem" }}>
                            <strong>{Math.round(app.evaluation.fitTotal)}</strong>
                            {app.evaluation.recommendedResume && (
                              <span className="muted">{app.evaluation.recommendedResume} resume</span>
                            )}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <JdMatchBadge evaluation={app.evaluation} />
                      </td>
                      <td>
                        {app.trackerJobId ? (
                          <div className="stack" style={{ gap: "0.35rem" }}>
                            <Link to={`/jobs/${app.trackerJobId}/detail`}>
                              In tracker: {JOB_STATUS_LABEL[app.trackerStatus!] ?? app.trackerStatus}
                            </Link>
                            {app.suggestedStatus && (
                              <button
                                className="btn-secondary"
                                disabled={updatingKey === app.key}
                                onClick={() => void onUpdateTracker(app)}
                              >
                                {updatingKey === app.key
                                  ? "Updating…"
                                  : `Update to ${JOB_STATUS_LABEL[app.suggestedStatus] ?? app.suggestedStatus}`}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="muted">Not in tracker</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
}
