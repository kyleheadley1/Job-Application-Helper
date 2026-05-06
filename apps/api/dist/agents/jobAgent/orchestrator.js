import { randomUUID } from 'crypto';
import { userProfile } from '../../config/userProfile.js';
import { getTrackerColor, shouldShortlist, } from '../../config/scoringPolicy.js';
import { buildTrackerSpreadsheetFromJob } from '../../tracker/canonicalSpreadsheet.js';
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
export const triageJob = async (input) => {
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
    const { extracted, llmExtractionSucceeded, extractionDiagnostics, heuristicInferredFields, } = await extractJobData({
        url: input.url,
        rawText: parsedText,
        companyHint: input.companyHint,
    });
    stageMs.extraction = Date.now() - extractionStart;
    const rulesStart = Date.now();
    const rules = withSanitizedRuleNotes(evaluateRules(extracted, userProfile), extracted, userProfile);
    stageMs.rules = Date.now() - rulesStart;
    const resumeCtxStart = Date.now();
    const resumeContexts = await resumeContextService.getAvailableContexts();
    stageMs.resumeContext = Date.now() - resumeCtxStart;
    const scoringStart = Date.now();
    const { scoring: scored, scoringDiagnostics, scoringLlmSucceeded, } = await scoreJob({ extracted, rules, userProfile, resumeContexts });
    stageMs.scoring = Date.now() - scoringStart;
    const salaryStart = Date.now();
    const salaryAsk = computeSalaryAsk({
        extracted,
        score: scored.score,
        recommendation: scored.recommendation,
        rules,
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
    const now = new Date().toISOString();
    const initialRecord = {
        id: randomUUID(),
        extracted,
        rules,
        score: scored.score,
        recommendation: scored.recommendation,
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
            priority: scored.score.total >= 78
                ? 'high'
                : scored.score.total >= 70
                    ? 'medium'
                    : 'low',
            recommendedAction: scored.recommendation === 'yes'
                ? 'Apply with urgency'
                : scored.recommendation === 'selective_yes'
                    ? 'Apply selectively with caveats'
                    : 'Skip unless special reason',
            statusOutcome: scored.recommendation,
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
                recommendation: scored.recommendation,
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
