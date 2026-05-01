import type { JobStatus } from "../types/job.js";
import type { Recommendation } from "../types/scoring.js";

export type ScoringPolicy = {
  weights: {
    stackFit: number;
    levelFit: number;
    domainFit: number;
    resumeStoryClarity: number;
    functionalOverlap: number;
    recruiterFriendliness: number;
    careerValue: number;
  };
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
  weights: {
    stackFit: 25,
    levelFit: 15,
    domainFit: 10,
    resumeStoryClarity: 15,
    functionalOverlap: 10,
    recruiterFriendliness: 15,
    careerValue: 10,
  },
  scoreBands: [
    { min: 85, max: 100, label: "excellent fit / top target" },
    { min: 78, max: 84, label: "strong target" },
    { min: 70, max: 77, label: "viable with meaningful caveats" },
    { min: 65, max: 69, label: "only apply if specific reason" },
    { min: 0, max: 64, label: "usually skip" },
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
    { min: 82, max: 100, recommendation: "yes", note: "strong apply" },
    { min: 74, max: 81, recommendation: "yes", note: "apply" },
    { min: 70, max: 73, recommendation: "selective_yes", note: "viable apply" },
    { min: 65, max: 69, recommendation: "selective_yes", note: "only if special reason" },
    { min: 0, max: 64, recommendation: "no", note: "skip" },
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
