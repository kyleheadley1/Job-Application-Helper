import { applyCompanyPresentation } from "../tools/companyExtraction.js";
import { isPlaceholderCompanyName } from "../tools/companyCandidateRules.js";
import type { ExtractedJobData } from "../types/job.js";

const isUnknownCompany = (name: string | undefined | null): boolean =>
  !name?.trim() || isPlaceholderCompanyName(name);

/** Best stored company label to use as hint when re-extracting. */
export const companyHintFromExtracted = (extracted: ExtractedJobData): string | undefined => {
  for (const candidate of [
    extracted.employerCompanyName,
    extracted.listingCompanyName,
    extracted.companyDisplayName,
    extracted.company,
  ]) {
    const trimmed = candidate?.trim();
    if (trimmed && !isUnknownCompany(trimmed)) return trimmed;
  }
  return undefined;
};

/** Keep a known employer when re-triage extraction degrades to Unknown Company. */
export const preserveCompanyOnRetriage = (
  previous: ExtractedJobData,
  fresh: ExtractedJobData,
): ExtractedJobData => {
  const hint = companyHintFromExtracted(previous);
  if (!hint) return fresh;

  const freshLabel =
    fresh.companyDisplayName?.trim() || fresh.listingCompanyName?.trim() || fresh.company?.trim();
  const freshDegraded = isUnknownCompany(freshLabel);

  if (!freshDegraded) return fresh;

  return applyCompanyPresentation(
    {
      ...fresh,
      company: previous.listingCompanyName?.trim() || previous.company?.trim() || hint,
      listingCompanyName: previous.listingCompanyName?.trim() || previous.company?.trim() || hint,
      employerCompanyName: previous.employerCompanyName ?? fresh.employerCompanyName,
      agencyCompanyName: previous.agencyCompanyName ?? fresh.agencyCompanyName,
    },
    hint,
  );
};
