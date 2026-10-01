import { randomUUID } from "node:crypto";
import { triageJob } from "../../agents/jobAgent/orchestrator.js";
import { jdTextHashFromInput } from "../../lib/jdTextHash.js";
import { logger } from "../../lib/logger.js";
import type { JobRecord } from "../../types/job.js";
import {
  capturesRepository,
  type CaptureMethod,
  type CaptureStatus,
  type JobCapture,
} from "./captures.repository.js";

export type CreateCaptureInput = {
  sourceUrl?: string;
  pageTitle?: string;
  jdText: string;
  captureMethod: CaptureMethod;
  /** Skip dedupe and score again (e.g. after a better capture of the same URL). */
  force?: boolean;
};

export type CaptureSummary = {
  company: string;
  title: string;
  scoreTotal: number;
  recommendation: JobRecord["recommendation"];
  recommendationLabel?: string;
  recommendedResume: JobRecord["recommendedResume"];
  hardGate?: string;
  mainRisk?: string;
};

export type CaptureView = {
  id: string;
  status: CaptureStatus;
  error?: string;
  jobId?: string;
  sourceUrl?: string;
  pageTitle?: string;
  captureMethod: CaptureMethod;
  createdAt: string;
  updatedAt: string;
  summary?: CaptureSummary;
};

const TRACKING_PARAM_RE = /^(utm_|gh_src$|ref$|refId$|trk|source$|lever-source|fbclid$|gclid$)/i;

export const normalizeSourceUrl = (raw?: string): string | undefined => {
  if (!raw?.trim()) return undefined;
  try {
    const url = new URL(raw.trim());
    if (!/^https?:$/.test(url.protocol)) return undefined;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM_RE.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    const out = url.toString();
    return out.endsWith("/") ? out.slice(0, -1) : out;
  } catch {
    return undefined;
  }
};

export const buildCaptureSummary = (job: JobRecord): CaptureSummary => ({
  company: job.extracted.companyDisplayName ?? job.extracted.company,
  title: job.extracted.title,
  scoreTotal: job.score.total,
  recommendation: job.recommendation,
  recommendationLabel: job.score.recommendationLabel,
  recommendedResume: job.recommendedResume,
  hardGate: job.score.scoreDisplay?.hardGates?.[0],
  mainRisk: job.mainRisk || undefined,
});

export const toCaptureView = (capture: JobCapture): CaptureView => ({
  id: capture.id,
  status: capture.status,
  error: capture.error,
  jobId: capture.jobId,
  sourceUrl: capture.sourceUrl,
  pageTitle: capture.pageTitle,
  captureMethod: capture.captureMethod,
  createdAt: capture.createdAt,
  updatedAt: capture.updatedAt,
  summary: capture.result ? buildCaptureSummary(capture.result) : undefined,
});

const MAX_CONCURRENT_SCORING = 2;

export class CapturesService {
  private running = 0;
  private readonly pending: string[] = [];
  private readonly inFlight = new Set<string>();

  async create(input: CreateCaptureInput): Promise<{ capture: JobCapture; deduped: boolean }> {
    const jdText = input.jdText.trim();
    const jdTextHash = jdTextHashFromInput({ rawText: jdText });
    const normalizedSourceUrl = normalizeSourceUrl(input.sourceUrl);

    if (!input.force) {
      const existing = await capturesRepository.findActiveDuplicate({
        jdTextHash,
        normalizedSourceUrl,
      });
      if (existing) return { capture: existing, deduped: true };
    }

    const now = new Date().toISOString();
    const capture = await capturesRepository.insert({
      id: randomUUID(),
      sourceUrl: input.sourceUrl?.trim() || undefined,
      normalizedSourceUrl,
      pageTitle: input.pageTitle?.trim() || undefined,
      jdText,
      captureMethod: input.captureMethod,
      jdTextHash,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
    this.enqueue(capture.id);
    return { capture, deduped: false };
  }

  getById(id: string): Promise<JobCapture | null> {
    return capturesRepository.getById(id);
  }

  listRecent(limit: number): Promise<JobCapture[]> {
    return capturesRepository.listRecent(limit);
  }

  /** Re-queue captures interrupted by an API restart. */
  async resumeUnfinished(): Promise<number> {
    const unfinished = await capturesRepository.listUnfinished();
    for (const capture of unfinished) {
      await capturesRepository.update(capture.id, { status: "queued" });
      this.enqueue(capture.id);
    }
    if (unfinished.length > 0) {
      logger.info("Re-queued unfinished job captures", { count: unfinished.length });
    }
    return unfinished.length;
  }

  /** Resolves once every queued and running capture has finished (used by tests). */
  async drain(): Promise<void> {
    while (this.running > 0 || this.pending.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private enqueue(id: string): void {
    if (this.inFlight.has(id) || this.pending.includes(id)) return;
    this.pending.push(id);
    this.pump();
  }

  private pump(): void {
    while (this.running < MAX_CONCURRENT_SCORING && this.pending.length > 0) {
      const id = this.pending.shift()!;
      this.running += 1;
      this.inFlight.add(id);
      void this.runScoring(id).finally(() => {
        this.running -= 1;
        this.inFlight.delete(id);
        this.pump();
      });
    }
  }

  private async runScoring(id: string): Promise<void> {
    const capture = await capturesRepository.getById(id);
    if (!capture || capture.status === "complete") return;
    await capturesRepository.update(id, { status: "scoring", error: undefined });
    try {
      // rawText only: the page was already read in the browser, and fetching the URL
      // again would merge different text (and change the JD hash) on re-triage.
      const result = await triageJob({ rawText: capture.jdText, fullPrep: false });
      await capturesRepository.update(id, {
        status: "complete",
        jobId: result.id,
        result,
      });
      logger.info("Job capture scored", {
        captureId: id,
        jobId: result.id,
        score: result.score.total,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await capturesRepository.update(id, { status: "failed", error: message });
      logger.error("Job capture scoring failed", { captureId: id, message });
    }
  }
}

export const capturesService = new CapturesService();
