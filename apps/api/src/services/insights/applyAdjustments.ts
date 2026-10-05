import { clampPoints, MAX_POINTS_PER_ADJUSTMENT } from "../../lib/historyAdjustments.js";
import { logger } from "../../lib/logger.js";
import type { HistoryAdjustment } from "../../types/scoring.js";
import { featureByKey, type FeatureSubject } from "./features.js";
import { insightsRepository, type ScoringAdjustment } from "./insights.repository.js";

export { applyHistoryPoints, historyPoints } from "../../lib/historyAdjustments.js";

/** Approved adjustments whose pattern this role matches, each capped at ±4. */
export const matchAdjustments = (subject: FeatureSubject, approved: ScoringAdjustment[]): HistoryAdjustment[] =>
  approved.flatMap((a) => {
    const feature = featureByKey.get(a.feature);
    if (a.status !== "approved" || !feature?.scorable || !feature.values(subject).includes(a.bucket)) return [];
    const points = clampPoints(Math.round(a.points), -MAX_POINTS_PER_ADJUSTMENT, MAX_POINTS_PER_ADJUSTMENT);
    return points === 0 ? [] : [{ id: a.id, label: `${a.featureLabel}: ${a.bucket}`, points }];
  });

/** Scoring must never fail because insights storage is unavailable; no adjustments is the safe default. */
export const loadApprovedAdjustments = async (): Promise<ScoringAdjustment[]> => {
  try {
    return await insightsRepository.listApproved();
  } catch (error) {
    logger.warn("Could not load approved scoring adjustments", {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};
