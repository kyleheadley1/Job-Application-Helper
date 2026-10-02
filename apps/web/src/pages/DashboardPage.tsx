import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { ScoringDetailsPanel } from "../components/ScoringDetailsPanel";
import type {
  ApplicationStatus,
  CostSummary,
  EvaluationSummary,
  LlmFeature,
  RecoveryMetrics,
  StageBucket,
  EvaluationsResponse,
  GmailApplication,
  GmailStatus,
  RecoveryStart,
  UpcomingInterview,
} from "../types/gmail";
import type { JobStatus } from "../types/job";

const WINDOW_OPTIONS = [7, 30] as const;
type WindowDays = (typeof WINDOW_OPTIONS)[number];
const WINDOW_STORAGE_KEY = "dashboard.windowDays";
const AUTO_SYNC_AFTER_MS = 15 * 60 * 1000;
const RECOVERY_POLL_MS = 5000;
const SMALL_SAMPLE = 5;
const MIN_PASTED_JD_CHARS = 300;
const SERPER_LOW_BUDGET_SHARE = 0.2;

const STATUS_ORDER: ApplicationStatus[] = ["applied", "assessment", "interviewing", "rejected", "offer"];

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  applied: "Applied",
  assessment: "Assessment",
  interviewing: "Interview",
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
  serper_not_configured: "search not configured",
  serper_no_results: "search found nothing",
  no_search_terms: "no title or req ID to search",
  no_email_evidence: "no link or JD in email",
  no_usable_posting: "links didn't load",
  email_links_failed: "email's job link didn't load",
  multiple_title_matches: "several open jobs share this title",
  board_found_no_search: "company board checked",
  not_on_board: "not on the company's job board (may be closed)",
  no_board_found: "company job board not found",
  role_unknown: "role not stated",
};

const reasonLabel = (note: string) => REASON_LABEL[note] ?? note.replace(/_/g, " ");

type BoardCheck = NonNullable<EvaluationSummary["boardChecks"]>[number];

const boardCheckLabel = (check: BoardCheck): string => {
  const jobs = `${check.jobs} open job${check.jobs === 1 ? "" : "s"}`;
  if (check.jobs === 0) return `board has no open jobs (posting likely closed)`;
  return check.closestTitle
    ? `${jobs}; closest: "${check.closestTitle}" (${Math.round((check.similarity ?? 0) * 100)}% title match)`
    : `${jobs}; none with a similar title (likely closed)`;
};

const detailsTooltip = (evaluation: EvaluationSummary): string | undefined => {
  const notes = evaluation.notes?.length ? evaluation.notes : evaluation.reason ? [evaluation.reason] : [];
  const lines = [
    ...notes.map((n) => `• ${reasonLabel(n)}`),
    ...(evaluation.boardChecks ?? []).map((c) => `• ${c.board}: ${boardCheckLabel(c)}`),
    ...(evaluation.attempts ?? []).map(
      (a) => `${a.ok ? `ok (${a.matchLevel ?? "?"})` : `failed (${a.reason ?? "error"})`} [${a.source}] ${a.url}`,
    ),
  ];
  return lines.length ? lines.join("\n") : undefined;
};

type RecoveryFilter = "all" | "scored" | "review" | "missing" | "pending";

const filterOf = (app: GmailApplication): Exclude<RecoveryFilter, "all"> => {
  const status = app.evaluation?.status;
  if (!status) return "pending";
  if (status === "scored") return "scored";
  if (status === "unverified") return "review";
  return "missing";
};

const FILTER_LABEL: Record<RecoveryFilter, string> = {
  all: "All",
  scored: "Scored",
  review: "Needs your pick",
  missing: "Not found",
  pending: "Not checked yet",
};

const fitClass = (fit: number) => (fit >= 75 ? "good" : fit >= 60 ? "warn" : "bad");

