import { randomUUID } from 'crypto';
import { userProfile } from '../../config/userProfile.js';
import {
  getTrackerColor,
  shouldShortlist,
} from '../../config/scoringPolicy.js';
import type { JobRecord } from '../../types/job.js';
import { buildTrackerSpreadsheetFromJob } from '../../tracker/canonicalSpreadsheet.js';
import { detectReferralPathway } from '../../lib/referralPathway.js';
import { buildScoreDisplay } from '../../lib/scoreDisplayModel.js';
import { guardCompositeRecommendation } from '../../lib/recommendationGuard.js';
import { RECOMMENDATION_LABELS } from '../../config/capabilitySurvivabilityPolicy.js';
import { evaluateRules } from './rules.js';
import { scoreJob } from './scoring.js';
import { computeSalaryAsk } from './salaryAsk.js';
import { selectResume } from './resumeSelector.js';
import { fetchJobPosting } from '../../tools/fetchJobPosting.js';
import { parseJobText } from '../../tools/parseJobText.js';
import { extractJobData } from '../../tools/extractJobData.js';
import { listMissingCriticalFields } from '../../tools/deterministicRawTextExtract.js';
import { resumeContextService } from '../../services/resume/resumeContext.js';
import { logger } from '../../lib/logger.js';
import { withSanitizedRuleNotes } from '../../lib/riskDisplaySanitizer.js';

