/**
 * One-time / repeatable seed: import rows from the "All Applications" sheet into Mongo.
 *
 * Usage:
 *   npm run import:tracker -- [path/to/file.xlsx] [--dry-run] [--fingerprint=manual-id]
 *
 * Default file (repo root): data/job_role_scores_current.xlsx
 * Place your real workbook there (or pass an explicit path).
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { closeDb } from '../src/config/mongo.js';
import { repoRootDir } from '../src/config/env.js';
import { parseHeaderRow } from '../src/tracker/canonicalSpreadsheet.js';
import {
  buildImportKey,
  jobRecordFromImportedSheetRow,
  rowArrayToPartialTrackerSpreadsheet,
} from '../src/tracker/importedJobFromSheet.js';

const defaultWorkbookPath = () =>
  path.join(repoRootDir, 'data', 'job_role_scores_current.xlsx');

function findSheetName(names: string[], wanted: string): string | undefined {
  const t = wanted.trim().toLowerCase();
  return names.find((n) => n.trim().toLowerCase() === t);
}

function parseArgs(argv: string[]) {
  let dryRun = false;
  let fingerprint: string | undefined;
  const positional: string[] = [];
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--fingerprint=')) fingerprint = a.slice('--fingerprint='.length);
    else if (!a.startsWith('-')) positional.push(a);
  }
  const filePath = positional[0] ? path.resolve(positional[0]) : defaultWorkbookPath();
  return { filePath, dryRun, fingerprint };
}

function fileFingerprint(filePath: string, override?: string): string {
  if (override?.trim()) return override.trim();
  const buf = fs.readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

async function main() {
  const { filePath, dryRun, fingerprint: fpArg } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(filePath)) {
    console.error(`Workbook not found: ${filePath}`);
    console.error('Copy your .xlsx into the repo (e.g. data/job_role_scores_current.xlsx) or pass a path.');
    process.exit(1);
  }

  const fp = fileFingerprint(filePath, fpArg);
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = findSheetName(wb.SheetNames, 'All Applications');
  if (!sheetName) {
    console.error(
      `No "All Applications" sheet. Found: ${wb.SheetNames.join(', ')}`,
    );
    process.exit(1);
  }

  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (!matrix.length) {
    console.error('Sheet is empty.');
    process.exit(1);
  }

  const headerRow = matrix[0] as unknown[];
  const colMap = parseHeaderRow(headerRow);
  if (colMap.size < 3) {
    console.error(
      'Could not map enough columns from the header row. Expected headers like Company, Role, etc.',
    );
    process.exit(1);
  }

  let imported = 0;
  let skipped = 0;

  const repo = dryRun
    ? null
    : (await import('../src/services/jobs/jobs.repository.js')).jobsRepository;

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
      sheetName,
      rowNumber,
      fileFingerprint: fp,
      company: company || 'Unknown',
      role: role || 'Unknown role',
    });

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

    if (dryRun) {
      console.log(`[dry-run] row ${rowNumber} ${company} / ${role} importKey=${importKey.slice(0, 12)}…`);
      imported++;
      continue;
    }

    await repo!.upsertByImportKey(job);
    imported++;
  }

  const shortlistName = findSheetName(wb.SheetNames, 'Shortlist');
  if (shortlistName) {
    const sl = wb.Sheets[shortlistName];
    const slMatrix = XLSX.utils.sheet_to_json<unknown[]>(sl, {
      header: 1,
      defval: '',
      raw: false,
    });
    const slHeader = (slMatrix[0] ?? []) as unknown[];
    const slMap = parseHeaderRow(slHeader);
    const companyCol = [...slMap.entries()].find(([, v]) => v === 'company')?.[0];
    const names = new Set<string>();
    if (companyCol !== undefined) {
      for (let r = 1; r < slMatrix.length; r++) {
        const nm = String((slMatrix[r] as unknown[])[companyCol] ?? '').trim();
        if (nm) names.add(nm.toLowerCase());
      }
    }
    console.log(
      `[validation] Shortlist sheet has ${names.size} company-like cells (not used as source of truth).`,
    );
  }

  console.log(
    `Done. ${dryRun ? 'Would import' : 'Imported'} ${imported} row(s); skipped empty ${skipped}.`,
  );

  if (!dryRun) {
    await closeDb();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
