import {
  CAPABILITY_MAXES,
  LEGACY_CAPABILITY_SOURCE_MAXES,
} from "../config/capabilitySurvivabilityPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import type { CapabilityGap, ScoreBreakdown } from "../types/scoring.js";
import { normalizeText } from "./text.js";

export const CAPABILITY_GAP_THRESHOLDS = {
  functionalOverlap: 20,
  stackFit: 18,
} as const;

const scaleAxis = (raw: number, legacyMax: number, capabilityMax: number): number =>
  Math.round((raw / legacyMax) * capabilityMax);

const structuredBlob = (job: ExtractedJobData): string =>
  normalizeText(
    [
      job.title,
      ...(job.stack ?? []),
      ...(job.requiredSkills ?? []),
      ...(job.preferredSkills ?? []),
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
      job.rawText ?? "",
    ].join("\n"),
  );

export const detectEnterpriseIamSpecialization = (job: ExtractedJobData): boolean => {
  const blob = structuredBlob(job);
  const signals = [
    /\bsaml\b/i.test(blob),
    /\boidc\b|\bopenid connect\b/i.test(blob),
    /\boauth\b/i.test(blob),
    /\bldap\b/i.test(blob),
    /\bactive directory\b/i.test(blob),
    /\bidentity (and access )?management\b|\biam\b/i.test(blob),
    /\bsingle sign[-\s]?on\b|\bsso\b/i.test(blob),
  ].filter(Boolean).length;
  return signals >= 3;
};

export const detectCapabilityGap = (
  job: ExtractedJobData,
  rawScore: ScoreBreakdown,
): CapabilityGap | undefined => {
  const functionalScaled = scaleAxis(
    rawScore.functionalOverlap,
    LEGACY_CAPABILITY_SOURCE_MAXES.functionalOverlap,
    CAPABILITY_MAXES.functionalOverlap,
  );
  const stackScaled = scaleAxis(
    rawScore.stackFit,
    LEGACY_CAPABILITY_SOURCE_MAXES.stackFit,
    CAPABILITY_MAXES.stackFit,
  );

  if (
    detectEnterpriseIamSpecialization(job) &&
    functionalScaled < CAPABILITY_GAP_THRESHOLDS.functionalOverlap
  ) {
    return {
      kind: "specialization",
      reason: "enterprise IAM / SAML-OIDC specialization",
    };
  }

  if (stackScaled < CAPABILITY_GAP_THRESHOLDS.stackFit && detectEnterpriseIamSpecialization(job)) {
    return {
      kind: "stack_depth",
      reason: "enterprise IAM / SAML-OIDC specialization",
    };
  }

  return undefined;
};
