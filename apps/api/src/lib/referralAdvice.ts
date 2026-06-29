import {
  CREDENTIAL_REFERRAL_SOFTEN_THRESHOLD,
} from "./certificationBoost.js";
import {
  SURVIVABILITY_TARGET_NEUTRAL,
  SURVIVABILITY_WEIGHTS,
  type SurvivabilitySubFactorKey,
} from "../config/capabilitySurvivabilityPolicy.js";
import type { SurvivabilityBreakdown } from "./survivabilityScore.js";

export type ReferralUrgency = "strongly_advised" | "advised" | "optional";

const REFERRAL_ADDRESSABLE_KEYS: SurvivabilitySubFactorKey[] = [
  "credentialSignal",
  "employerRecognizability",
];

/** Weighted headroom below neutral on factors a referral can realistically help. */
export const computeReferralAddressableShortfall = (
  breakdown: SurvivabilityBreakdown,
): number => {
  let shortfall = 0;
  for (const key of REFERRAL_ADDRESSABLE_KEYS) {
    const headroom = Math.max(0, SURVIVABILITY_TARGET_NEUTRAL - breakdown[key]);
    shortfall += headroom * SURVIVABILITY_WEIGHTS[key];
  }
  return shortfall;
};

export const resolveReferralUrgency = (shortfall: number): ReferralUrgency => {
  if (shortfall >= 0.1) return "strongly_advised";
  if (shortfall >= 0.04) return "advised";
  return "optional";
};

export const downgradeReferralUrgency = (urgency: ReferralUrgency): ReferralUrgency => {
  if (urgency === "strongly_advised") return "advised";
  if (urgency === "advised") return "optional";
  return "optional";
};

const pathwaySource = (notes: string): string => {
  const first = notes.split(";")[0]?.trim();
  if (!first) return "your network";
  if (first.startsWith("Connection via ")) {
    return first.replace(/^Connection via /i, "");
  }
  if (first.startsWith("Shared program connection (")) {
    const match = first.match(/\(([^)]+)\)/);
    return match?.[1] ?? first;
  }
  if (first.startsWith("Connection from previous company (")) {
    const match = first.match(/\(([^)]+)\)/);
    return match?.[1] ?? first;
  }
  return first;
};

export type ReferralAdviceResult = {
  advice: string;
  urgency: ReferralUrgency;
  shortfall: number;
};

/** Derived from score only — never feeds back into scoring. */
export const deriveReferralAdvice = (params: {
  survivabilityBreakdown?: SurvivabilityBreakdown;
  referralPathwayAvailable?: boolean;
  referralPathwayNotes?: string;
}): ReferralAdviceResult => {
  const shortfall = params.survivabilityBreakdown
    ? computeReferralAddressableShortfall(params.survivabilityBreakdown)
    : 0;
  let urgency = resolveReferralUrgency(shortfall);

  if (
    (params.survivabilityBreakdown?.credentialSignal ?? 0) >=
    CREDENTIAL_REFERRAL_SOFTEN_THRESHOLD
  ) {
    urgency = downgradeReferralUrgency(urgency);
  }

  let advice: string;
  if (urgency === "strongly_advised") {
    advice =
      "Cold-apply odds are low for routable reasons (credential / recognizability) — a referral would substantially help.";
  } else if (urgency === "advised") {
    advice = "A referral would help here.";
  } else {
    advice = "Odds are solid; a referral is optional but never hurts.";
  }

  if (params.referralPathwayAvailable && params.referralPathwayNotes?.trim()) {
    advice = `${advice.replace(/\.$/, "")} — and you have a connection via ${pathwaySource(params.referralPathwayNotes)}.`;
  }

  return { advice, urgency, shortfall };
};
