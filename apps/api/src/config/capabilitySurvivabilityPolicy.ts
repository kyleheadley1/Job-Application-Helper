/** Capability dimension maxes (sum = 100). */
export const CAPABILITY_MAXES = {
  stackFit: 35,
  levelFit: 30,
  functionalOverlap: 35,
} as const;

/** Legacy LLM category maxes used before rescaling into capability. */
export const LEGACY_CAPABILITY_SOURCE_MAXES = {
  stackFit: 20,
  levelFit: 20,
  functionalOverlap: 15,
} as const;

export const SURVIVABILITY_TUNING = {
  /** Floor for survivability multiplier (absent hard gate). */
  floor: 0.3,
  /** Threshold on 2x2 matrix — at/above = good cold-apply odds. */
  goodOddsThreshold: 0.55,
  /** Capability threshold on 2x2 matrix. */
  strongCapabilityThreshold: 70,
  /** Final score when a Section-1 hard gate fires. */
  hardGateScoreFloor: 25,
} as const;

export const SURVIVABILITY_WEIGHTS = {
  employerRecognizability: 0.22,
  credentialSignal: 0.15,
  impactMetricQuality: 0.18,
  resumeStoryCoherence: 0.15,
  domainMatchForListing: 0.15,
  poolFriendliness: 0.15,
} as const;

export type SurvivabilitySubFactorKey = keyof typeof SURVIVABILITY_WEIGHTS;

import type { Recommendation } from "../types/scoring.js";

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  apply_cold: "Strong fit, good screen odds",
  referral_gated: "Strong fit, low cold-apply odds — get a referral / tailor resume / nail the essay",
  stretch_signal: "Stretch on skills; signal may carry you",
  skip: "Weak fit and weak odds",
  no: "Hard gate — do not apply",
  yes: "Strong fit, good screen odds",
  selective_yes: "Strong fit, low cold-apply odds — get a referral / tailor resume / nail the essay",
};
