import type { ExtractedJobData } from "../types/job.js";
import { normalizeText } from "./text.js";

export type CompetitivePoolSignals = {
  ventureFunded: boolean;
  remoteNationalPool: boolean;
  broadGenericTitle: boolean;
  attractiveComp: boolean;
  freshPost: boolean;
  signalCount: number;
};

const FUNDING_RE =
  /\b(index ventures|a16z|andreessen|sequoia|benchmark|greylock|accel|kleiner|y\s*combinator|yc\b|series\s+[a-e]|seed\s+round|well[-\s]?funded|venture[-\s]?backed|unicorn)\b/i;

const FRESH_POST_RE =
  /\b(\d+\s+(minute|hour|hours|day|days)\s+ago|posted\s+(today|yesterday|just now)|newly\s+posted)\b/i;

export const isVentureFundedStartupShape = (combinedText: string): boolean =>
  FUNDING_RE.test(combinedText) &&
  !/\b(fortune\s+\d+|10,?000\s*\+?\s*employees|\b\d{5,}\s+employees|global\s+enterprise|publicly\s+traded\s+since\s+19)\b/i.test(
    combinedText,
  );

export const detectCompetitivePoolSignals = (
  job: ExtractedJobData,
  combinedText?: string,
): CompetitivePoolSignals => {
  const blob = normalizeText(
    combinedText ??
      [
        job.company,
        job.title,
        job.location,
        job.seniority,
        job.rawText ?? "",
        ...(job.domainTags ?? []),
      ].join("\n"),
  );

  const ventureFunded = FUNDING_RE.test(blob);
  const remoteNationalPool =
    job.remoteType === "remote" ||
    /\b(remote|work from anywhere|distributed team|fully remote)\b/i.test(blob);
  const broadGenericTitle =
    (/\bsoftware engineer\b/i.test(job.title ?? "") && /\bproduct\b/i.test(job.title ?? "")) ||
    (/\bsoftware engineer\b/i.test(job.title ?? "") &&
      !/\b(senior|staff|lead|principal|director|manager|infra|platform)\b/i.test(job.title ?? ""));
  const salaryMax = job.salary?.max ?? job.salary?.min ?? 0;
  const attractiveComp =
    salaryMax >= 120_000 ||
    /\b(\$1[2-9]\d{2}|\$2\d{2}|\$100\s*[–-]\s*\$1[89]\d|\$100\s*[–-]\s*\$185|\$100k\s*[–-]\s*\$185k)\b/i.test(blob);
  const freshPost = FRESH_POST_RE.test(blob);

  const signals = [ventureFunded, remoteNationalPool, broadGenericTitle, attractiveComp, freshPost];
  return {
    ventureFunded,
    remoteNationalPool,
    broadGenericTitle,
    attractiveComp,
    freshPost,
    signalCount: signals.filter(Boolean).length,
  };
};
