import { createHash, randomUUID } from 'node:crypto';
import { evaluateRules } from '../agents/jobAgent/rules.js';
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

export function buildImportKey(input: {
  sheetName: string;
  rowNumber: number;
  fileFingerprint: string;
  company: string;
  role: string;
}): string {
  const raw = [
    input.sheetName,
    String(input.rowNumber),
    input.fileFingerprint,
    input.company.trim().toLowerCase(),
    input.role.trim().toLowerCase(),
  ].join('|');
  return createHash('sha256').update(raw, 'utf8').digest('hex');
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
  if (rec === 'yes') return 'Apply with urgency';
  if (rec === 'selective_yes') return 'Apply selectively with caveats';
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
  const rules = evaluateRules(extracted, userProfile);
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

  const trackerSpreadsheet: Partial<TrackerSpreadsheetFields> = { ...ts };

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
      notes: (ts.notes ?? '').trim() || undefined,
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
