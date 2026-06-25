import { SURVIVABILITY_TUNING } from "../config/capabilitySurvivabilityPolicy.js";
import type { Recommendation, RuleEvaluation, SurvivabilityPenalty } from "../types/scoring.js";
import { specializationGapIsNonAddressable } from "./capabilityGap.js";

const isPenaltyAddressable = (penalty: SurvivabilityPenalty): boolean => {
  if (
    penalty.lever === "none" ||
    penalty.lever === "none_in_loop" ||
    penalty.lever === "portfolio" ||
    penalty.lever === "upskill"
  ) {
    return false;
  }
  return penalty.lever === "resume" || penalty.lever === "cover_letter";
};

/** True when every firing survivability penalty can be routed via resume/cover letter. */
export const allSurvivabilityPenaltiesAddressable = (
  penalties: SurvivabilityPenalty[],
): boolean => {
  if (penalties.length === 0) return false;
  return penalties.every((p) => isPenaltyAddressable(p));
};

export const hasNonAddressableSkipBlocker = (params: {
  rules: RuleEvaluation;
  survivabilityPenalties: SurvivabilityPenalty[];
}): boolean => {
  if (params.rules.specializationGap && specializationGapIsNonAddressable(params.rules.specializationGap)) {
    return true;
  }
  if (params.rules.capabilityGap) return true;
  return params.survivabilityPenalties.some((p) => !isPenaltyAddressable(p));
};

/**
 * Skip requires a non-addressable blocker. Upgrade skip when every penalty is
 * addressable via resume/cover letter and no capability gap exists.
 */
export const guardCompositeRecommendation = (params: {
  recommendation: Recommendation;
  capability: number;
  survivability: number;
  rules: RuleEvaluation;
  survivabilityPenalties: SurvivabilityPenalty[];
}): Recommendation => {
  const { recommendation, capability, rules, survivabilityPenalties } = params;

  if (recommendation !== "skip") return recommendation;

  if (rules.specializationGap && specializationGapIsNonAddressable(rules.specializationGap)) {
    return "skip";
  }

  if (rules.capabilityGap) return "skip";

  if (allSurvivabilityPenaltiesAddressable(survivabilityPenalties)) {
    const strongCap = capability >= SURVIVABILITY_TUNING.strongCapabilityThreshold;
    return strongCap ? "referral_gated" : "stretch_signal";
  }

  if (!hasNonAddressableSkipBlocker({ rules, survivabilityPenalties })) {
    const strongCap = capability >= SURVIVABILITY_TUNING.strongCapabilityThreshold;
    return strongCap ? "referral_gated" : "stretch_signal";
  }

  return "skip";
};

/** Skip action-line targets must name a non-addressable blocker. */
export const skipReasonIsValid = (params: {
  recommendation: Recommendation;
  statedReason: string;
  rules: RuleEvaluation;
  survivabilityPenalties: SurvivabilityPenalty[];
}): boolean => {
  if (params.recommendation !== "skip") return true;

  if (params.rules.specializationGap) {
    return params.statedReason
      .toLowerCase()
      .includes(params.rules.specializationGap.name.toLowerCase());
  }

  if (params.rules.capabilityGap) {
    return params.statedReason
      .toLowerCase()
      .includes(params.rules.capabilityGap.reason.toLowerCase());
  }

  const reason = params.statedReason.toLowerCase();

  for (const penalty of params.survivabilityPenalties) {
    if (!isPenaltyAddressable(penalty)) continue;
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
  });
};
