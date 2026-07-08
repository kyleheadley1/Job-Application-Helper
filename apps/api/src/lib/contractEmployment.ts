import { COMPOSITE_SCORING } from "../config/capabilitySurvivabilityPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import { normalizeText } from "./text.js";

export const isContractEmploymentType = (job: Pick<ExtractedJobData, "employmentType">): boolean =>
  normalizeText(job.employmentType ?? "") === "contract";

export const contractFinalDock = (job: ExtractedJobData): number =>
  isContractEmploymentType(job) ? COMPOSITE_SCORING.CONTRACT_FINAL_DOCK : 0;

export const buildContractCaveat = (job: ExtractedJobData): string | undefined => {
  if (!isContractEmploymentType(job)) return undefined;
  const hasSalary =
    Boolean(job.salary?.trim()) ||
    /\$\d|\bsalary\b|\bcompensation\b|\b\/hr\b|\bper hour\b/i.test(job.rawText ?? "");
  const base = "Contract role — not permanent; weigh stability/career-value.";
  if (!hasSalary) {
    return `${base} No posted rate — confirm hourly/length before over-investing.`;
  }
  return base;
};
