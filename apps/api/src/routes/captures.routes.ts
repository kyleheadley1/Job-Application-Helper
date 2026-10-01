import { Router } from "express";
import { z } from "zod";
import { requireExtensionToken } from "../lib/requireExtensionToken.js";
import { capturesService, toCaptureView } from "../services/captures/captures.service.js";

export const capturesRouter = Router();

capturesRouter.use(requireExtensionToken);

export const MIN_CAPTURE_JD_CHARS = 200;

const CreateCaptureBodySchema = z.object({
  sourceUrl: z.string().url().optional(),
  pageTitle: z.string().max(500).optional(),
  jdText: z
    .string()
    .trim()
    .min(MIN_CAPTURE_JD_CHARS, `JD text must be at least ${MIN_CAPTURE_JD_CHARS} characters.`)
    .max(100_000),
  captureMethod: z.enum(["selection", "jsonld", "container", "paste"]),
  force: z.boolean().optional(),
});

const ListCapturesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

capturesRouter.post("/", async (req, res, next) => {
  try {
    const body = CreateCaptureBodySchema.parse(req.body);
    const { capture, deduped } = await capturesService.create(body);
    res.setHeader("Cache-Control", "no-store");
    res.status(202).json({ ...toCaptureView(capture), deduped });
  } catch (error) {
    next(error);
  }
});

capturesRouter.get("/", async (req, res, next) => {
  try {
    const { limit } = ListCapturesQuerySchema.parse(req.query);
    const items = await capturesService.listRecent(limit);
    res.setHeader("Cache-Control", "no-store");
    res.json({ items: items.map(toCaptureView) });
  } catch (error) {
    next(error);
  }
});

capturesRouter.get("/:id", async (req, res, next) => {
  try {
    const capture = await capturesService.getById(req.params.id);
    if (!capture) {
      res.status(404).json({ error: "CAPTURE_NOT_FOUND", message: "Capture not found" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(toCaptureView(capture));
  } catch (error) {
    next(error);
  }
});
