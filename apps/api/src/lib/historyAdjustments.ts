import type { HistoryAdjustment } from "../types/scoring.js";

export const MAX_POINTS_PER_ADJUSTMENT = 4;
export const MAX_TOTAL_HISTORY_POINTS = 8;

export const clampPoints = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Sum of the adjustments, capped at ±8 overall. */
export const historyPoints = (adjustments: HistoryAdjustment[] | undefined): number =>
  clampPoints(
    (adjustments ?? []).reduce((sum, a) => sum + a.points, 0),
    -MAX_TOTAL_HISTORY_POINTS,
    MAX_TOTAL_HISTORY_POINTS,
  );

export const applyHistoryPoints = (total: number, adjustments: HistoryAdjustment[] | undefined): number =>
  clampPoints(Math.round((total + historyPoints(adjustments)) * 10) / 10, 0, 100);
