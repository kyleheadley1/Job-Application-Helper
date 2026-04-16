export type ResumeType = "SWE" | "SIE" | "EARLY_CAREER";

export type ResumeProfile = {
  type: ResumeType;
  label: string;
  bestFor: string[];
  avoidFor: string[];
  summaryStyle: string;
  emphasisKeywords: string[];
  exampleRationale: string[];
};

export type ResumeSelection = {
  recommendedResume: ResumeType;
  confidence: number;
  rationale: string[];
};
