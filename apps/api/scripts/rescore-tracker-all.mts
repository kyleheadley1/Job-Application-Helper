/**
 * Deterministic bulk rescore for all tracker jobs: re-runs rules + composite on stored
 * extraction and LLM category scores (no scoring LLM, no JD re-extraction).
 *
 *   # preview (default; no DB writes)
 *   npm run rescore:tracker-all
 *
 *   # persist all recomputed scores
 *   npm run rescore:tracker-all -- --apply
 *
 *   # include rejected / closed rows (skipped by default)
 *   npm run rescore:tracker-all -- --apply --include-blocked
 */
import "../src/config/env.js";
import { closeDb } from "../src/config/mongo.js";
import { userProfile } from "../src/config/userProfile.js";
import { isBlockedStatusForRescore } from "../src/lib/trackerRescore.js";
import { recomputeStoredJobScore } from "../src/lib/recomputeStoredJobScore.js";
import { polishRisksAndMain } from "../src/lib/scoringOutputPolish.js";
import { resumeContextService } from "../src/services/resume/resumeContext.js";
import { jobsRepository } from "../src/services/jobs/jobs.repository.js";
import type { JobRecord } from "../src/types/job.js";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const includeBlocked = argv.includes("--include-blocked");

function pickJobs(jobs: JobRecord[]): JobRecord[] {
  if (includeBlocked) return jobs;
  return jobs.filter((j) => !isBlockedStatusForRescore(j.status));
}

async function main() {
  const resumeContexts = await resumeContextService.getAvailableContexts();
  const all = await jobsRepository.findAll();
  const targets = pickJobs(all);

  console.log(
    `Found ${all.length} jobs; ${targets.length} to rescore${includeBlocked ? " (including blocked)" : ""}.`,
  );
  console.log(`Mode: ${apply ? "APPLY writes" : "dry-run (no writes)"}\n`);

  let examined = 0;
  let changed = 0;
  let applied = 0;
  let errors = 0;

  for (const job of targets) {
    examined += 1;
    const oldTotal = job.score.total;
    const oldRec = job.recommendation;

    try {
      const next = recomputeStoredJobScore({ job, resumeContexts });
      const newTotal = next.score.total;
      const delta = newTotal - oldTotal;
      const recChanged = next.recommendation !== oldRec;

      if (delta !== 0 || recChanged) changed += 1;

      const co = String(job.extracted.company ?? "").slice(0, 28).padEnd(28);
      const recNote = recChanged ? ` | rec ${oldRec}→${next.recommendation}` : "";
      console.log(
        `${co} | ${String(oldTotal).padStart(3)} → ${String(newTotal).padStart(3)} (Δ${delta >= 0 ? "+" : ""}${delta})${recNote}`,
      );

      if (apply) {
        const polished = polishRisksAndMain({
          mainRisk: job.mainRisk,
          risks: job.risks ?? [],
          extracted: job.extracted,
          rules: next.rules,
          userProfile,
          max: 5,
        });
        const saved = await jobsRepository.applyTrackerRescore({
          id: job.id,
          previousScoreTotal: oldTotal,
          rules: next.rules,
          score: next.score,
          recommendation: next.recommendation,
          salaryAsk: next.salaryAsk,
          topMatch: job.topMatch,
          mainRisk: polished.mainRisk,
          rationale: job.rationale,
          risks: polished.risks,
          referralPathwayAvailable: next.referralPathwayAvailable,
          referralPathwayNotes: next.referralPathwayNotes,
        });
        if (saved) applied += 1;
        else {
          errors += 1;
          console.error(`  !! Failed to persist ${job.id}`);
        }
      }
    } catch (e) {
      errors += 1;
      console.error(`  !! Error on ${job.id} (${job.extracted.company}):`, e);
    }
  }

  console.log(
    `\nExamined: ${examined}; changed: ${changed}; applied: ${apply ? applied : 0}; errors: ${errors}`,
  );
  console.log(
    "Shortlist tab uses score ≥78 and non-rejected/closed — updated jobs refresh tracker.shortlist automatically.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => undefined);
  });
