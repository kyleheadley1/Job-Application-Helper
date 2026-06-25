import type { ScoreDisplay, SurvivabilityLever } from "../types/job";

export const leverClassName = (lever: SurvivabilityLever): string => {
  if (lever === "none" || lever === "none_in_loop") return "scoreLever structural";
  return `scoreLever ${lever}`;
};

export const formatLeverTag = (lever: SurvivabilityLever, leverLabel: string): string => {
  if (lever === "none") return `lever: ${leverLabel}`;
  return `lever: ${leverLabel}`;
};

export const getScoreDisplay = (score: { scoreDisplay?: ScoreDisplay }): ScoreDisplay | undefined =>
  score.scoreDisplay;

export const CAPABILITY_MAX_LABELS = {
  stackFit: 35,
  levelFit: 30,
  functionalOverlap: 35,
} as const;
