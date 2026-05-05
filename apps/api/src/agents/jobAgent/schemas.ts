import { z } from 'zod';
import { TRACKER_EXPORT_HEADERS } from '../../tracker/canonicalSpreadsheet.js';
import { preprocessExtractionInput } from '../../tools/triageStructuredNormalize.js';

export const ResumeTypeSchema = z.enum(['SWE', 'SIE', 'EARLY_CAREER']);
export const RecommendationSchema = z.enum(['yes', 'selective_yes', 'no']);
export const JobStatusSchema = z.enum([
  'to_review',
  'applied',
  'skip',
  'rejected',
  'interviewing',
  'assessment',
  'closed',
  'offer',
]);

export const ExtractedJobDataSchema = z.object({
  company: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url().optional(),
  rawText: z.string().optional(),
  location: z.string().optional(),
  remoteType: z.enum(['remote', 'hybrid', 'onsite', 'unknown']).optional(),
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
      level: z
        .enum([
          'none',
          'preferred',
          'required',
          'equivalent_allowed',
          'unknown',
        ])
        .optional(),
    })
    .optional(),
  visaRequirement: z.string().optional(),
  citizenshipRequirement: z.string().optional(),
  clearanceRequirement: z.string().optional(),
  relocationRequired: z.boolean().optional(),
  responsibilities: z.array(z.string()).default([]),
  requirements: z.array(z.string()).default([]),
});

/** Live extraction JSON normalized then validated (safer URL/location/array coercion). */
export const ExtractedJobFromModelSchema = z.preprocess(
  preprocessExtractionInput,
  ExtractedJobDataSchema,
);

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
  matureStructuredEmployer: z.boolean().optional().default(false),
  explicitCoreLanguageMismatch: z.boolean().optional().default(false),
  explicitCoreLanguage: z.string().nullable().optional(),
  fdeBuilderSoftwarePrimary: z.boolean().optional().default(false),
  pythonStackFlexibleWithJsTs: z.boolean().optional().default(false),
  healthcareProductEngineering: z.boolean().optional().default(false),
  backendProductApiRole: z.boolean().optional().default(false),
  infraCoreRole: z.boolean().optional().default(false),
  vagueEarlyStageAiCalibration: z.boolean().optional().default(false),
  hardRuleNotes: z.array(z.string()).optional().default([]),
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
        message: 'Score total should match category sum within tolerance.',
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

export const TriageStageDebugSchema = z.object({
  success: z.boolean(),
  fallbackUsed: z.boolean(),
  httpStatus: z.number().optional(),
  errorCode: z.string().optional(),
  errorType: z.string().optional(),
  errorMessage: z.string().optional(),
  parseStage: z.string().optional(),
  reason: z.string().optional(),
});

export const TriageDebugExtractionSchema = z.object({
  /** True when live extraction did not validate (legacy aggregate). */
  fallbackUsed: z.boolean(),
  extraction: TriageStageDebugSchema,
  scoring: TriageStageDebugSchema,
  extractedFromRawText: z.array(z.string()),
  missingCriticalFields: z.array(z.string()),
});

export const AssetGenerationSliceDebugSchema = z.object({
  success: z.boolean(),
  fallbackUsed: z.boolean(),
  httpStatus: z.number().optional(),
  errorCode: z.string().optional(),
  errorType: z.string().optional(),
  errorMessage: z.string().optional(),
  parseStage: z.string().optional(),
  reason: z.string().optional(),
});

export const DebugAssetGenerationSchema = z.object({
  slices: z.record(z.string(), AssetGenerationSliceDebugSchema),
});

export const StatusHistoryRecordSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  fromStatus: JobStatusSchema.optional(),
  toStatus: JobStatusSchema,
  note: z.string().optional(),
  createdAt: z.string(),
});

export const JobImportSourceSchema = z.object({
  spreadsheetPath: z.string(),
  sheetName: z.string(),
  rowNumber: z.number(),
  fileFingerprint: z.string(),
});

export const TrackerSpreadsheetFieldsSchema = z
  .object({
    rank: z.string().optional(),
    discussed: z.string().optional(),
    company: z.string().optional(),
    role: z.string().optional(),
    latestScore: z.string().optional(),
    originalAltScore: z.string().optional(),
    priority: z.string().optional(),
    recommendedAction: z.string().optional(),
    statusOutcome: z.string().optional(),
    salaryAsk: z.string().optional(),
    jdInput: z.string().optional(),
    topMatch: z.string().optional(),
    mainRisk: z.string().optional(),
    notes: z.string().optional(),
    resume: z.string().optional(),
  })
  .optional();

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
  debugAssetGeneration: DebugAssetGenerationSchema.optional(),
  tracker: z
    .object({
      priority: z.string().optional(),
      recommendedAction: z.string().optional(),
      statusOutcome: z.string().optional(),
      color: z.enum(['green', 'yellow', 'red', 'blue']).optional(),
      shortlist: z.boolean().optional(),
      notes: z.string().optional(),
    })
    .default({}),
  trackerSpreadsheet: TrackerSpreadsheetFieldsSchema,
  importKey: z.string().optional(),
  importSource: JobImportSourceSchema.optional(),
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
  statusHistory: z.array(StatusHistoryRecordSchema).optional(),
});

export const TriageRequestSchema = z
  .object({
    url: z.string().url().optional(),
    rawText: z.string().optional(),
    companyHint: z.string().optional(),
    fullPrep: z.boolean().optional().default(false),
  })
  .refine((v) => Boolean(v.url || v.rawText), {
    message: 'Provide either url or rawText.',
    path: ['url'],
  });

export const GenerateAssetsForIdBodySchema = z.object({
  force: z.boolean().optional(),
});

export const GenerateAssetsFromJobBodySchema = z.object({
  job: JobRecordSchema,
  persist: z.boolean().optional(),
  force: z.boolean().optional(),
});

export const UpdateJobStatusBodySchema = z.object({
  status: JobStatusSchema,
  note: z.string().trim().min(1).max(4000).optional(),
});

export const UpdateJobNotesBodySchema = z.object({
  notes: z.string().trim().max(10000),
});

const parseBooleanQuery = z.union([
  z.boolean(),
  z
    .string()
    .trim()
    .refine((t) => ['true', 'false', '1', '0'].includes(t.toLowerCase()), {
      message: 'Expected boolean-like query value.',
    })
    .transform((t) => t.toLowerCase() === 'true' || t === '1'),
]);

export const JobListQuerySchema = z.object({
  status: JobStatusSchema.optional(),
  shortlist: parseBooleanQuery.optional(),
  resume: ResumeTypeSchema.optional(),
  recommendation: RecommendationSchema.optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  company: z.string().trim().min(1).optional(),
});

export const ExportFormatSchema = z.enum(['json', 'csv']).default('json');

export const JobExportQuerySchema = JobListQuerySchema.extend({
  format: ExportFormatSchema.optional(),
});

const jobExportRowShape = Object.fromEntries(
  TRACKER_EXPORT_HEADERS.map((h) => [h, z.string()]),
) as Record<(typeof TRACKER_EXPORT_HEADERS)[number], z.ZodString>;

export const JobExportRowSchema = z.object(jobExportRowShape);

export const TriageResponseSchema = JobRecordSchema;

export type TriageRequest = z.infer<typeof TriageRequestSchema>;
export type TriageResponse = z.infer<typeof TriageResponseSchema>;
export type GenerateAssetsFromJobBody = z.infer<
  typeof GenerateAssetsFromJobBodySchema
>;
