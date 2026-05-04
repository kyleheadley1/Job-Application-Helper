/**
 * Controlled retroactive rescoring for tracker rows (AI roles, penalty signals, 50–70 band).
 *
 *   # preview (default; no DB writes)
 *   npm run rescore:tracker
 *
 *   # persist updates that pass rules
 *   npm run rescore:tracker -- --apply
 *
 *   # include 50–70 applied-AI roles even without python/location/finance flags
 *   npm run rescore:tracker -- --apply --loose
 *
 *   # allow touching scores &lt;50 or ≥85 (use sparingly)
 *   npm run rescore:tracker -- --apply --force-low --force-high
 */
import "../src/config/env.js";
import { closeDb } from "../src/config/mongo.js";
import { userProfile } from "../src/config/userProfile.js";
import { evaluateRules } from "../src/agents/jobAgent/rules.js";
import { scoreJob } from "../src/agents/jobAgent/scoring.js";
import { computeSalaryAsk } from "../src/agents/jobAgent/salaryAsk.js";
import { resumeContextService } from "../src/services/resume/resumeContext.js";
import { jobsRepository } from "../src/services/jobs/jobs.repository.js";
import {
  getRescoreEligibility,
  isBlockedStatusForRescore,
  isStrictRescoreCandidate,
  shouldPersistRescore,
} from "../src/lib/trackerRescore.js";
import type { JobRecord } from "../src/types/job.js";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const loose = argv.includes("--loose");
const forceLowScores = argv.includes("--force-low");
const forceHighScores = argv.includes("--force-high");

function pickCandidates(jobs: JobRecord[]) {
  return jobs.filter((j) => {
    if (isBlockedStatusForRescore(j.status)) return false;
    if (loose) {
      const e = getRescoreEligibility(j);
      return e.inTargetBand && e.isAiShaped;
    }
    return isStrictRescoreCandidate(j);
  });
}

async function main() {
  const resumeContexts = await resumeContextService.getAvailableContexts();
  const all = await jobsRepository.findAll();
  const candidates = pickCandidates(all);

  console.log(
    `Found ${all.length} jobs; ${candidates.length} rescoring candidates (${loose ? "loose" : "strict"} penalty filter).`,
  );
  console.log(`Mode: ${apply ? "APPLY writes" : "dry-run (no writes)"}\n`);

  let examined = 0;
  let wouldUpdate = 0;
  let applied = 0;

  for (const job of candidates) {
    examined += 1;
    const oldTotal = job.score.total;
    const rules = evaluateRules(job.extracted, userProfile);
    const { scoring } = await scoreJob({
      extracted: job.extracted,
      rules,
      userProfile,
      resumeContexts,
    });
    const newTotal = scoring.score.total;
    const salaryAsk = computeSalaryAsk({
      extracted: job.extracted,
      score: scoring.score,
      recommendation: scoring.recommendation,
      rules,
    });

    const decision = shouldPersistRescore({
      oldTotal,
      newTotal,
      status: job.status,
      forceLowScores,
      forceHighScores,
    });

    const delta = newTotal - oldTotal;
    const co = String(job.extracted.company ?? "").slice(0, 28).padEnd(28);
    const line = `${co} | ${String(oldTotal).padStart(3)} → ${String(newTotal).padStart(3)} (Δ${delta >= 0 ? "+" : ""}${delta}) | ${decision.reason}`;

    if (!decision.apply) {
      console.log(line);
      continue;
    }

    wouldUpdate += 1;
    console.log(line);

    if (apply) {
      const saved = await jobsRepository.applyTrackerRescore({
        id: job.id,
        previousScoreTotal: oldTotal,
        rules,
        score: scoring.score,
        recommendation: scoring.recommendation,
        salaryAsk,
        topMatch: scoring.topMatch,
        mainRisk: scoring.mainRisk,
        rationale: scoring.rationale,
        risks: scoring.risks,
      });
      if (saved) applied += 1;
      else console.error(`  !! Failed to persist ${job.id}`);
    }
  }

  console.log(`\nExamined: ${examined}; would update: ${wouldUpdate}; applied: ${apply ? applied : 0}`);
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
