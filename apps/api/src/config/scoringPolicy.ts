import type { JobStatus } from "../types/job.js";
import type { Recommendation } from "../types/scoring.js";

export const SCORE_CATEGORY_MAXES = {
  stackFit: 20,
  levelFit: 20,
  domainFit: 10,
  resumeStoryClarity: 10,
  functionalOverlap: 15,
  recruiterFriendliness: 15,
  careerValue: 10,
} as const;

/** Tunable caps for two-tier stack mismatch (applied after normal scoring). */
export const STACK_MISMATCH_CAPS = {
  tier1StackFitMax: 10,
  tier1ResumeStoryClarityMax: 5,
  tier2StackFitMax: 15,
  tier1TotalCap: 74,
} as const;

export const SCORING_CANONICAL_POLICY = `
CATEGORY MAXES: stackFit 20, levelFit 20, domainFit 10, functionalOverlap 15,
                resumeStoryClarity 10, recruiterFriendliness 15, careerValue 10
TOTAL = sum of seven, then total = min(sum, lowest applicable hard-gate cap)

BANDS:  85-100 top/strong target  |  78-84 strong (caveats if gated)
        70-77 viable  |  60-69 stretch (needs upside)  |  <60 skip

POSTURE: conservative recruiter-screen realism. Weigh each factor ONCE.
Hard gates are deterministic caps, not LLM judgment inputs.
Do not invent experience, scale, or production ownership.
`.trim();

export type ScoringPolicy = {
  weights: typeof SCORE_CATEGORY_MAXES;
  scoreBands: Array<{ min: number; max: number; label: string }>;
  hardPenalties: {
    degreeRequiredTraditional: number;
    degreeRequiredGeneral: number;
    newGradPipelineMismatch: number;
    earlyCareerSoftMismatch: number;
    seniorityOverreach: number;
    locationMismatch: number;
    sponsorshipMismatch: number;
    citizenshipMismatch: number;
    clearanceMismatch: number;
    stackMismatch: number;
    domainMismatch: number;
    startupFounderMismatch: number;
  };
  recommendationMapping: Array<{
    min: number;
    max: number;
    recommendation: Recommendation;
    note: string;
  }>;
  shortlist: {
    minScore: number;
    blockedStatuses: JobStatus[];
  };
};

export const scoringPolicy: ScoringPolicy = {
  weights: { ...SCORE_CATEGORY_MAXES },
  scoreBands: [
    { min: 80, max: 100, label: "Strong apply" },
    { min: 65, max: 79, label: "Apply" },
    { min: 50, max: 64, label: "Apply but weak (stretch)" },
    { min: 0, max: 49, label: "Weak" },
  ],
  hardPenalties: {
    degreeRequiredTraditional: 16,
    degreeRequiredGeneral: 10,
    newGradPipelineMismatch: 14,
    earlyCareerSoftMismatch: 4,
    seniorityOverreach: 12,
    locationMismatch: 18,
    sponsorshipMismatch: 25,
    citizenshipMismatch: 25,
    clearanceMismatch: 25,
    stackMismatch: 12,
    domainMismatch: 8,
    startupFounderMismatch: 8,
  },
  recommendationMapping: [
    { min: 80, max: 100, recommendation: "strong_apply", note: "Strong apply" },
    { min: 65, max: 79, recommendation: "apply", note: "Apply" },
    { min: 50, max: 64, recommendation: "stretch", note: "Apply but weak (stretch)" },
    { min: 0, max: 49, recommendation: "weak", note: "Weak" },
  ],
  shortlist: {
    minScore: 78,
    blockedStatuses: ["rejected", "closed", "applied", "lapsed"] as JobStatus[],
  },
};

export const TRACKER_PRIORITY_BY_RECOMMENDATION: Record<Recommendation, "high" | "medium" | "low"> = {
  strong_apply: "high",
  apply: "high",
  stretch: "medium",
  weak: "low",
};

export const TRACKER_ACTION_BY_RECOMMENDATION: Record<Recommendation, string> = {
  strong_apply: "Strong apply — tailor resume + cover letter",
  apply: "Apply",
  stretch: "Apply but weak (stretch) — apply if quick",
  weak: "Weak — skip unless special reason",
};

export const TRACKER_HARD_GATE_ACTION = "Weak — hard gate, do not apply";

export const getTrackerColor = (status: JobStatus, score: number): "green" | "yellow" | "red" | "blue" => {
  if (status === "rejected" || status === "closed" || status === "lapsed") return "red";
  if (status === "interviewing" || status === "assessment" || status === "offer") return "blue";
  if (status === "to_review" && score >= 50) return "green";
  return "yellow";
};

export { shouldShortlist } from "../lib/shortlist.js";