export const triageJob = async (input: {
  url?: string;
  rawText?: string;
  companyHint?: string;
  fullPrep?: boolean;
}): Promise<JobRecord> => {
  const t0 = Date.now();
  const stageMs = {
    fetchAndParse: 0,
    extraction: 0,
    rules: 0,
    resumeContext: 0,
    scoring: 0,
    salary: 0,
    resumeSelection: 0,
  };
  const fetchStart = Date.now();
  const fetchedText = input.url
    ? await fetchJobPosting(input.url).catch(() => undefined)
    : undefined;
  const mergedText = [input.rawText, fetchedText].filter(Boolean).join('\n\n');
  const parsedText = mergedText
    ? parseJobText(mergedText).normalized
    : undefined;
  stageMs.fetchAndParse = Date.now() - fetchStart;

  const extractionStart = Date.now();
  const {
    extracted,
    llmExtractionSucceeded,
    extractionDiagnostics,
    heuristicInferredFields,
    preScoringMetadata,
  } = await extractJobData({
    url: input.url,
    rawText: parsedText,
    companyHint: input.companyHint,
  });
  stageMs.extraction = Date.now() - extractionStart;

  const resumeCtxStart = Date.now();
  const resumeContexts = await resumeContextService.getAvailableContexts();
  stageMs.resumeContext = Date.now() - resumeCtxStart;

  const rulesStart = Date.now();
  const rules = withSanitizedRuleNotes(
    evaluateRules(extracted, userProfile, { resumeContexts, activeResumeType: 'SWE' }),
    extracted,
    userProfile,
  );
  stageMs.rules = Date.now() - rulesStart;
  const scoringStart = Date.now();
  const {
    scoring: scored,
    rules: scoredRules,
    scoringDiagnostics,
    scoringLlmSucceeded,
  } = await scoreJob({ extracted, rules, userProfile, resumeContexts, preScoringMetadata });
  stageMs.scoring = Date.now() - scoringStart;
  const salaryStart = Date.now();
  const salaryAsk = computeSalaryAsk({
    extracted,
    score: scored.score,
    recommendation: scored.recommendation,
    rules: scoredRules,
  });
  stageMs.salary = Date.now() - salaryStart;
  const resumeSelStart = Date.now();
  const resumeSelection = await selectResume({
    extracted,
    score: scored.score,
    topMatch: scored.topMatch,
    mainRisk: scored.mainRisk,
    userProfile,
    resumeContexts,
  });
  stageMs.resumeSelection = Date.now() - resumeSelStart;

  const referralPathway = detectReferralPathway({
    profile: userProfile,
    extracted,
    resumeText: resumeContexts?.SWE?.rawText,
  });

  const scoreDisplay = buildScoreDisplay({
    score: scored.score,
    rules: scoredRules,
    extracted,
    recommendation: scored.recommendation,
    referralPathwayAvailable: referralPathway.referralPathwayAvailable,
    referralPathwayNotes: referralPathway.referralPathwayNotes,
  });

  const finalRecommendation = guardCompositeRecommendation({
    recommendation: scored.recommendation,
    capability: scored.score.capability ?? 0,
    survivability: scored.score.survivability ?? 0,
    rules: scoredRules,
    survivabilityPenalties: scoreDisplay?.survivabilityPenalties ?? [],
    referralPathwayAvailable: referralPathway.referralPathwayAvailable,
  });

  const scoreDisplayFinal = buildScoreDisplay({
    score: scored.score,
    rules: scoredRules,
    extracted,
    recommendation: finalRecommendation,
    referralPathwayAvailable: referralPathway.referralPathwayAvailable,
    referralPathwayNotes: referralPathway.referralPathwayNotes,
  });

  const scoreWithDisplay = scoreDisplayFinal
    ? {
        ...scored.score,
        scoreDisplay: scoreDisplayFinal,
        recommendationLabel: RECOMMENDATION_LABELS[finalRecommendation],
      }
    : {
        ...scored.score,
        recommendationLabel: RECOMMENDATION_LABELS[finalRecommendation],
      };

  const now = new Date().toISOString();
  const initialRecord: JobRecord = {
    id: randomUUID(),
    extracted,
    rules: scoredRules,
    score: scoreWithDisplay,
    recommendation: finalRecommendation,
    referralPathwayAvailable: referralPathway.referralPathwayAvailable,
    referralPathwayNotes: referralPathway.referralPathwayNotes,
    salaryAsk,
    recommendedResume: resumeSelection.recommendedResume,
    resumeRationale: resumeSelection.rationale,
    topMatch: scored.topMatch,
    mainRisk: scored.mainRisk,
    rationale: scored.rationale,
    risks: scored.risks,
    generated: {},
    debugExtraction: {
      fallbackUsed: !llmExtractionSucceeded,
      extraction: {
        success: llmExtractionSucceeded,
        fallbackUsed: extractionDiagnostics.fallbackUsed,
        httpStatus: extractionDiagnostics.httpStatus,
        errorCode: extractionDiagnostics.errorCode,
        errorType: extractionDiagnostics.errorType,
        errorMessage: extractionDiagnostics.errorMessage,
        parseStage: extractionDiagnostics.parseStage,
        reason: extractionDiagnostics.reason,
      },
      scoring: {
        success: scoringLlmSucceeded,
        fallbackUsed: scoringDiagnostics.fallbackUsed,
        httpStatus: scoringDiagnostics.httpStatus,
        errorCode: scoringDiagnostics.errorCode,
        errorType: scoringDiagnostics.errorType,
        errorMessage: scoringDiagnostics.errorMessage,
        parseStage: scoringDiagnostics.parseStage,
        reason: scoringDiagnostics.reason,
      },
      extractedFromRawText: heuristicInferredFields,
      missingCriticalFields: listMissingCriticalFields(extracted),
    },
    tracker: {
      priority:
        finalRecommendation === 'apply_cold'
          ? 'high'
          : finalRecommendation === 'referral_gated' || finalRecommendation === 'stretch_signal'
            ? 'medium'
            : 'low',
      recommendedAction:
        finalRecommendation === 'apply_cold'
          ? 'Apply with urgency'
          : finalRecommendation === 'referral_gated'
            ? 'Pursue via referral or heavily tailored apply'
            : finalRecommendation === 'stretch_signal'
              ? 'Apply selectively — signal-dependent'
              : finalRecommendation === 'skip'
                ? 'Skip unless special reason'
                : 'Do not apply — hard gate',
      statusOutcome: finalRecommendation,
      shortlist: shouldShortlist(scored.score.total, 'to_review'),
      color: getTrackerColor('to_review', scored.score.total),
    },
    status: 'to_review',
    createdAt: now,
    updatedAt: now,
    scoreHistory: [
      {
        scoredAt: now,
        score: scored.score,
        recommendation: finalRecommendation,
      },
    ],
  };
  logger.info('triage timing', {
    totalMs: Date.now() - t0,
    ...stageMs,
    hasUrlInput: Boolean(input.url),
    hasRawTextInput: Boolean(input.rawText?.trim()),
    extractionLlmSucceeded: llmExtractionSucceeded,
    scoringLlmSucceeded,
  });
  return {
    ...initialRecord,
    trackerSpreadsheet: buildTrackerSpreadsheetFromJob(initialRecord),
  };
};
