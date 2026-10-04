import type { JobStatus } from "../../types/job.js";
import { gmailAuth } from "../gmail/gmailAuth.js";
import { getGmailApplications } from "../gmail/gmailApplications.js";
import {
  createReplyDraft,
  resolveReplyTarget,
  type OutboxEntry,
  type ReplyTarget,
} from "../gmail/replyDraft.js";
import { jobsRepository } from "../jobs/jobs.repository.js";

/**
 * The only paths that change anything outside the app's own suggestion lists. Both Next steps and the
 * assistant call these, and only from an Approve request carrying the exact text or change you saw.
 */

/** Long enough to find applications whose last email is months old. */
const APP_LOOKBACK_DAYS = 120;

export class ProposalTargetError extends Error {}
export class DraftsNotAllowedError extends Error {}

const findApplication = async (appKey: string) => {
  const app = (await getGmailApplications(APP_LOOKBACK_DAYS)).find((a) => a.key === appKey);
  if (!app) throw new ProposalTargetError(`Application ${appKey} not found in Gmail`);
  return app;
};

export const replyTargetFor = async (appKey: string, preferEmailId?: string): Promise<ReplyTarget> =>
  resolveReplyTarget(await findApplication(appKey), preferEmailId);

export const executeEmailDraft = async (input: {
  appKey: string;
  preferEmailId?: string;
  to: string;
  body: string;
  source: OutboxEntry["source"];
  sourceId: string;
  kind: string;
}): Promise<OutboxEntry> => {
  if (!(await gmailAuth.getStatus()).canCreateDrafts) {
    throw new DraftsNotAllowedError("Reconnect Gmail to allow drafts (create-only; the app can never send).");
  }
  // The thread is re-resolved on the server; the client only supplies the recipient and approved text.
  const target = await replyTargetFor(input.appKey, input.preferEmailId);
  return createReplyDraft({
    target,
    to: input.to,
    body: input.body,
    log: { source: input.source, sourceId: input.sourceId, kind: input.kind, appKey: input.appKey },
  });
};

export const executeTrackerStatus = async (jobId: string, status: JobStatus, note: string): Promise<void> => {
  const updated = await jobsRepository.updateStatus(jobId, status, note);
  if (!updated) throw new ProposalTargetError(`Tracker job ${jobId} not found`);
};
