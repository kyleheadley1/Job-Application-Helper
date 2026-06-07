/** Keep in sync with apps/api/src/config/scoringPolicy.ts SCORE_CATEGORY_MAXES */
export const SCORE_CATEGORY_MAXES = {
  stackFit: 20,
  levelFit: 20,
  domainFit: 10,
  resumeStoryClarity: 10,
  functionalOverlap: 15,
  recruiterFriendliness: 15,
  careerValue: 10,
} as const;

export type ScoreCategoryKey = keyof typeof SCORE_CATEGORY_MAXES;

export const formatScoreCategory = (value: number, key: ScoreCategoryKey): string =>
  `${value}/${SCORE_CATEGORY_MAXES[key]}`;
