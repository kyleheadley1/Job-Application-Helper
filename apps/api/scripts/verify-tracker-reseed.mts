/**
 * Clean reseed + parity report (uses same import path as `import:tracker`).
 *
 *   npm run verify:tracker -- [optional/path/to.xlsx]
 */
import '../src/config/env.js';
import path from 'node:path';
import { repoRootDir } from '../src/config/env.js';
import * as fs from 'node:fs';
import { closeDb, getDb } from '../src/config/mongo.js';
import { shouldShortlist } from "../src/lib/shortlist.js";
import { jobsRepository } from '../src/services/jobs/jobs.repository.js';
import {
  TRACKER_EXPORT_HEADERS,
  buildJobExportRow,
} from '../src/tracker/canonicalSpreadsheet.js';
import { runAllApplicationsImport } from '../src/tracker/runAllApplicationsImport.js';
import type { JobRecord } from '../src/types/job.js';

const defaultPath = () =>
  path.join(repoRootDir, 'data', 'job_role_scores_current.xlsx');

const toCsvCell = (value: string): string => {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const exportRowToCsvLine = (row: Record<string, string>): string =>
  [...TRACKER_EXPORT_HEADERS].map((h) => toCsvCell(row[h] ?? '')).join(',');

function assertExportShape(row: Record<string, string>): string[] {
  const mismatches: string[] = [];
  const keys = Object.keys(row);
  const expected = [...TRACKER_EXPORT_HEADERS];
  if (keys.length !== expected.length) {
    mismatches.push(`key count ${keys.length} !== ${expected.length}`);
  }
  expected.forEach((h, i) => {
    if (keys[i] !== h) {
      mismatches.push(`position ${i}: expected "${h}", got "${keys[i]}"`);
    }
  });
  for (const h of TRACKER_EXPORT_HEADERS) {
    if (typeof row[h] !== 'string') {
      mismatches.push(`"${h}" is not a string (${typeof row[h]})`);
    }
  }
  return mismatches;
}

function sampleSummary(job: JobRecord, idx: number): string {
  const ts = job.trackerSpreadsheet ?? {};
  const shortlistOk =
    job.tracker.shortlist === shouldShortlist(job);
  return [
    `--- sample #${idx + 1} id=${job.id.slice(0, 8)}… ---`,
    `  company: ${job.extracted.company}`,
    `  role: ${job.extracted.title}`,
    `  score.total: ${job.score.total}`,
    `  recommendation: ${job.recommendation}`,
    `  status: ${job.status}`,
    `  tracker.recommendedAction: ${job.tracker.recommendedAction ?? ''}`,
    `  salaryAsk: ${JSON.stringify(job.salaryAsk)}`,
    `  tracker.notes (len): ${(job.tracker.notes ?? '').length}`,
    `  recommendedResume: ${job.recommendedResume}`,
    `  trackerSpreadsheet.rank: ${JSON.stringify(ts.rank ?? '')}`,
    `  trackerSpreadsheet.discussed: ${JSON.stringify(ts.discussed ?? '')}`,
    `  trackerSpreadsheet.originalAltScore: ${JSON.stringify(ts.originalAltScore ?? '')}`,
    `  shortlist derived OK: ${shortlistOk} (shortlist=${job.tracker.shortlist})`,
  ].join('\n');
}

async function main() {
  const filePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : defaultPath();

  if (!fs.existsSync(filePath)) {
    console.error(`Missing workbook: ${filePath}`);
    process.exit(1);
  }

  console.log('1) Clearing jobs collection…');
  await jobsRepository.clearForTests();

  console.log('2) Importing All Applications…');
  const ir = await runAllApplicationsImport(filePath, {});

  const { items, total } = await jobsRepository.list({});
  const db = await getDb();
  const dupAgg = await db
    .collection('jobs')
    .aggregate<{ _id: string; c: number }>([
      { $match: { importKey: { $exists: true, $ne: null } } },
      { $group: { _id: '$importKey', c: { $sum: 1 } } },
      { $match: { c: { $gt: 1 } } },
    ])
    .toArray();

  const exportRows = items.map((j) => buildJobExportRow(j));
  const headerMismatches: string[] = [];
  for (let i = 0; i < exportRows.length; i++) {
    const m = assertExportShape(exportRows[i] as Record<string, string>);
    if (m.length) headerMismatches.push(`row ${i}: ${m.join('; ')}`);
  }

  const expectedHeaderLine = [...TRACKER_EXPORT_HEADERS]
    .map((h) => toCsvCell(h))
    .join(',');
  const csvLines = [
    expectedHeaderLine,
    ...exportRows.map((r) => exportRowToCsvLine(r as Record<string, string>)),
  ];
  const withSpreadsheetMeta = items.filter(
    (j) =>
      (j.trackerSpreadsheet?.rank ?? '') !== '' ||
      (j.trackerSpreadsheet?.discussed ?? '') !== '' ||
      (j.trackerSpreadsheet?.originalAltScore ?? '') !== '',
  );

  console.log('\n========== VERIFICATION REPORT ==========\n');
  console.log('--- row counts ---');
  console.log(`Sheet rows processed (non-skip): ${ir.imported}`);
  console.log(`Sheet rows skipped: ${ir.skipped} (${ir.skippedReason})`);
  console.log(`Distinct importKey from sheet: ${ir.uniqueImportKeys}`);
  console.log(`Mongo jobs total: ${total}`);
  if (ir.duplicateImportKeySamples.length) {
    console.log(
      `Sheet had duplicate importKeys (colliding rows; last wins): ${ir.duplicateImportKeySamples.length} key(s)`,
    );
    ir.duplicateImportKeySamples.forEach((d) =>
      console.log(`  importKey …${d.importKey.slice(-8)} rowCount=${d.rowCount}`),
    );
  }
  if (dupAgg.length) {
    console.log('ERROR: Mongo has duplicate importKey documents:', dupAgg);
  } else {
    console.log('Mongo duplicate importKey documents: none');
  }
  if (total !== ir.uniqueImportKeys) {
    console.log(
      `NOTE: Mongo total (${total}) vs sheet distinct keys (${ir.uniqueImportKeys}) — expected if sheet had duplicate keys (upsert) or if non-import jobs existed (cleared).`,
    );
  }

  console.log('\n--- shortlist (derived) ---');
  const badShortlist = items.filter(
    (j) => j.tracker.shortlist !== shouldShortlist(j),
  );
  if (badShortlist.length) {
    console.log(`FAIL: ${badShortlist.length} job(s) shortlist !== derived policy`);
  } else {
    console.log(`All ${items.length} job(s) match shouldShortlist(job).`);
  }

  console.log('\n--- export parity ---');
  if (headerMismatches.length) {
    console.log('JSON export shape issues:');
    headerMismatches.slice(0, 20).forEach((l) => console.log(l));
  } else {
    console.log('JSON export: all rows have canonical keys, order, and string cells.');
  }
  console.log(`CSV header exact match: ${csvLines[0] === expectedHeaderLine}`);

  console.log('\n--- spreadsheet-only columns present (sampled jobs) ---');
  console.log(
    `Jobs with non-empty Rank / Discussed / Original Alt Score: ${withSpreadsheetMeta.length}`,
  );
  const sampleCount = Math.min(3, items.length);
  for (let s = 0; s < sampleCount; s++) {
    console.log(sampleSummary(items[s], s));
  }

  const jsonSample = exportRows[0] ?? null;
  const csvSampleLine = exportRows[0]
    ? exportRowToCsvLine(exportRows[0] as Record<string, string>)
    : '';

  console.log('\n========== SAMPLES (for user report) ==========\n');
  console.log('Sample JSON export row (first job):');
  console.log(jsonSample ? JSON.stringify(jsonSample, null, 2) : '(no jobs)');
  console.log('\nSample CSV data row (first job, no header):');
  console.log(csvSampleLine || '(no jobs)');

  console.log('\n--- summary ---');
  const reseedClean =
    dupAgg.length === 0 &&
    badShortlist.length === 0 &&
    headerMismatches.length === 0 &&
    csvLines[0] === expectedHeaderLine;
  console.log(
    reseedClean
      ? 'Tracker reseed + export parity: PASS (no DB dup keys, shortlist OK, export shape OK)'
      : 'Tracker reseed: completed — review NOTE/FAIL lines above.',
  );

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
