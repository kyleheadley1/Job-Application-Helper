import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

const tokensMatch = (provided: string, expected: string): boolean => {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const requireExtensionToken = (req: Request, res: Response, next: NextFunction): void => {
  const expected = env.extensionApiToken;
  if (!expected) {
    res.status(503).json({
      error: "EXTENSION_TOKEN_NOT_CONFIGURED",
      message: "Set EXTENSION_API_TOKEN in the root .env and restart the API.",
    });
    return;
  }
  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !tokensMatch(match[1]!.trim(), expected)) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Missing or invalid extension token." });
    return;
  }
  next();
};