const CATEGORY_LABEL: Record<string, string> = {
  stackFit: "Stack",
  levelFit: "Level",
  domainFit: "Domain",
  resumeStoryClarity: "Resume story",
  functionalOverlap: "Functional overlap",
  recruiterFriendliness: "Recruiter friendliness",
  careerValue: "Career value",
};

const fitTooltip = (evaluation: EvaluationSummary): string => {
  const b = evaluation.fitBreakdown;
  if (!b) return "Scored before breakdowns were stored. Scores are final and are not re-run.";
  return [
    `Capability ${b.capability ?? "?"} · survivability ${b.survivability ?? "?"}${b.gapDock ? ` · gap dock −${b.gapDock}` : ""}`,
    ...Object.entries(b.categories).map(([k, v]) => `${CATEGORY_LABEL[k] ?? k}: ${v}`),
    ...(b.hardGates ?? []).map((g) => `Hard gate: ${g}`),
    b.topMatch ? `Top match: ${b.topMatch}` : "",
    b.mainRisk ? `Main risk: ${b.mainRisk}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

/** Got at least one interview, whatever happened after. */
const reachedInterview = (app: GmailApplication) =>
  (app.interviewRounds?.length ?? 0) > 0 || app.furthestStage === "interviewing" || app.furthestStage === "offer";

const STATUS_CARD_HINT: Record<ApplicationStatus, string> = {
  applied: "Applied, no response beyond the confirmation yet",
  assessment: "Latest step is an assessment",
  interviewing: "Reached at least one interview, whatever happened after (includes later rejections)",
  rejected: "Rejected at any stage",
  offer: "Received an offer",
};

/** "Interviewing" only while the process is active; a stalled one reads "Interviewed". */
const statusPillLabel = (app: GmailApplication): string => {
  if (app.status !== "interviewing") return STATUS_LABEL[app.status];
  return app.activelyInterviewing === false ? "Interviewed" : "Interviewing";
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Current interview round under the status pill, or the round a rejection came after. */
function StageNote({ app }: { app: GmailApplication }) {
  const rounds = app.interviewRounds ?? [];
  const last = rounds[rounds.length - 1];
  const title = rounds.length > 1 ? rounds.map((r) => r.label).join("\n") : undefined;
  if (last && (app.status === "interviewing" || app.status === "rejected" || app.status === "offer")) {
    const text = app.status === "interviewing" ? last.label : `after ${lowerFirst(last.label)}`;
    return (
      <div className="muted smallText" title={title}>
        {text}
      </div>
    );
  }
  if (app.status === "rejected" && app.furthestStage && app.furthestStage !== "applied") {
    return <div className="muted smallText">after {STATUS_LABEL[app.furthestStage].toLowerCase()}</div>;
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Today", "Tomorrow", "In 3 days", or "Now" while the interview is under way. */
const relativeDay = (at: Date, now: Date): string => {
  if (at.getTime() <= now.getTime()) return "Now";
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
};

const interviewWhen = (iv: UpcomingInterview): string => {
  const start = new Date(iv.scheduledAt);
  const date = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const end = iv.durationMinutes ? new Date(start.getTime() + iv.durationMinutes * 60_000) : null;
  const zone = start.toLocaleTimeString(undefined, { timeZoneName: "short" }).split(" ").pop();
  return `${date} · ${time(start)}${end ? `–${time(end)}` : ""} ${zone ?? ""}`.trim();
};

/** Confirmed interviews that haven't ended yet, soonest first. */
function UpcomingInterviewsCard({ interviews, active }: { interviews: UpcomingInterview[]; active: GmailApplication[] }) {
  const now = new Date();
  return (
    <div className="card stack" style={{ gap: "0.5rem" }}>
      <div className="rowBetween">
        <strong>Upcoming interviews</strong>
        <span className="muted smallText" title="Open applications with an upcoming interview or interview activity in the last 3 weeks">
          Interviewing now: {active.length === 0 ? "none" : active.map((a) => a.company).join(", ")}
        </span>
      </div>
      {interviews.length === 0 ? (
        <span className="muted smallText">No confirmed interview times found in the last 60 days of email.</span>
      ) : (
        <table className="table">
          <tbody>
            {interviews.map((iv) => {
              const soon = new Date(iv.scheduledAt).getTime() - now.getTime() < DAY_MS;
              return (
                <tr key={`${iv.key}-${iv.roundNumber}`}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span className={`pill ${soon ? "warn" : "good"}`}>{relativeDay(new Date(iv.scheduledAt), now)}</span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{interviewWhen(iv)}</td>
                  <td>
                    <strong>{iv.company}</strong>
                    {iv.role && <div className="muted smallText">{iv.role}</div>}
                  </td>
                  <td>{iv.label}</td>
                  <td>
                    {iv.gmailUrl && (
                      <a href={iv.gmailUrl} target="_blank" rel="noreferrer" className="smallText">
                        Open email
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FitCell({
  evaluation,
  open,
  onToggle,
}: {
  evaluation?: EvaluationSummary;
  open: boolean;
  onToggle: () => void;
}) {
  if (evaluation?.fitTotal === undefined) return <span className="muted">—</span>;
  return (
    <div className="stack" style={{ gap: "0.2rem" }} title={`${fitTooltip(evaluation)}\n\nClick for full scoring details`}>
      <button
        type="button"
        className={`pill fitScore ${fitClass(evaluation.fitTotal)}`}
        onClick={onToggle}
        aria-expanded={open}
        style={{ cursor: "pointer", border: "none", font: "inherit" }}
      >
        {Math.round(evaluation.fitTotal)} {open ? "▾" : "▸"}
      </button>
      {evaluation.recommendedResume && (
        <span className="muted smallText">{evaluation.recommendedResume} resume</span>
      )}
    </div>
  );
}

const usd = (n: number | null | undefined) =>
  n == null ? "—" : n === 0 ? "$0" : n < 0.01 ? `${(n * 100).toFixed(2)}¢` : `$${n.toFixed(2)}`;

const FEATURE_LABEL: Record<LlmFeature, string> = {
  gmail_classify: "Email classification",
  jd_recovery: "JD scoring",
  other: "Other (tracker, top jobs, assets)",
};

function CostCard({ costs }: { costs: CostSummary }) {
  const features = (Object.keys(costs.byFeature) as LlmFeature[]).filter((f) => costs.byFeature[f].calls > 0);
  return (
    <div className="card stack">
      <strong>OpenAI cost</strong>
      {!costs.trackingSince ? (
        <p className="muted smallText">No calls recorded yet. Costs are tracked from now on ({costs.model}).</p>
      ) : (
        <>
          <div className="chipRow">
            <span className="pointChip">
              Today <strong>{usd(costs.today)}</strong>
            </span>
            <span className="pointChip">
              Last 7 days <strong>{usd(costs.last7Days)}</strong>
            </span>
            <span className="pointChip">
              Per scored role <strong>{usd(costs.perScoredRole)}</strong>
            </span>
            <span className="pointChip">
              Per email <strong>{usd(costs.perEmailClassified)}</strong>
            </span>
          </div>
          <table className="table">
            <tbody>
              {features.map((f) => (
                <tr key={f}>
                  <td>{FEATURE_LABEL[f]}</td>
                  <td>{costs.byFeature[f].calls} calls</td>
                  <td>{usd(costs.byFeature[f].costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <span className="muted smallText">
            Estimated from OpenAI-reported tokens at {costs.model} list prices. Tracking since{" "}
            {formatDateTime(costs.trackingSince)}.
          </span>
        </>
      )}
    </div>
  );
}

const BUCKET_LABEL: Record<StageBucket, string> = {
  email: "Email (JD or posting link)",
  company_board: "Company job board (free APIs)",
  serper: "Serper web search",
  manual: "Pasted by you",
};

function MetricsCard({ metrics }: { metrics: RecoveryMetrics }) {
  const s = metrics.serper;
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
  return (
    <div className="card stack">
      <strong>Where the JDs came from</strong>
      <p className="smallText">
        Useful data for <strong>{metrics.withUsefulData}</strong> of {metrics.applications} applications (
        {pct(metrics.withUsefulData, metrics.applications)}): {metrics.verifiedAuto} verified automatically,{" "}
        {metrics.userPicked + metrics.userPasted} by you, {metrics.needsPick} waiting for your pick. {metrics.notFound}{" "}
        not found.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Verified</th>
            <th>Candidates only</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(metrics.byBucket) as StageBucket[]).map((b) => (
            <tr key={b}>
              <td>{BUCKET_LABEL[b]}</td>
              <td>{metrics.byBucket[b].verified}</td>
              <td>{metrics.byBucket[b].candidatesOnly}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="smallText">
        Serper: searched {s.jobsSearched} jobs, results for {s.jobsWithResults}, useful for{" "}
        <strong>{s.verified + s.candidatesOnly}</strong> ({s.verified} verified, {s.candidatesOnly} candidates only).
      </span>
      <span className="muted smallText">
        {s.queriesUsed} of {s.budget} query budget used ({s.freeGrant.toLocaleString()} free one-time Serper credits).
      </span>
    </div>
  );
}

function JdMatchCell({
  evaluation,
  open,
  onToggle,
}: {
  evaluation?: EvaluationSummary;
  open: boolean;
  onToggle: () => void;
}) {
  if (!evaluation) return <span className="muted">Not checked yet</span>;
  const { status, matchLevel, url, verifiedBy } = evaluation;
  const [label, pill] =
    status === "scored"
      ? verifiedBy === "user"
        ? ["You picked", "good"]
        : matchLevel === "exact"
          ? ["Exact (req ID)", "good"]
          : ["High", "good"]
      : status === "unverified"
        ? ["Needs your pick", "warn"]
        : status === "fetch_failed"
          ? ["Fetch failed", "bad"]
          : ["Not found", "bad"];
  const badge = <span className={`pill ${pill}`}>{label}</span>;
  const firstNote = evaluation.notes?.[0] ?? evaluation.reason;
  return (
    <div className="stack" style={{ gap: "0.2rem" }} title={detailsTooltip(evaluation)}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          {badge}
        </a>
      ) : (
        badge
      )}
      {status === "scored" && evaluation.jdTitle && <span className="muted smallText">{evaluation.jdTitle}</span>}
      {status !== "scored" && firstNote && <span className="muted smallText">{reasonLabel(firstNote)}</span>}
      {status !== "scored" && evaluation.boardChecks?.[0] && (
        <span className="muted smallText">{boardCheckLabel(evaluation.boardChecks[0])}</span>
      )}
      {evaluation.recoveredRole && (
        <span className="muted smallText">role from email: {evaluation.recoveredRole}</span>
      )}
      {status !== "scored" && (
        <button className="btn-secondary smallText" onClick={onToggle}>
          {open ? "Close" : evaluation.candidates?.length ? `Review (${evaluation.candidates.length})` : "Paste JD"}
        </button>
      )}
    </div>
  );
}

function ReviewPanel({
  app,
  onScored,
}: {
  app: GmailApplication;
  onScored: (evaluation: EvaluationSummary) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const candidates = app.evaluation?.candidates ?? [];

  const run = async (id: string, action: () => Promise<{ evaluation: EvaluationSummary }>) => {
    setBusy(id);
    setError(null);
    try {
      onScored((await action()).evaluation);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="reviewPanel stack">
      <span className="muted smallText">
        The scorer only sees the JD text, never the email or outcome. Scoring takes about a minute.
      </span>
      {candidates.length > 0 && (
        <div className="stack" style={{ gap: "0.4rem" }}>
          <strong>Is it one of these?</strong>
          {candidates.map((c) => (
            <div key={c.url} className="rowBetween">
              <span>
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.title ?? c.url}
                </a>
                {c.location && <span className="muted"> · {c.location}</span>}
                <span className="muted smallText"> · {c.matchLevel} match</span>
              </span>
              <button disabled={busy !== null} onClick={() => void run(c.url, () => api.gmailConfirmCandidate(app.key, c.url))}>
                {busy === c.url ? "Scoring…" : "This is the one"}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="stack" style={{ gap: "0.4rem" }}>
        <strong>{candidates.length ? "Or paste the JD" : "Paste the JD"}</strong>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the full job description" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Posting URL (optional)" />
        <div>
          <button
            disabled={busy !== null || text.trim().length < MIN_PASTED_JD_CHARS}
            onClick={() => void run("paste", () => api.gmailPasteJd(app.key, text, url))}
          >
            {busy === "paste" ? "Scoring…" : "Score pasted JD"}
          </button>
          {text.trim().length > 0 && text.trim().length < MIN_PASTED_JD_CHARS && (
            <span className="muted smallText"> At least {MIN_PASTED_JD_CHARS} characters.</span>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const readWindow = (): WindowDays => {
  const stored = Number(window.localStorage.getItem(WINDOW_STORAGE_KEY));
  return (WINDOW_OPTIONS as readonly number[]).includes(stored) ? (stored as WindowDays) : 7;
};

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [applications, setApplications] = useState<GmailApplication[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [pendingRecovery, setPendingRecovery] = useState(0);
  const [upcoming, setUpcoming] = useState<UpcomingInterview[]>([]);
  const [evaluations, setEvaluations] = useState<EvaluationsResponse | null>(null);
  const [windowDays, setWindowDays] = useState<WindowDays>(readWindow);
  const [filter, setFilter] = useState<RecoveryFilter>("all");
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const [scoringKey, setScoringKey] = useState<string | null>(null);
  const autoSynced = useRef(false);

  const loadEvaluations = useCallback(async () => {
    const result = await api.gmailEvaluations(windowDays);
    setEvaluations(result);
    return result;
  }, [windowDays]);

  const loadApplications = useCallback(async () => {
    const { applications: items, pendingRecovery: pending, upcomingInterviews } = await api.gmailApplications(windowDays);
    setApplications(items);
    setPendingRecovery(pending);
    setUpcoming(upcomingInterviews ?? []);
    await loadEvaluations().catch(() => null);
  }, [windowDays, loadEvaluations]);

  const afterRecoveryStart = useCallback(
    async (start?: RecoveryStart) => {
      if (start?.started || start?.running) await loadEvaluations().catch(() => null);
    },
    [loadEvaluations],
  );

  const runSync = useCallback(async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const result = await api.gmailSync(windowDays);
      setApplications(result.applications);
      setPendingRecovery(result.pendingRecovery);
      setUpcoming(result.upcomingInterviews ?? []);
      setStatus(await api.gmailStatus());
      await afterRecoveryStart(result.recovery);
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
  }, [windowDays, afterRecoveryStart]);

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
    window.localStorage.setItem(WINDOW_STORAGE_KEY, String(windowDays));
  }, [windowDays]);

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
      const result = await api.gmailRunRecovery(windowDays);
      if (!result.started && !result.running) {
        setNotice({ kind: "ok", text: "Nothing to recover." });
        return;
      }
      await afterRecoveryStart(result);
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

  const onScored = (key: string, evaluation: EvaluationSummary) => {
    setApplications((apps) => apps.map((a) => (a.key === key ? { ...a, evaluation } : a)));
    setReviewKey(null);
    void loadEvaluations().catch(() => null);
  };

  const counts = STATUS_ORDER.map((s) => ({
    status: s,
    count: applications.filter((a) => (s === "interviewing" ? reachedInterview(a) : a.status === s)).length,
  }));
  const activeInterviews = applications.filter((a) => a.activelyInterviewing);

  const filterCounts = (Object.keys(FILTER_LABEL) as RecoveryFilter[]).map((f) => ({
    filter: f,
    count: f === "all" ? applications.length : applications.filter((a) => filterOf(a) === f).length,
  }));
  const visible = filter === "all" ? applications : applications.filter((a) => filterOf(a) === filter);
  const rubric = evaluations?.rubricSummary;

  return (
    <section className="stack">
      <div className="rowBetween">
        <div className="row" style={{ alignItems: "center", gap: "0.75rem" }}>
          <h2 style={{ margin: 0 }}>Applications</h2>
          <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value) as WindowDays)}>
            {WINDOW_OPTIONS.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
        </div>
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
                title="Find each application's job description and score it (newest first). Also runs after every sync."
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

          <UpcomingInterviewsCard interviews={upcoming} active={activeInterviews} />

          <div className="grid" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
            {counts.map(({ status: s, count }) => (
              <div key={s} className="card" title={STATUS_CARD_HINT[s]}>
                <div className="muted">{STATUS_LABEL[s]}</div>
                <div style={{ fontSize: "1.8rem", fontWeight: 700 }}>{count}</div>
              </div>
            ))}
          </div>

          {evaluations && !evaluations.serper.configured && (
            <p className="muted smallText">
              Web search fallback is off (add <code>SERPER_API_KEY</code> to enable it). Free job-board lookups still run.
            </p>
          )}
          {evaluations?.serper.configured && evaluations.serper.used >= evaluations.serper.cap && (
            <p className="muted smallText">
              Web search budget used up ({evaluations.serper.used}/{evaluations.serper.cap} queries). Free job-board
              lookups still run.
            </p>
          )}
          {evaluations?.serper.configured &&
            evaluations.serper.used < evaluations.serper.cap &&
            evaluations.serper.cap - evaluations.serper.used <= evaluations.serper.cap * SERPER_LOW_BUDGET_SHARE && (
              <p className="card smallText">
                <strong>Serper budget running low:</strong> {evaluations.serper.cap - evaluations.serper.used} of{" "}
                {evaluations.serper.cap} queries left. Serper's free credits are one-time, so plan to raise{" "}
                <code>SERPER_MAX_QUERIES_TOTAL</code> (up to the 2,500 free grant), switch to a provider with a recurring
                free tier, or remove <code>SERPER_API_KEY</code> and pick from board candidates yourself.
              </p>
            )}

          {(evaluations?.costs || evaluations?.metrics) && (
            <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              {evaluations.costs && <CostCard costs={evaluations.costs} />}
              {evaluations.metrics && <MetricsCard metrics={evaluations.metrics} />}
            </div>
          )}

          {rubric && rubric.scored > 0 && (
            <div className="card stack">
              <strong>Fit score vs outcome</strong>
              <p className="muted smallText">
                Each JD was scored blind to the outcome.
                {rubric.userVerified > 0 && ` ${rubric.userVerified} of ${rubric.scored} were picked by you.`}
                {rubric.scored < SMALL_SAMPLE * 2 && ` Only ${rubric.scored} scored so far, so read these as anecdotes.`}
              </p>
              {rubric.reachedInterview && rubric.reachedInterview.count > 0 && (
                <p className="smallText">
                  Reached an interview (any outcome after): {rubric.reachedInterview.count} scored, mean fit{" "}
                  <strong>{rubric.reachedInterview.meanFit}</strong>
                </p>
              )}
              <table className="table">
                <thead>
                  <tr>
                    <th>Outcome</th>
                    <th>Mean fit</th>
                    <th>Scores</th>
                  </tr>
                </thead>
                <tbody>
                  {rubric.rows
                    .filter((r) => r.count > 0)
                    .map((r) => (
                      <tr key={r.outcome}>
                        <td>
                          {STATUS_LABEL[r.outcome]}
                          <div className="muted smallText">
                            {r.count} scored{r.count < SMALL_SAMPLE ? " (small sample)" : ""}
                          </div>
                        </td>
                        <td>{r.meanFit ?? "—"}</td>
                        <td>
                          {(rubric.points[r.outcome] ?? []).map((p, i) => (
                            <span
                              key={`${p.company}-${i}`}
                              className="pointChip"
                              title={`${p.company}${p.role ? ` — ${p.role}` : ""}${p.verifiedBy === "user" ? " (picked by you)" : ""}`}
                            >
                              {p.company} <strong>{Math.round(p.fit)}</strong>
                              {p.verifiedBy === "user" ? " *" : ""}
                              {r.outcome === "rejected" && p.furthestRound
                                ? ` (after ${lowerFirst(p.furthestRound.label)})`
                                : r.outcome === "rejected" && p.furthestStage && p.furthestStage !== "applied"
                                  ? ` (after ${STATUS_LABEL[p.furthestStage].toLowerCase()})`
                                  : ""}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {rubric.userVerified > 0 && <span className="muted smallText">* picked or pasted by you</span>}
            </div>
          )}

          <div className="card stack">
            {applications.length > 0 && (
              <div className="chipRow">
                {filterCounts.map(({ filter: f, count }) => (
                  <button key={f} className={`chip${filter === f ? " active" : ""}`} onClick={() => setFilter(f)}>
                    {FILTER_LABEL[f]}
                    <strong>{count}</strong>
                  </button>
                ))}
              </div>
            )}
            {applications.length === 0 ? (
              <p className="muted">
                {syncing ? "Scanning your inbox…" : `No application emails found in the last ${windowDays} days.`}
              </p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Role</th>
                    <th>Applied</th>
                    <th>Status</th>
                    <th>Fit</th>
                    <th>JD match</th>
                    <th>Tracker</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((app) => (
                    <Fragment key={app.key}>
                      <tr>
                        <td>{app.company}</td>
                        <td>
                          {app.role ?? <span className="muted">Role not stated</span>}
                          <details>
                            <summary className="muted smallText">
                              {app.emails.length} email{app.emails.length === 1 ? "" : "s"} · updated{" "}
                              {formatDate(app.lastUpdateAt)}
                            </summary>
                            <ul>
                              {app.emails.map((email) => (
                                <li key={email.id}>
                                  <a href={email.gmailUrl} target="_blank" rel="noreferrer">
                                    {email.subject || "(no subject)"}
                                  </a>{" "}
                                  <span className="muted">
                                    · {formatDate(email.date)} · {email.eventType}
                                    {email.round ? ` (round ${email.round})` : ""}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        </td>
                        <td>
                          {app.appliedAtKnown === false ? (
                            <>
                              <span className="muted">Before {formatDate(app.appliedAt)}</span>
                              <div
                                className="muted smallText"
                                title="No application confirmation email or tracker applied date was found; you applied on or before the earliest email."
                              >
                                date unknown
                              </div>
                            </>
                          ) : (
                            <>
                              {formatDate(app.appliedAt)}
                              {app.appliedAtSource === "tracker" && (
                                <div className="muted smallText" title="No confirmation email in this window; date applied comes from the tracker.">
                                  from tracker
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td>
                          <span className={`pill ${STATUS_PILL[app.status]}`}>{statusPillLabel(app)}</span>
                          <StageNote app={app} />
                        </td>
                        <td>
                          <FitCell
                            evaluation={app.evaluation}
                            open={scoringKey === app.key}
                            onToggle={() => setScoringKey(scoringKey === app.key ? null : app.key)}
                          />
                        </td>
                        <td>
                          <JdMatchCell
                            evaluation={app.evaluation}
                            open={reviewKey === app.key}
                            onToggle={() => setReviewKey(reviewKey === app.key ? null : app.key)}
                          />
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
                      {scoringKey === app.key && app.evaluation?.fitTotal !== undefined && (
                        <tr>
                          <td colSpan={7}>
                            <ScoringDetailsPanel appKey={app.key} />
                          </td>
                        </tr>
                      )}
                      {reviewKey === app.key && app.evaluation && (
                        <tr>
                          <td colSpan={7}>
                            <ReviewPanel app={app} onScored={(e) => onScored(app.key, e)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
