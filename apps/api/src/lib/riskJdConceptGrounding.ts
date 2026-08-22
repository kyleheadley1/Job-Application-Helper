import type { ExtractedJobData } from "../types/job.js";
import { normalizeText } from "./text.js";

/** JD evidence for grounding risk prose — title + requirement bullets, not scraped chrome alone. */
export const jdEvidenceBlobForRiskGrounding = (job: ExtractedJobData): string =>
  normalizeText(
    [
      job.title,
      job.seniority,
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
      ...(job.requiredSkills ?? []),
      job.rawText ?? "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

/**
 * Role/lane jargon in risk bullets must be traceable to this JD — blocks FDE/SIE/GTM bleed
 * from rules tuned for other posting shapes.
 */
const RISK_CONCEPT_REQUIRES_JD: Array<{ riskPattern: RegExp; jdPattern: RegExp }> = [
  { riskPattern: /\bforward[-\s]?deployed\b/i, jdPattern: /\bforward[-\s]?deployed\b/i },
  {
    riskPattern: /\bgrowth[-\s]?engineering\s+title\b/i,
    jdPattern: /\b(growth[-\s]?engineer|forward[-\s]?deployed)\b/i,
  },
  { riskPattern: /\bsolutions[-\s]?consulting\b/i, jdPattern: /\b(solutions[-\s]?consulting|solutions\s+engineer)\b/i },
  { riskPattern: /\bSIE\b/, jdPattern: /\bSIE\b/ },
  { riskPattern: /\bGTM\b/i, jdPattern: /\bGTM\b/i },
  {
    riskPattern: /\bcustomer[-\s]?implementation\s+core\b/i,
    jdPattern: /\bcustomer[-\s]?facing\s+implementation\b/i,
  },
];

/** True when the risk line cites a role/lane concept absent from this job's JD text. */
export const riskLineReferencesAbsentJdConcepts = (
  line: string,
  job: ExtractedJobData,
): boolean => {
  const t = line.trim();
  if (!t) return false;
  const jd = jdEvidenceBlobForRiskGrounding(job);
  return RISK_CONCEPT_REQUIRES_JD.some(
    ({ riskPattern, jdPattern }) => riskPattern.test(t) && !jdPattern.test(jd),
  );
};

/** Drop known cross-job risk boilerplate when concepts are absent from the JD. */
export const filterAbsentJdConceptRiskLines = (
  lines: string[],
  job: ExtractedJobData,
): string[] => lines.filter((line) => !riskLineReferencesAbsentJdConcepts(line, job));
