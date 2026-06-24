import { createHash, randomUUID } from 'node:crypto';
import { evaluateRules } from '../agents/jobAgent/rules.js';
import { withSanitizedRuleNotes } from '../lib/riskDisplaySanitizer.js';
import { getTrackerColor, shouldShortlist } from '../config/scoringPolicy.js';
import { userProfile } from '../config/userProfile.js';
import type { ExtractedJobData, JobRecord, JobStatus } from '../types/job.js';
import type { JobImportSource, TrackerSpreadsheetFields } from '../types/trackerSpreadsheet.js';
import {
  cellToSpreadsheetString,
  mapSpreadsheetStatusToJobStatus,
  parseLatestScore,
  parseResumeColumn,
  parseSalaryAskFromText,
  recommendationFromScoreTotal,
  scoreBreakdownFromTotal,
} from './canonicalSpreadsheet.js';

/** Normalize for stable hashing only (not for display). */
function normForIdentity(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Stable upsert identity from row *content* + import fingerprint.
 * Row order is intentionally excluded so rows can move in the sheet without creating duplicates.
 */
export function buildImportKey(input: {
  fileFingerprint: string;
  company: string;
  role: string;
  jdInput: string;
  salaryAskRaw: string;
  latestScoreRaw: string;
  originalAltScoreRaw: string;
}): string {
  const parts = [
    input.fileFingerprint,
    normForIdentity(input.company),
    normForIdentity(input.role),
    normForIdentity(input.jdInput).slice(0, 8000),
    normForIdentity(input.salaryAskRaw).slice(0, 2000),
    normForIdentity(input.latestScoreRaw).slice(0, 64),
    normForIdentity(input.originalAltScoreRaw).slice(0, 500),
  ];
  return createHash('sha256').update(parts.join('\u0001'), 'utf8').digest('hex');
}

export function rowArrayToPartialTrackerSpreadsheet(
  row: unknown[],
  colMap: Map<number, keyof TrackerSpreadsheetFields>,
): Partial<TrackerSpreadsheetFields> {
  const out: Partial<TrackerSpreadsheetFields> = {};
  colMap.forEach((field, idx) => {
    out[field] = cellToSpreadsheetString(row[idx]);
  });
  return out;
}

function minimalExtracted(ts: Partial<TrackerSpreadsheetFields>): ExtractedJobData {
  const company = (ts.company ?? '').trim() || 'Unknown';
  const title = (ts.role ?? '').trim() || 'Unknown role';
  const jd = (ts.jdInput ?? '').trim();
  return {
    company,
    title,
    ...(jd ? { rawText: jd } : {}),
    stack: [],
    requiredSkills: [],
    preferredSkills: [],
    domainTags: [],
    responsibilities: [],
    requirements: [],
  };
}

function defaultTrackerPriority(scoreTotal: number): string {
  if (scoreTotal >= 78) return 'high';
  if (scoreTotal >= 70) return 'medium';
  return 'low';
}

function defaultRecommendedAction(rec: JobRecord['recommendation']): string {
  if (rec === 'apply_cold' || rec === 'yes') return 'Apply with urgency';
  if (rec === 'referral_gated' || rec === 'stretch_signal' || rec === 'selective_yes') {
    return 'Apply selectively with caveats';
  }
  if (rec === 'no') return 'Do not apply — hard gate';
  return 'Skip unless special reason';
}

/** Build a persisted job from one “All Applications” row (cells + column map). */
export function jobRecordFromImportedSheetRow(input: {
  partialTs: Partial<TrackerSpreadsheetFields>;
  importSource: JobImportSource;
  importKey: string;
  createdAt?: string;
}): JobRecord {
  const { partialTs, importSource, importKey, createdAt } = input;
  const ts: Partial<TrackerSpreadsheetFields> = { ...partialTs };
  const extracted = minimalExtracted(ts);
  const rules = withSanitizedRuleNotes(evaluateRules(extracted, userProfile), extracted, userProfile);
  const scoreTotal = parseLatestScore(ts.latestScore ?? '');
  const score = scoreBreakdownFromTotal(scoreTotal);
  const recommendation = recommendationFromScoreTotal(scoreTotal);
  const status: JobStatus = mapSpreadsheetStatusToJobStatus(ts.statusOutcome ?? '');
  const salaryAsk = parseSalaryAskFromText(ts.salaryAsk ?? '');
  const recommendedResume = parseResumeColumn(ts.resume ?? '');
  const now = new Date().toISOString();
  const topMatch = (ts.topMatch ?? '').trim();
  const mainRisk = (ts.mainRisk ?? '').trim();
  const priority =
    (ts.priority ?? '').trim() || defaultTrackerPriority(scoreTotal);
  const recommendedAction =
    (ts.recommendedAction ?? '').trim() ||
    defaultRecommendedAction(recommendation);

  /** Exact cell strings from the sheet (no trimming) for export parity. */
  const trackerSpreadsheet: Partial<TrackerSpreadsheetFields> = { ...ts };

  const notesFromSheet =
    ts.notes !== undefined && ts.notes !== null ? String(ts.notes) : undefined;

  const job: JobRecord = {
    id: randomUUID(),
    extracted,
    rules,
    score,
    recommendation,
    salaryAsk,
    recommendedResume,
    resumeRationale: [],
    topMatch,
    mainRisk,
    rationale: [],
    risks: [],
    generated: {},
    tracker: {
      priority,
      recommendedAction,
      statusOutcome: status,
      shortlist: shouldShortlist(score.total, status),
      color: getTrackerColor(status, score.total),
      notes: notesFromSheet === '' ? undefined : notesFromSheet,
    },
    trackerSpreadsheet,
    importKey,
    importSource,
    status,
    createdAt: createdAt ?? now,
    updatedAt: now,
    scoreHistory: [{ scoredAt: now, score, recommendation }],
  };
  return job;
}
