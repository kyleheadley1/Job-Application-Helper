import { SURVIVABILITY_TUNING } from "../config/capabilitySurvivabilityPolicy.js";
import type { Recommendation, RuleEvaluation, SurvivabilityPenalty } from "../types/scoring.js";

const isPenaltyAddressable = (
  penalty: SurvivabilityPenalty,
  referralPathwayAvailable: boolean,
): boolean => {
  if (penalty.lever === "none") return false;
  if (penalty.lever === "referral") return referralPathwayAvailable;
  return penalty.lever === "resume" || penalty.lever === "cover_letter";
};

/** True when every firing survivability penalty can be routed around. */
export const allSurvivabilityPenaltiesAddressable = (
  penalties: SurvivabilityPenalty[],
  referralPathwayAvailable: boolean,
): boolean => {
  if (penalties.length === 0) return false;
  return penalties.every((p) => isPenaltyAddressable(p, referralPathwayAvailable));
};

export const hasNonAddressableSkipBlocker = (params: {
  rules: RuleEvaluation;
  survivabilityPenalties: SurvivabilityPenalty[];
  referralPathwayAvailable: boolean;
}): boolean => {
  if (params.rules.capabilityGap) return true;
  return params.survivabilityPenalties.some(
    (p) => !isPenaltyAddressable(p, params.referralPathwayAvailable),
  );
};

/**
 * Skip requires a non-addressable blocker. Upgrade skip when every penalty is
 * addressable and no capability gap exists.
 */
export const guardCompositeRecommendation = (params: {
  recommendation: Recommendation;
  capability: number;
  survivability: number;
  rules: RuleEvaluation;
  survivabilityPenalties: SurvivabilityPenalty[];
  referralPathwayAvailable?: boolean;
}): Recommendation => {
  const { recommendation, capability, rules, survivabilityPenalties } = params;
  const referralPathwayAvailable = Boolean(params.referralPathwayAvailable);

  if (recommendation !== "skip") return recommendation;

  if (rules.capabilityGap) return "skip";

  if (
    allSurvivabilityPenaltiesAddressable(survivabilityPenalties, referralPathwayAvailable)
  ) {
    const strongCap = capability >= SURVIVABILITY_TUNING.strongCapabilityThreshold;
    return strongCap ? "referral_gated" : "stretch_signal";
  }

  if (!hasNonAddressableSkipBlocker({ rules, survivabilityPenalties, referralPathwayAvailable })) {
    const strongCap = capability >= SURVIVABILITY_TUNING.strongCapabilityThreshold;
    return strongCap ? "referral_gated" : "stretch_signal";
  }

  return "skip";
};

/** Skip action-line targets must not name addressable penalties when pathway exists. */
export const skipReasonIsValid = (params: {
  recommendation: Recommendation;
  statedReason: string;
  rules: RuleEvaluation;
  survivabilityPenalties: SurvivabilityPenalty[];
  referralPathwayAvailable?: boolean;
}): boolean => {
  if (params.recommendation !== "skip") return true;

  if (params.rules.capabilityGap) {
    return params.statedReason
      .toLowerCase()
      .includes(params.rules.capabilityGap.reason.toLowerCase());
  }

  const referralPathwayAvailable = Boolean(params.referralPathwayAvailable);
  const reason = params.statedReason.toLowerCase();

  for (const penalty of params.survivabilityPenalties) {
    if (!isPenaltyAddressable(penalty, referralPathwayAvailable)) continue;
    if (penalty.lever === "referral" && referralPathwayAvailable) {
      if (reason.includes("degree") || reason.includes("credential")) return false;
    }
    if (
      (penalty.lever === "resume" || penalty.lever === "cover_letter") &&
      reason.includes(penalty.leverLabel.toLowerCase().slice(0, 12))
    ) {
      return false;
    }
  }

  return hasNonAddressableSkipBlocker({
    rules: params.rules,
    survivabilityPenalties: params.survivabilityPenalties,
    referralPathwayAvailable,
  });
};
