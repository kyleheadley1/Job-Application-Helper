import type { ExtractedJobData } from "../types/job.js";
import { normalizeText } from "./text.js";

/**
 * Structured fields first; rawText last. Shared foundation for Item G role-lane
 * and matcher blobs — prefer title/stack/requirements over scraped chrome.
 */
export const structuredFirstJobBlob = (job: ExtractedJobData): string =>
  normalizeText(
    [
      job.company,
      job.companyDisplayName,
      job.title,
      job.seniority,
      job.location,
      job.employmentType,
      ...(job.stack ?? []),
      ...(job.requiredSkills ?? []),
      ...(job.preferredSkills ?? []),
      ...(job.domainTags ?? []),
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
      job.rawText ?? "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
