import { Router, type Response } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { getGmailApplications } from "../services/gmail/gmailApplications.js";
import {
  gmailAuth,
  GmailNotConfiguredError,
  GmailNotConnectedError,
  GmailReconnectRequiredError,
} from "../services/gmail/gmailAuth.js";
import { DEFAULT_SYNC_DAYS, MAX_SYNC_DAYS, syncGmail } from "../services/gmail/gmailSync.js";
import { evaluationsRepository } from "../services/gmail/jdRecovery/evaluations.repository.js";
import {
  getRecoveryRunState,
  pendingApplications,
  refreshOutcomes,
  startRecoveryRun,
} from "../services/gmail/jdRecovery/runRecovery.js";
import { serperUsageRepository } from "../services/gmail/jdRecovery/serperClient.js";
import { buildRubricSummary, withEvaluations } from "../services/gmail/jdRecovery/summary.js";

export const gmailRouter = Router();

const DaysSchema = z.coerce.number().int().min(1).max(MAX_SYNC_DAYS).default(DEFAULT_SYNC_DAYS);
const SyncBodySchema = z.object({ days: DaysSchema });
const ApplicationsQuerySchema = z.object({ days: DaysSchema });

/** Applications with their evaluation summary; refreshes stored outcomes on the way. */
const applicationsWithEvaluations = async (days: number) => {
  const applications = await getGmailApplications(days);
  const evaluations = await evaluationsRepository.findByKeys(applications.map((a) => a.key));
  await refreshOutcomes(applications, evaluations);
  return {
    applications: withEvaluations(applications, evaluations),
    pendingRecovery: pendingApplications(applications, evaluations).length,
  };
};

/** Map known Gmail errors to clear statuses; returns false when the error is unknown. */
const sendGmailError = (res: Response, error: unknown): boolean => {
  if (error instanceof GmailNotConfiguredError) {
    res.status(503).json({ error: error.code, message: error.message });
    return true;
  }
  if (error instanceof GmailNotConnectedError) {
    res.status(409).json({ error: error.code, message: error.message });
    return true;
  }
  if (error instanceof GmailReconnectRequiredError) {
    res.status(401).json({ error: error.code, message: error.message });
    return true;
  }
  return false;
};

gmailRouter.get("/status", async (_req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await gmailAuth.getStatus());
  } catch (error) {
    next(error);
  }
});

gmailRouter.get("/oauth/start", (_req, res) => {
  try {
    res.redirect(gmailAuth.buildConsentUrl());
  } catch (error) {
    if (!sendGmailError(res, error)) {
      res.redirect(`${env.webAppUrl}/?gmail=error`);
    }
  }
});

gmailRouter.get("/oauth/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  const denied = typeof req.query.error === "string" ? req.query.error : undefined;
  if (denied || !code || !gmailAuth.consumeState(state)) {
    logger.warn("Gmail OAuth callback rejected", { denied, hasCode: Boolean(code) });
    res.redirect(`${env.webAppUrl}/?gmail=error`);
    return;
  }
  try {
    await gmailAuth.handleCallback(code);
    res.redirect(`${env.webAppUrl}/?gmail=connected`);
  } catch (error) {
    logger.error("Gmail OAuth callback failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    res.redirect(`${env.webAppUrl}/?gmail=error`);
  }
});

gmailRouter.post("/disconnect", async (_req, res, next) => {
  try {
    await gmailAuth.disconnect();
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

gmailRouter.post("/sync", async (req, res, next) => {
  try {
    const { days } = SyncBodySchema.parse(req.body ?? {});
    const result = await syncGmail(days);
    const view = await applicationsWithEvaluations(days);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...result, ...view });
  } catch (error) {
    if (sendGmailError(res, error)) return;
    next(error);
  }
});

gmailRouter.get("/applications", async (req, res, next) => {
  try {
    const { days } = ApplicationsQuerySchema.parse(req.query);
    res.setHeader("Cache-Control", "no-store");
    res.json({ days, ...(await applicationsWithEvaluations(days)) });
  } catch (error) {
    next(error);
  }
});

gmailRouter.post("/evaluations/run", async (req, res, next) => {
  try {
    const { days } = SyncBodySchema.parse(req.body ?? {});
    const result = await startRecoveryRun(days);
    res.status(202).json({ queued: result.queued, running: result.running, started: result.started });
  } catch (error) {
    next(error);
  }
});

gmailRouter.get("/evaluations", async (req, res, next) => {
  try {
    const { days } = ApplicationsQuerySchema.parse(req.query);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const [evaluations, usage] = await Promise.all([
      evaluationsRepository.listSince(since),
      serperUsageRepository.get(),
    ]);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      days,
      run: getRecoveryRunState(),
      serper: { used: usage.jobKeys.length, cap: usage.cap, configured: Boolean(env.serperApiKey) },
      rubricSummary: buildRubricSummary(evaluations),
      evaluations: evaluations.map(({ jd, ...rest }) =>
        jd ? { ...rest, jd: { title: jd.title, company: jd.company, datePosted: jd.datePosted, chars: jd.text.length } } : rest,
      ),
    });
  } catch (error) {
    next(error);
  }
});
