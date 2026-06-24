import type { LegacyRecommendation, Recommendation } from "../types/scoring.js";

export const toLegacyRecommendation = (rec: Recommendation): LegacyRecommendation => {
  if (rec === "yes" || rec === "selective_yes") return rec;
  switch (rec) {
    case "apply_cold":
      return "yes";
    case "referral_gated":
    case "stretch_signal":
      return "selective_yes";
    case "skip":
    case "no":
      return "no";
  }
};

export const isPositiveRecommendation = (rec: Recommendation): boolean =>
  rec === "apply_cold" || rec === "referral_gated" || rec === "stretch_signal";

export const isApplyRecommendation = (rec: Recommendation): boolean =>
  rec === "apply_cold" || rec === "referral_gated";
