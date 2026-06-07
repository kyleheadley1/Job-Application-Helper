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
    { min: 85, max: 100, label: "excellent fit / top target" },
    { min: 78, max: 84, label: "strong target" },
    { min: 70, max: 77, label: "viable with meaningful caveats" },
    { min: 60, max: 69, label: "stretch — needs clear upside" },
    { min: 0, max: 59, label: "usually skip" },
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
    { min: 85, max: 100, recommendation: "yes", note: "top / strong target" },
    { min: 78, max: 84, recommendation: "yes", note: "strong (caveats if gated)" },
    { min: 70, max: 77, recommendation: "selective_yes", note: "viable" },
    { min: 60, max: 69, recommendation: "no", note: "stretch — needs upside" },
    { min: 0, max: 59, recommendation: "no", note: "skip" },
  ],
  shortlist: {
    minScore: 78,
    blockedStatuses: ["rejected", "closed"],
  },
};

export const getTrackerColor = (status: JobStatus, score: number): "green" | "yellow" | "red" | "blue" => {
  if (status === "rejected" || status === "closed") return "red";
  if (status === "interviewing" || status === "assessment" || status === "offer") return "blue";
  if (status === "to_review" && score >= 78) return "green";
  return "yellow";
};

export const shouldShortlist = (score: number, status: JobStatus): boolean =>
  score >= scoringPolicy.shortlist.minScore && !scoringPolicy.shortlist.blockedStatuses.includes(status);
