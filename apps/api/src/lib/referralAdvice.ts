import {
  CREDENTIAL_REFERRAL_SOFTEN_THRESHOLD,
} from "./certificationBoost.js";
import {
  SURVIVABILITY_TARGET_NEUTRAL,
  SURVIVABILITY_WEIGHTS,
  type SurvivabilitySubFactorKey,
} from "../config/capabilitySurvivabilityPolicy.js";
import type { RuleEvaluation } from "../types/scoring.js";
import type { SurvivabilityBreakdown } from "./survivabilityScore.js";

export type ReferralUrgency = "strongly_advised" | "advised" | "optional";

const REFERRAL_ADDRESSABLE_KEYS: SurvivabilitySubFactorKey[] = [
  "credentialSignal",
  "employerRecognizability",
];

/**
 * Same required-language/stack signal that drives Key Risks ("Required core language gap: …")
 * and hard-rule notes — used so referral verbiage stays consistent with that severity.
 */
export const hasRequiredStackLanguageMismatch = (
  rules?: Pick<
    RuleEvaluation,
    "stackMismatch" | "explicitCoreLanguageMismatch" | "coreLanguageGap"
  > | null,
): boolean => {
  if (!rules) return false;
  if (rules.explicitCoreLanguageMismatch) return true;
  return Boolean(rules.stackMismatch && (rules.coreLanguageGap?.length ?? 0) > 0);
};

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

const appendPathway = (
  advice: string,
  referralPathwayAvailable?: boolean,
  referralPathwayNotes?: string,
): string => {
  if (!referralPathwayAvailable || !referralPathwayNotes?.trim()) return advice;
  return `${advice.replace(/\.$/, "")} — and you have a connection via ${pathwaySource(referralPathwayNotes)}.`;
};

/** Derived from score display inputs — never feeds back into scoring. */
export const deriveReferralAdvice = (params: {
  survivabilityBreakdown?: SurvivabilityBreakdown;
  referralPathwayAvailable?: boolean;
  referralPathwayNotes?: string;
  jdDegreePositive?: boolean;
  /**
   * Required (not preferred) stack/language mismatch — same flag that surfaces
   * "Required core language gap" Key Risks. Escalates verbiage independent of
   * credential/recognizability shortfall so niche Java-required roles don't get
   * "odds are solid" when Key Risks already call out a hard gap.
   */
  requiredStackLanguageMismatch?: boolean;
}): ReferralAdviceResult => {
  const shortfall = params.survivabilityBreakdown
    ? computeReferralAddressableShortfall(params.survivabilityBreakdown)
    : 0;

  // Required stack/language gaps escalate regardless of employer-size / credential shortfall.
  // Do not soften via degree-positive — Key Risks already treat this as hard.
  if (params.requiredStackLanguageMismatch) {
    return {
      advice: appendPathway(
        "Cold-apply odds are low for a required core-language / stack gap — a referral would substantially help.",
        params.referralPathwayAvailable,
        params.referralPathwayNotes,
      ),
      urgency: "strongly_advised",
      shortfall,
    };
  }

  let urgency = resolveReferralUrgency(shortfall);

  if (
    (params.survivabilityBreakdown?.credentialSignal ?? 0) >=
    CREDENTIAL_REFERRAL_SOFTEN_THRESHOLD
  ) {
    urgency = downgradeReferralUrgency(urgency);
  }

  if (params.jdDegreePositive) {
    urgency = downgradeReferralUrgency(urgency);
  }

  let advice: string;
  if (params.jdDegreePositive) {
    advice =
      "Portfolio-first screen — cold apply has real odds; lead with shipped work (DevAI, GitHub). Referral helpful, not gating.";
  } else if (urgency === "strongly_advised") {
    advice =
      "Cold-apply odds are low for routable reasons (credential / recognizability) — a referral would substantially help.";
  } else if (urgency === "advised") {
    advice = "A referral would help here.";
  } else {
    advice = "Odds are solid; a referral is optional but never hurts.";
  }

  advice = appendPathway(advice, params.referralPathwayAvailable, params.referralPathwayNotes);

  return { advice, urgency, shortfall };
};
