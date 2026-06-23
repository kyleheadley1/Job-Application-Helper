/** Tunable post-processing clamp caps (applied after raw LLM category scores). */
export const SCORING_CLAMP_POLICY = {
  storyFunctionalUnderCoreLanguageGap: {
    resumeStoryClarityMax: 5,
    functionalOverlapMax: 7,
  },
  roleShapeOutsideLane: {
    stackFitMax: 13,
  },
  financeDomain: {
    domainFitMax: 5,
  },
  matureStructuredDegreeRisk: {
    recruiterFriendlinessMax: 8,
  },
  staffAugContract: {
    careerValueMax: 6,
  },
  hardFlagTotalCeilings: {
    coreLanguageMismatch: 55,
    seniorityOverreach: 65,
    coreLanguageAndSeniority: 45,
  },
} as const;
