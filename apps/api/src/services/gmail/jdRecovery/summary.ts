import type { StoredResumeType } from "../../../types/resume.js";
import type { ApplicationStatus, GmailApplication } from "../gmailApplications.js";
import type { MatchLevel } from "./assessJdMatch.js";
import type { ApplicationEvaluation, RecoveryStatus } from "./evaluations.repository.js";

export type EvaluationSummary = {
  status: RecoveryStatus;
  reason?: string;
  fitTotal?: number;
  recommendation?: string;
  recommendedResume?: StoredResumeType;
  matchLevel?: MatchLevel;
  url?: string;
};

export const toEvaluationSummary = (e: ApplicationEvaluation): EvaluationSummary => ({
  status: e.recovery.status,
  reason: e.recovery.reason,
  fitTotal: e.fit?.total,
  recommendation: e.fit?.recommendation,
  recommendedResume: e.fit?.recommendedResume,
  matchLevel: e.recovery.match?.level,
  url: e.recovery.url,
});

export const withEvaluations = (
  apps: GmailApplication[],
  evaluations: Map<string, ApplicationEvaluation>,
): Array<GmailApplication & { evaluation?: EvaluationSummary }> =>
  apps.map((app) => {
    const e = evaluations.get(app.key);
    return e ? { ...app, evaluation: toEvaluationSummary(e) } : app;
  });

const OUTCOMES: ApplicationStatus[] = ["applied", "assessment", "interviewing", "rejected", "offer"];

export type RubricRow = { outcome: ApplicationStatus; count: number; meanFit: number | null };

export type RubricSummary = {
  rows: RubricRow[];
  scored: number;
  byRecoveryStatus: Record<RecoveryStatus, number>;
};

/** Mean fit per current outcome, scored rows only. */
export const buildRubricSummary = (evaluations: ApplicationEvaluation[]): RubricSummary => {
  const byRecoveryStatus: Record<RecoveryStatus, number> = {
    scored: 0,
    unverified: 0,
    not_found: 0,
    fetch_failed: 0,
  };
  const totals = new Map<ApplicationStatus, { sum: number; count: number }>();
  for (const e of evaluations) {
    byRecoveryStatus[e.recovery.status] += 1;
    if (e.recovery.status !== "scored" || !e.fit) continue;
    const t = totals.get(e.outcome.status) ?? { sum: 0, count: 0 };
    t.sum += e.fit.total;
    t.count += 1;
    totals.set(e.outcome.status, t);
  }
  const rows = OUTCOMES.map((outcome) => {
    const t = totals.get(outcome);
    return {
      outcome,
      count: t?.count ?? 0,
      meanFit: t && t.count > 0 ? Math.round((t.sum / t.count) * 10) / 10 : null,
    };
  });
  return { rows, scored: byRecoveryStatus.scored, byRecoveryStatus };
};
