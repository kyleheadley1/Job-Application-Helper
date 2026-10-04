import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { gmailAuth, isGmailConfigured } from "./gmailAuth.js";
import { DEFAULT_SYNC_DAYS, syncGmail } from "./gmailSync.js";
import { startRecoveryRun } from "./jdRecovery/runRecovery.js";
import { runDailyAgentIfDue } from "../agent/dailyAgent.js";

/** Leaves startup work (tracker import, resume preload) a head start before a catch-up sync. */
const MIN_DELAY_MS = 60_000;

let timer: NodeJS.Timeout | null = null;

/** Time until the next sync is due; a manual sync pushes the schedule back. */
export const nextSyncDelayMs = (lastSyncAt: string | undefined, intervalMs: number, now = Date.now()): number => {
  const last = lastSyncAt ? Date.parse(lastSyncAt) : NaN;
  if (!Number.isFinite(last)) return MIN_DELAY_MS;
  return Math.min(intervalMs, Math.max(MIN_DELAY_MS, last + intervalMs - now));
};

const schedule = (delayMs: number, intervalMs: number) => {
  timer = setTimeout(() => void tick(intervalMs), delayMs);
  timer.unref();
};

/** Failed or disconnected runs wait a full interval, so an expired token isn't retried every minute. */
const tick = async (intervalMs: number): Promise<void> => {
  let nextMs = intervalMs;
  try {
    const status = await gmailAuth.getStatus();
    if (!status.configured || !status.connected) return;
    const dueIn = nextSyncDelayMs(status.lastSyncAt, intervalMs);
    if (dueIn > MIN_DELAY_MS) {
      nextMs = dueIn;
      return;
    }
    const result = await syncGmail(DEFAULT_SYNC_DAYS);
    const recovery = await startRecoveryRun(DEFAULT_SYNC_DAYS);
    logger.info("Scheduled Gmail sync complete", {
      scanned: result.scanned,
      classified: result.classified,
      applicationEmails: result.applicationEmails,
      recoveryStarted: recovery.started,
    });
    await runDailyAgentIfDue();
  } catch (error) {
    logger.warn("Scheduled Gmail sync failed", { message: error instanceof Error ? error.message : String(error) });
  } finally {
    schedule(nextMs, intervalMs);
  }
};

export const startGmailSyncScheduler = (): void => {
  const minutes = env.gmailAutoSyncMinutes;
  if (!minutes || !isGmailConfigured()) {
    logger.info("Gmail auto-sync disabled", { minutes, configured: isGmailConfigured() });
    return;
  }
  if (timer) return;
  const intervalMs = minutes * 60_000;
  void gmailAuth
    .getStatus()
    .then((s) => schedule(nextSyncDelayMs(s.lastSyncAt, intervalMs), intervalMs))
    .catch(() => schedule(intervalMs, intervalMs));
  logger.info("Gmail auto-sync started", { minutes });
};

export const stopGmailSyncScheduler = (): void => {
  if (timer) clearTimeout(timer);
  timer = null;
};
