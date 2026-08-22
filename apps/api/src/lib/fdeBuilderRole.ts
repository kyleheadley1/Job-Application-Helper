import type { ExtractedJobData } from "../types/job.js";
import { structuredFirstJobBlob } from "./structuredFirstJobBlob.js";
import { normalizeText } from "./text.js";

/** High-confidence solutions / external customer delivery phrases (SIE-primary territory). */
export const STRONG_SIE_DESCRIPTOR_RES: RegExp[] = [
  /\bsolutions\s+engineer\b/i,
  /\bsales\s+engineer\b/i,
  /\bcustomer[-\s]?facing\s+implementation\b/i,
  /\bcustomer[-\s]?facing\s+delivery\b/i,
  /\bcustomer\s+deployment\b/i,
  /\bpost[-\s]?sales\b/i,
  /\bpre[-\s]?sales\b/i,
  /\bpartner\s+engineering\b/i,
  /\bcustomer\s+onboarding\b/i,
  /\bonboarding\s+customers\b/i,
  /\btechnical\s+consulting\b/i,
  /\bimplementation\s+consultant\b/i,
  /\bprofessional\s+services\b/i,
  /\bexternal\s+clients?\b/i,
  /\bintegrations?\s+with\s+enterprise\b/i,
  /\benterprise\s+customer.{0,60}\b(implementation|integration|deployment|onboarding)\b/i,
  /\bdeployments?\s+at\s+customer\b/i,
  /\bdeploy(?:ment)?s?\s+to\s+customer\b/i,
  /\bdelivery\s+timelines\b/i,
  /\bintegration\s+timelines\b/i,
  /\bsolution\s+design\b/i,
  /\btechnical\s+onboarding\s+workshops?\b/i,
];

/** Text blob for FDE / growth-engineer heuristics (title + JD body). */
export const jobBlobForFdeHeuristics = (job: ExtractedJobData): string =>
  structuredFirstJobBlob(job);

/** Naming suggests Forward Deployed or growth engineering in the role title — not generic "growth engineering" work in body copy. */
export const hasFdeOrGrowthEngineerNaming = (job: ExtractedJobData): boolean => {
  const titleBlob = normalizeText([job.title, job.seniority].filter(Boolean).join(" "));
  if (!titleBlob) return false;
  return (
    /\bforward\s+deployed\s+engineer\b/i.test(titleBlob) ||
    /\bforward\s+deployed\b/i.test(titleBlob) ||
    /\bgrowth\s+engineer\b/i.test(titleBlob) ||
    /\bgrowth[-\s]engineering\s+(?:engineer|lead|manager|role)\b/i.test(titleBlob)
  );
};

/**
 * External customer / solutions-delivery core (SIE-primary territory).
 * Kept separate from generic "implementation" or "integrations" that appear on internal product roles.
 */
export const hasStrongExternalCustomerDeliverySignals = (blob: string): boolean =>
  STRONG_SIE_DESCRIPTOR_RES.some((re) => {
    re.lastIndex = 0;
    return re.test(blob);
  });

const BUILDER_FIRST_CONTEXT = [
  "internal tooling",
  "internal tools",
  "internal tool",
  "growth systems",
  "automation",
  "full-stack",
  "full stack",
  "backend",
  "product engineer",
  "ai workflow",
  "software engineer",
  "typescript",
  "node.js",
  "react",
  "founding team",
  "0 to 1",
  "0-1",
];

export const hasBuilderFirstSoftwareContext = (blob: string): boolean =>
  BUILDER_FIRST_CONTEXT.some((s) => blob.includes(s));

/**
 * Forward-deployed / growth title without a strong external customer-implementation core:
 * default to SWE-style builder narrative; SIE only as a secondary angle.
 */
export const isFdeBuilderSoftwarePrimaryShape = (job: ExtractedJobData): boolean => {
  const blob = jobBlobForFdeHeuristics(job);
  if (!hasFdeOrGrowthEngineerNaming(job)) return false;
  if (hasStrongExternalCustomerDeliverySignals(blob)) return false;
  return true;
};

/** Count high-confidence SIE-shaped phrases (used by deterministic resume selection). */
export const countStrongSieRoleDescriptorHits = (blob: string): number => {
  let n = 0;
  for (const re of STRONG_SIE_DESCRIPTOR_RES) {
    re.lastIndex = 0;
    if (re.test(blob)) n += 1;
  }
  return n;
};

export const fdeSweAlternateSieNote =
  "SIE can be used as an alternate resume if you want to emphasize stakeholder workflow translation, sales/ops collaboration, and implementation-style delivery — keep SWE as the primary screen story unless the JD is clearly external customer implementation.";

/** Canonical recruiter-realism line for polish / risk ordering (avoid duplicate phrasing in tests). */
export const fdeBuilderPrimaryRiskSummary =
  "Forward-deployed or growth-engineering title without a strong external customer-implementation core: strong builder and applied-AI overlap, but limited explicit GTM/sales-ops resume lane versus a solutions-consulting screen — not a near-perfect fit for 90+ scoring.";
