import { describe, expect, it } from 'vitest';
import { JobExportRowSchema } from '../../agents/jobAgent/schemas.js';
import {
  TRACKER_EXPORT_HEADERS,
  buildJobExportRow,
  buildTrackerSpreadsheetFromJob,
} from '../../tracker/canonicalSpreadsheet.js';
import type { JobRecord } from '../../types/job.js';

const minimalJob = (): JobRecord => ({
  id: 'test-id',
  extracted: {
    company: 'Acme',
    title: 'Engineer',
    rawText: 'Do things',
    stack: [],
    requiredSkills: [],
    preferredSkills: [],
    domainTags: [],
    responsibilities: [],
    requirements: [],
  },
  rules: {
    explicitDegreeRisk: false,
    traditionalCompanyPenalty: false,
    financePenalty: false,
    strictNewGradPipeline: false,
    earlyCareerFriendlyRole: false,
    newGradPenalty: false,
    seniorityOverreach: false,
    locationMismatch: false,
    visaMismatch: false,
    citizenshipMismatch: false,
    clearanceMismatch: false,
    stackMismatch: false,
    domainMismatch: false,
    startupFounderMismatch: false,
    notes: [],
  },
  score: {
    stackFit: 10,
    levelFit: 10,
    domainFit: 10,
    resumeStoryClarity: 10,
    functionalOverlap: 10,
    recruiterFriendliness: 10,
    careerValue: 10,
    total: 70,
  },
  recommendation: 'selective_yes',
  salaryAsk: { number: 150000 },
  recommendedResume: 'SWE',
  resumeRationale: [],
  topMatch: 'TypeScript',
  mainRisk: 'Onsite',
  rationale: [],
  risks: [],
  generated: {},
  tracker: {
    priority: 'medium',
    recommendedAction: 'Apply selectively',
    statusOutcome: 'to_review',
    shortlist: true,
    notes: 'Hello',
  },
  status: 'to_review',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('canonical export', () => {
  it('exports headers in spreadsheet order', () => {
    const job = minimalJob();
    const row = buildJobExportRow(job);
    expect(Object.keys(row)).toEqual([...TRACKER_EXPORT_HEADERS]);
  });

  it('prefers trackerSpreadsheet cells over internal fields', () => {
    const job = minimalJob();
    job.trackerSpreadsheet = {
      company: 'Sheet Co',
      latestScore: '88',
      notes: 'From sheet',
    };
    const row = buildJobExportRow(job);
    expect(row.Company).toBe('Sheet Co');
    expect(row['Latest Score']).toBe('88');
    expect(row.Notes).toBe('From sheet');
    expect(row.Role).toBe('Engineer');
  });

  it('JobExportRowSchema accepts all string cells', () => {
    const job = minimalJob();
    job.trackerSpreadsheet = buildTrackerSpreadsheetFromJob(job);
    const row = buildJobExportRow(job);
    expect(() => JobExportRowSchema.parse(row)).not.toThrow();
  });
});
