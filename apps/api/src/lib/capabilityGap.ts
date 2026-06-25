import {
  CAPABILITY_MAXES,
  LEGACY_CAPABILITY_SOURCE_MAXES,
} from "../config/capabilitySurvivabilityPolicy.js";
import type { ExtractedJobData } from "../types/job.js";
import type {
  CapabilityBreakdown,
  CapabilityGap,
  ScoreBreakdown,
  SpecializationGap,
  SpecializationGapSeverity,
} from "../types/scoring.js";
import { normalizeText } from "./text.js";

export const CAPABILITY_GAP_THRESHOLDS = {
  functionalOverlap: 20,
  stackFit: 18,
} as const;

const FUNCTIONAL_DISCOUNT_BY_SEVERITY: Record<SpecializationGapSeverity, number> = {
  high: 0.45,
  medium: 0.6,
  low: 0.75,
};

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

const requiredBlob = (job: ExtractedJobData): string =>
  normalizeText(
    [
      ...(job.requiredSkills ?? []),
      ...(job.requirements ?? []),
      ...(job.stack ?? []),
    ].join("\n"),
  );

const DESIGN_JD_SIGNALS =
  /\b(figma|design\s+system|visual\s+design|ui\/ux|ux\s+design|design\s+portfolio|wireframe|prototyp|pixel[-\s]?perfect|interaction\s+design)\b/i;

const DESIGN_TITLE_RE =
  /\b(web\s+)?design\s+engineer\b|\bproduct\s+design\s+engineer\b|\bui\s+engineer\b/i;

const DESIGN_RESUME_EVIDENCE =
  /\b(figma|sketch|adobe\s*xd|design\s+system|ui\/ux|ux\s+design|wireframe|prototyp|visual\s+design|design\s+portfolio|interaction\s+design)\b/i;

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

const titleNamesIam = (job: ExtractedJobData): boolean =>
  /\b(identity|iam|sso|saml|oauth|oidc)\b/i.test(job.title ?? "");

const titleNamesDesign = (job: ExtractedJobData): boolean =>
  DESIGN_TITLE_RE.test(job.title ?? "");

const countDesignSignals = (blob: string): number => {
  const patterns = [
    /\bfigma\b/i,
    /\bdesign\s+system\b/i,
    /\bvisual\s+design\b/i,
    /\bui\/ux\b|\bux\s+design\b/i,
    /\bdesign\s+portfolio\b/i,
    /\bwireframe\b/i,
    /\bprototyp/i,
    /\bpixel[-\s]?perfect\b/i,
  ];
  return patterns.filter((re) => re.test(blob)).length;
};

const resolveSeverity = (params: {
  inTitle: boolean;
  inRequired: boolean;
  signalCount: number;
}): SpecializationGapSeverity => {
  if (params.inTitle && params.inRequired && params.signalCount >= 2) return "high";
  if (params.inTitle || (params.inRequired && params.signalCount >= 2)) return "high";
  if (params.inRequired || params.signalCount >= 2) return "medium";
  return "low";
};

export const detectDesignFigmaSpecializationGap = (
  job: ExtractedJobData,
  resumeText?: string,
): SpecializationGap | undefined => {
  const blob = structuredBlob(job);
  const required = requiredBlob(job);
  const inTitle = titleNamesDesign(job);
  const inRequired = DESIGN_JD_SIGNALS.test(required);
  const signalCount = countDesignSignals(blob);

  if (!inTitle && !inRequired && signalCount < 2) return undefined;

  const resume = normalizeText(resumeText ?? "");
  if (DESIGN_RESUME_EVIDENCE.test(resume)) return undefined;

  const severity = resolveSeverity({ inTitle, inRequired, signalCount });
  return {
    name: "design/Figma",
    evidence: inTitle
      ? "Design/Figma pillar named in title and required qualifications"
      : "Figma and design-craft requirements in JD; no design portfolio evidence on resume",
    severity,
    lever: "portfolio",
  };
};

export const detectEnterpriseIamSpecializationGap = (
  job: ExtractedJobData,
  rawScore: ScoreBreakdown,
): SpecializationGap | undefined => {
  if (!detectEnterpriseIamSpecialization(job)) return undefined;

  const inTitle = titleNamesIam(job);
  const inRequired = /\b(saml|oauth|oidc|ldap|iam|sso)\b/i.test(requiredBlob(job));
  const signalCount = [
    /\bsaml\b/i.test(structuredBlob(job)),
    /\boauth\b/i.test(structuredBlob(job)),
    /\boidc\b/i.test(structuredBlob(job)),
    /\bldap\b/i.test(structuredBlob(job)),
  ].filter(Boolean).length;

  const functionalScaled = scaleAxis(
    rawScore.functionalOverlap,
    LEGACY_CAPABILITY_SOURCE_MAXES.functionalOverlap,
    CAPABILITY_MAXES.functionalOverlap,
  );

  const titleGrounded = inTitle || inRequired;
  const moderateOverlap = functionalScaled < CAPABILITY_GAP_THRESHOLDS.functionalOverlap;

  if (!titleGrounded && !moderateOverlap) return undefined;

  const severity = resolveSeverity({
    inTitle,
    inRequired,
    signalCount: Math.max(signalCount, detectEnterpriseIamSpecialization(job) ? 3 : 0),
  });

  return {
    name: "enterprise IAM / SAML-OIDC",
    evidence: titleGrounded
      ? "IAM/SAML-OIDC specialization central in title or required section"
      : "Enterprise IAM integration depth beyond OAuth-only resume evidence",
    severity,
    lever: "none",
  };
};

export const detectSpecializationGap = (
  job: ExtractedJobData,
  rawScore: ScoreBreakdown,
  resumeText?: string,
): SpecializationGap | undefined =>
  detectDesignFigmaSpecializationGap(job, resumeText) ??
  detectEnterpriseIamSpecializationGap(job, rawScore);

/** Apply material functional-overlap discount when a load-bearing pillar is missing. */
export const applySpecializationGapToBreakdown = (
  breakdown: CapabilityBreakdown,
  gap: SpecializationGap | undefined,
): CapabilityBreakdown => {
  if (!gap) return breakdown;
  const factor = FUNCTIONAL_DISCOUNT_BY_SEVERITY[gap.severity];
  return {
    ...breakdown,
    functionalOverlap: Math.max(0, Math.round(breakdown.functionalOverlap * factor)),
  };
};

/** Legacy bridge — prefer rules.specializationGap for new code. */
export const detectCapabilityGap = (
  job: ExtractedJobData,
  rawScore: ScoreBreakdown,
  resumeText?: string,
): CapabilityGap | undefined => {
  const gap = detectSpecializationGap(job, rawScore, resumeText);
  if (!gap) return undefined;
  return { kind: "specialization", reason: gap.name };
};

export const specializationGapIsNonAddressable = (gap: SpecializationGap | undefined): boolean =>
  Boolean(gap && (gap.lever === "none" || gap.lever === "portfolio" || gap.lever === "upskill"));
