import "../src/config/env.js";
import { closeDb, getDb } from "../src/config/mongo.js";
import {
  evaluateShortlist,
  hasQualifyingShortlistSignal,
  jobFinalScore,
  jobHardGates,
  jobPoolFriendliness,
} from "../src/lib/shortlist.js";
import {
  daysSinceTrackerActivity,
  resolveTrackerActivityDate,
} from "../src/lib/trackerWorkflowFreshness.js";
import { recomputeStoredJobScore } from "../src/lib/recomputeStoredJobScore.js";
import { resumeContextService } from "../src/services/resume/resumeContext.js";
import type { JobRecord } from "../src/types/job.js";

async function main() {
  const reasons = { wrongStatus: 0, hardGate: 0, stale: 0, noSignal: 0, eligible: 0 };
  const statusCounts: Record<string, number> = {};
  const scoreBands = { gte78: 0, gte70: 0, lt70: 0 };
  const poolBands = { gte62: 0, missing: 0, lt62: 0 };
  const activityDays: number[] = [];

  const ctx = await resumeContextService.getAvailableContexts();
  const db = await getDb();
  const docs = await db.collection("jobs").find({}).toArray();

  const eligibleJobs: Array<{ company: string; final: number; pool: number | undefined }> = [];

  for (const doc of docs) {
    const { _id, ...rest } = doc;
    const job = { ...rest, id: rest.id ?? String(_id) } as JobRecord;
    statusCounts[job.status] = (statusCounts[job.status] ?? 0) + 1;

    const rec = recomputeStoredJobScore({ job, resumeContexts: ctx });
    const merged = { ...job, ...rec };
    const final = jobFinalScore(merged);
    if (final >= 78) scoreBands.gte78++;
    else if (final >= 70) scoreBands.gte70++;
    else scoreBands.lt70++;

    const pool = jobPoolFriendliness(merged);
    if (pool == null) poolBands.missing++;
    else if (pool >= 0.62) poolBands.gte62++;
    else poolBands.lt62++;

    const days = daysSinceTrackerActivity(merged);
    activityDays.push(days);

    const eval_ = evaluateShortlist(merged);
    if (eval_.onShortlist) {
      reasons.eligible++;
      eligibleJobs.push({
        company: merged.extracted?.company ?? "",
        final: jobFinalScore(merged),
        pool: jobPoolFriendliness(merged),
      });
      continue;
    }
    if (job.status !== "to_review") reasons.wrongStatus++;
    else if (jobHardGates(merged).length) reasons.hardGate++;
    else if (days > 30 && !merged.referralPathwayAvailable) reasons.stale++;
    else if (!hasQualifyingShortlistSignal(merged)) reasons.noSignal++;
  }

  activityDays.sort((a, b) => a - b);
  const medianActivity = activityDays[Math.floor(activityDays.length / 2)] ?? 0;
  const gt30 = activityDays.filter((d) => d > 30).length;

  console.log(
    JSON.stringify(
      {
        total: docs.length,
        statusCounts,
        reasons,
        scoreBands,
        poolBands,
        workflowAgeDays: { median: medianActivity, over30: gt30, max: activityDays.at(-1) },
        eligibleJobs,
        toReviewSample: docs
          .filter((d) => d.status === "to_review")
          .slice(0, 5)
          .map((d) => {
            const job = { ...d, id: d.id ?? String(d._id) } as JobRecord;
            const rec = recomputeStoredJobScore({ job, resumeContexts: ctx });
            const merged = { ...job, ...rec };
            return {
              company: job.extracted?.company,
              final: jobFinalScore(merged),
              pool: jobPoolFriendliness(merged),
              daysSinceApply: daysSinceTrackerActivity(merged),
              appliedAt: resolveTrackerActivityDate(merged),
              gates: jobHardGates(merged).length,
              eligible: evaluateShortlist(merged).onShortlist,
            };
          }),
      },
      null,
      2,
    ),
  );

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
