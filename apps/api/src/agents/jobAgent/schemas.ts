import { z } from "zod";

export const ResumeTypeSchema = z.enum(["SWE", "SIE", "EARLY_CAREER"]);
export const RecommendationSchema = z.enum(["yes", "selective_yes", "no"]);
export const JobStatusSchema = z.enum([
  "to_review",
  "applied",
  "skip",
  "rejected",
  "interviewing",
  "assessment",
  "closed",
  "offer",
]);

export const ExtractedJobDataSchema = z.object({
  company: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url().optional(),
  rawText: z.string().optional(),
  location: z.string().optional(),
  remoteType: z.enum(["remote", "hybrid", "onsite", "unknown"]).optional(),
  locationIsCommutable: z.boolean().optional(),
  salary: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      currency: z.string().optional(),
    })
    .optional(),
  seniority: z.string().optional(),
  yearsExperience: z
    .object({
      raw: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
  stack: z.array(z.string()).default([]),
  requiredSkills: z.array(z.string()).default([]),
  preferredSkills: z.array(z.string()).default([]),
  domainTags: z.array(z.string()).default([]),
  degreeRequirement: z
    .object({
      raw: z.string().optional(),
      level: z.enum(["none", "preferred", "required", "equivalent_allowed", "unknown"]).optional(),
    })
    .optional(),
  visaRequirement: z.string().optional(),
  citizenshipRequirement: z.string().optional(),
  clearanceRequirement: z.string().optional(),
  relocationRequired: z.boolean().optional(),
  responsibilities: z.array(z.string()).default([]),
  requirements: z.array(z.string()).default([]),
});

export const RuleEvaluationSchema = z.object({
  explicitDegreeRisk: z.boolean(),
  traditionalCompanyPenalty: z.boolean(),
  financePenalty: z.boolean(),
  strictNewGradPipeline: z.boolean(),
  earlyCareerFriendlyRole: z.boolean(),
  newGradPenalty: z.boolean(),
  seniorityOverreach: z.boolean(),
  locationMismatch: z.boolean(),
  visaMismatch: z.boolean(),
  citizenshipMismatch: z.boolean(),
  clearanceMismatch: z.boolean(),
  stackMismatch: z.boolean(),
  domainMismatch: z.boolean(),
  startupFounderMismatch: z.boolean(),
  notes: z.array(z.string()).default([]),
  penaltyVector: z.record(z.string(), z.number()).optional(),
});

export const ScoreBreakdownSchema = z
  .object({
    stackFit: z.number().min(0).max(25),
    levelFit: z.number().min(0).max(15),
    domainFit: z.number().min(0).max(10),
    resumeStoryClarity: z.number().min(0).max(15),
    functionalOverlap: z.number().min(0).max(10),
    recruiterFriendliness: z.number().min(0).max(15),
    careerValue: z.number().min(0).max(10),
    total: z.number().min(0).max(100),
  })
  .superRefine((v, ctx) => {
    const computed =
      v.stackFit +
      v.levelFit +
      v.domainFit +
      v.resumeStoryClarity +
      v.functionalOverlap +
      v.recruiterFriendliness +
      v.careerValue;
    if (Math.abs(computed - v.total) > 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Score total should match category sum within tolerance.",
      });
    }
  });

export const GeneratedAssetsSchema = z.object({
  whyCompany: z.string().optional(),
  coverLetter: z.string().optional(),
  talkingPoints: z.array(z.string()).optional(),
  tailoredBulletCandidates: z.array(z.string()).optional(),
  emphasize: z.array(z.string()).optional(),
  avoidClaiming: z.array(z.string()).optional(),
  recruiterReplyDraft: z.string().optional(),
});

export const TriageDebugExtractionSchema = z.object({
  fallbackUsed: z.boolean(),
  extractedFromRawText: z.array(z.string()),
  missingCriticalFields: z.array(z.string()),
});

export const JobRecordSchema = z.object({
  id: z.string(),
  extracted: ExtractedJobDataSchema,
  rules: RuleEvaluationSchema,
  score: ScoreBreakdownSchema,
  recommendation: RecommendationSchema,
  salaryAsk: z
    .object({
      number: z.number().optional(),
      rangeMin: z.number().optional(),
      rangeMax: z.number().optional(),
    })
    .default({}),
  recommendedResume: ResumeTypeSchema,
  resumeRationale: z.array(z.string()).default([]),
  topMatch: z.string(),
  mainRisk: z.string(),
  rationale: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  generated: GeneratedAssetsSchema.default({}),
  debugExtraction: TriageDebugExtractionSchema.optional(),
  tracker: z
    .object({
      priority: z.string().optional(),
      recommendedAction: z.string().optional(),
      statusOutcome: z.string().optional(),
      color: z.enum(["green", "yellow", "red", "blue"]).optional(),
      shortlist: z.boolean().optional(),
      notes: z.string().optional(),
    })
    .default({}),
  status: JobStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  scoreHistory: z
    .array(
      z.object({
        scoredAt: z.string(),
        score: ScoreBreakdownSchema,
        recommendation: RecommendationSchema,
      }),
    )
    .optional(),
});

export const TriageRequestSchema = z
  .object({
    url: z.string().url().optional(),
    rawText: z.string().optional(),
    companyHint: z.string().optional(),
    fullPrep: z.boolean().optional().default(false),
  })
  .refine((v) => Boolean(v.url || v.rawText), {
    message: "Provide either url or rawText.",
    path: ["url"],
  });

export const GenerateAssetsForIdBodySchema = z.object({
  force: z.boolean().optional(),
});

export const GenerateAssetsFromJobBodySchema = z.object({
  job: JobRecordSchema,
  persist: z.boolean().optional(),
  force: z.boolean().optional(),
});

export const TriageResponseSchema = JobRecordSchema;

export type TriageRequest = z.infer<typeof TriageRequestSchema>;
export type TriageResponse = z.infer<typeof TriageResponseSchema>;
export type GenerateAssetsFromJobBody = z.infer<typeof GenerateAssetsFromJobBodySchema>;
