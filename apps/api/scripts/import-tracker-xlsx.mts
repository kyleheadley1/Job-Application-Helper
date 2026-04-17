/**
 * One-time / repeatable seed: import rows from the "All Applications" sheet into Mongo.
 *
 * Usage:
 *   npm run import:tracker -- [path/to/file.xlsx] [--dry-run] [--fingerprint=manual-id]
 *
 * Default file (repo root): data/job_role_scores_current.xlsx
 * Place your real workbook there (or pass an explicit path).
 *
 * Idempotency: upserts by importKey derived from file fingerprint + row content
 * (company, role, JD, salary/score cells, etc.), not sheet row index — safe if rows reorder.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { closeDb } from '../src/config/mongo.js';
import { repoRootDir } from '../src/config/env.js';
import { parseHeaderRow } from '../src/tracker/canonicalSpreadsheet.js';
import { runAllApplicationsImport } from '../src/tracker/runAllApplicationsImport.js';

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

async function main() {
  const { filePath, dryRun, fingerprint: fpArg } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(filePath)) {
    console.error(`Workbook not found: ${filePath}`);
    console.error('Copy your .xlsx into the repo (e.g. data/job_role_scores_current.xlsx) or pass a path.');
    process.exit(1);
  }

  const ir = await runAllApplicationsImport(filePath, {
    dryRun,
    fingerprint: fpArg,
  });

  if (dryRun) {
    console.log(
      `[dry-run] Would process ${ir.imported} row(s); skipped empty ${ir.skipped}.`,
    );
    process.exit(0);
  }

  const wb = XLSX.readFile(filePath, { cellDates: true });
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
    `Done. Imported ${ir.imported} row(s); skipped empty ${ir.skipped}.`,
  );

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
