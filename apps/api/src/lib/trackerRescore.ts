import type { JobRecord, JobStatus } from "../types/job.js";
import type { RuleEvaluation } from "../types/scoring.js";

const AI_ROLE_RE =
  /\b(llm|large language model|rag\b|retrieval[-\s]?augmented|applied ai|generative ai|ai engineer|ml engineer|machine learning engineer|vector\s+(search|embedding|db)|embedding|agentic|ai agents?|devai|mcp\b|fine[-\s]?tun|evals?\b)\b/i;

/** JD + title blob for role-shape detection. */
export function jobAppliedAiBlob(job: Pick<JobRecord, "extracted">): string {
  const e = job.extracted;
  return [
    e.title,
    e.rawText ?? "",
    ...(e.responsibilities ?? []),
    ...(e.requirements ?? []),
    ...(e.stack ?? []),
  ]
    .join("\n")
    .toLowerCase();
}

export function isAppliedAiRole(job: Pick<JobRecord, "extracted">): boolean {
  return AI_ROLE_RE.test(jobAppliedAiBlob(job));
}

export function hadRescorePenaltySignals(
  rules: RuleEvaluation,
  job: Pick<JobRecord, "extracted" | "mainRisk" | "risks">,
): boolean {
  const financeOrTraditional = rules.financePenalty || rules.traditionalCompanyPenalty;
  const locationSignal =
    rules.locationMismatch || job.extracted.locationIsCommutable === false;
  const narrative = [job.mainRisk, ...(job.risks ?? [])].join(" ").toLowerCase();
  const pythonSignal =
    /\bpython\b/.test(narrative) && /\b(type\s*script|typescript|javascript|node)\b/.test(narrative);
  const rulesPython = rules.notes.some((n) => /\bpython\b/i.test(n) && /type|script|stack|primary/i.test(n));
  return financeOrTraditional || locationSignal || pythonSignal || rulesPython;
}

export type RescoreEligibility = {
  /** In 50–70 band on current stored score. */
  inTargetBand: boolean;
  isAiShaped: boolean;
  hadPenaltySignals: boolean;
};

export function getRescoreEligibility(job: JobRecord): RescoreEligibility {
  const total = job.score.total;
  const inTargetBand = total > 50 && total <= 70;
  return {
    inTargetBand,
    isAiShaped: isAppliedAiRole(job),
    hadPenaltySignals: hadRescorePenaltySignals(job.rules, job),
  };
}

/** Strict candidate: band + applied-AI + at least one listed penalty dimension. */
export function isStrictRescoreCandidate(job: JobRecord): boolean {
  const e = getRescoreEligibility(job);
  return e.inTargetBand && e.isAiShaped && e.hadPenaltySignals;
}

const BLOCKED: JobStatus[] = ["rejected", "closed"];

export function isBlockedStatusForRescore(status: JobStatus): boolean {
  return BLOCKED.includes(status);
}

export function crossesScoreThreshold(
  oldTotal: number,
  newTotal: number,
  threshold: number,
): boolean {
  return (oldTotal < threshold && newTotal >= threshold) || (oldTotal >= threshold && newTotal < threshold);
}

export type RescoreUpdateDecision = {
  apply: boolean;
  reason:
    | "delta_ge_5"
    | "crosses_70"
    | "crosses_78"
    | "skip_low_score"
    | "skip_high_score"
    | "skip_blocked_status"
    | "skip_small_delta";
};

/**
 * Whether to persist a new score per controlled rescoring rules.
 * Boundary crossings (70 = viable, 78 = shortlist band) always apply when not blocked.
 */
export function shouldPersistRescore(params: {
  oldTotal: number;
  newTotal: number;
  status: JobStatus;
  /** Skip roles that were <50 unless true */
  forceLowScores?: boolean;
  /** Allow updating roles that were ≥85 */
  forceHighScores?: boolean;
}): RescoreUpdateDecision {
  const { oldTotal, newTotal, status, forceLowScores, forceHighScores } = params;
  if (isBlockedStatusForRescore(status)) {
    return { apply: false, reason: "skip_blocked_status" };
  }
  if (oldTotal < 50 && !forceLowScores) {
    return { apply: false, reason: "skip_low_score" };
  }
  if (oldTotal >= 85 && !forceHighScores) {
    return { apply: false, reason: "skip_high_score" };
  }
  if (crossesScoreThreshold(oldTotal, newTotal, 70)) {
    return { apply: true, reason: "crosses_70" };
  }
  if (crossesScoreThreshold(oldTotal, newTotal, 78)) {
    return { apply: true, reason: "crosses_78" };
  }
  if (Math.abs(newTotal - oldTotal) >= 5) {
    return { apply: true, reason: "delta_ge_5" };
  }
  return { apply: false, reason: "skip_small_delta" };
}
