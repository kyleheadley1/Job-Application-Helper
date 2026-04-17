import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import XLSX from 'xlsx';
import type { JobRecord } from '../types/job.js';
import { parseHeaderRow } from './canonicalSpreadsheet.js';
import {
  buildImportKey,
  jobRecordFromImportedSheetRow,
  rowArrayToPartialTrackerSpreadsheet,
} from './importedJobFromSheet.js';

export type RunAllApplicationsImportResult = {
  imported: number;
  skipped: number;
  skippedReason: string;
  fileFingerprint: string;
  sheetName: string;
  workbookPath: string;
  /** Distinct importKey values among non-skipped sheet rows. */
  uniqueImportKeys: number;
  /** Keys that appeared on more than one sheet row (last row wins in DB). */
  duplicateImportKeySamples: Array<{ importKey: string; rowCount: number }>;
};

function findSheetName(names: string[], wanted: string): string | undefined {
  const t = wanted.trim().toLowerCase();
  return names.find((n) => n.trim().toLowerCase() === t);
}

export function computeFileFingerprint(filePath: string, override?: string): string {
  if (override?.trim()) return override.trim();
  const buf = fs.readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/**
 * Import every data row from the “All Applications” sheet (canonical source).
 * Shortlist sheet is never read here.
 */
export async function runAllApplicationsImport(
  filePath: string,
  options: {
    dryRun?: boolean;
    fingerprint?: string;
  } = {},
): Promise<RunAllApplicationsImportResult> {
  const dryRun = Boolean(options.dryRun);
  const fp = computeFileFingerprint(filePath, options.fingerprint);
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = findSheetName(wb.SheetNames, 'All Applications');
  if (!sheetName) {
    throw new Error(
      `No "All Applications" sheet. Found: ${wb.SheetNames.join(', ')}`,
    );
  }

  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (!matrix.length) {
    throw new Error('Sheet is empty.');
  }

  const headerRow = matrix[0] as unknown[];
  const colMap = parseHeaderRow(headerRow);
  if (colMap.size < 3) {
    throw new Error(
      'Could not map enough columns from the header row. Expected headers like Company, Role, etc.',
    );
  }

  let imported = 0;
  let skipped = 0;
  const importKeyCounts = new Map<string, number>();

  const repo = dryRun
    ? null
    : (await import('../services/jobs/jobs.repository.js')).jobsRepository;

  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i] as unknown[];
    const partialTs = rowArrayToPartialTrackerSpreadsheet(row, colMap);
    const company = (partialTs.company ?? '').trim();
    const role = (partialTs.role ?? '').trim();
    if (!company && !role) {
      skipped++;
      continue;
    }

    const rowNumber = i + 1;
    const importKey = buildImportKey({
      fileFingerprint: fp,
      company: company || 'Unknown',
      role: role || 'Unknown role',
      jdInput: partialTs.jdInput ?? '',
      salaryAskRaw: partialTs.salaryAsk ?? '',
      latestScoreRaw: partialTs.latestScore ?? '',
      originalAltScoreRaw: partialTs.originalAltScore ?? '',
    });

    importKeyCounts.set(importKey, (importKeyCounts.get(importKey) ?? 0) + 1);

    const importSource = {
      spreadsheetPath: filePath,
      sheetName,
      rowNumber,
      fileFingerprint: fp,
    };

    const job = jobRecordFromImportedSheetRow({
      partialTs,
      importSource,
      importKey,
    });

    if (!dryRun) {
      await repo!.upsertByImportKey(job);
    }
    imported++;
  }

  const duplicateImportKeySamples = [...importKeyCounts.entries()]
    .filter(([, c]) => c > 1)
    .slice(0, 15)
    .map(([importKey, rowCount]) => ({ importKey, rowCount }));

  return {
    imported,
    skipped,
    skippedReason: 'empty Company and Role cells',
    fileFingerprint: fp,
    sheetName,
    workbookPath: filePath,
    uniqueImportKeys: importKeyCounts.size,
    duplicateImportKeySamples,
  };
}
