import { Router } from "express";
import {
  AdjustmentNotFoundError,
  AdjustmentTransitionError,
  getInsightsPanel,
  InsightsBusyError,
  runInsights,
  transitionAdjustment,
} from "../services/insights/insights.js";

export const insightsRouter = Router();

insightsRouter.get("/", async (_req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await getInsightsPanel());
  } catch (error) {
    next(error);
  }
});

insightsRouter.post("/run", async (_req, res, next) => {
  try {
    await runInsights("manual");
    res.json(await getInsightsPanel());
  } catch (error) {
    if (error instanceof InsightsBusyError) {
      res.status(409).json({ message: error.message });
      return;
    }
    next(error);
  }
});

for (const action of ["approve", "dismiss", "disable"] as const) {
  insightsRouter.post(`/adjustments/:id/${action}`, async (req, res, next) => {
    try {
      const adjustment = await transitionAdjustment(req.params.id!, action);
      res.json({ adjustment });
    } catch (error) {
      if (error instanceof AdjustmentNotFoundError) {
        res.status(404).json({ message: error.message });
        return;
      }
      if (error instanceof AdjustmentTransitionError) {
        res.status(409).json({ message: error.message });
        return;
      }
      next(error);
    }
  });
}
