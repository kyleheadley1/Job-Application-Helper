import type { LegacyRecommendation, Recommendation } from "../types/scoring.js";

export const toLegacyRecommendation = (rec: Recommendation): LegacyRecommendation => {
  switch (rec) {
    case "strong_apply":
    case "apply":
      return "yes";
    case "stretch":
      return "selective_yes";
    case "weak":
      return "no";
  }
};

export const isPositiveRecommendation = (rec: Recommendation): boolean => rec !== "weak";

export const isApplyRecommendation = (rec: Recommendation): boolean =>
  rec === "strong_apply" || rec === "apply";
