import type { ExtractedJobData } from "../types/job.js";
import type { ClaimableStack } from "./claimableStack.js";
import { hasClaimableCoverage } from "./claimableStack.js";
import { normalizeText } from "./text.js";

/** Survivability dock when JD requires production-scale infra ownership the profile lacks. */
export const PRODUCTION_INFRA_OWNERSHIP_SURV_PENALTY = 0.1;
export const PRODUCTION_INFRA_OWNERSHIP_LEVEL_FIT_DOCK = 3;

const JD_INFRA_OWNERSHIP_RE =
  /\b(production[-\s]?scale|observability|on[-\s]?call|distributed\s+systems?|slo(?:s)?|infrastructure|terraform|kubernetes|\bk8s\b|reliability|incident\s+response)\b/i;

/** Real ownership signals — not curriculum name-drops of Terraform/K8s. */
const CANDIDATE_STRONG_OWNERSHIP_RE =
  /\b(on[-\s]?call|observability|slo(?:s)?|prometheus|datadog|pagerduty|incident\s+response|site\s+reliability|\bsre\b|production[-\s]?scale)\b/i;

const experienceSectionOnly = (resumeText: string): string => {
  const text = resumeText.replace(/\r/g, "\n");
  const expStart = text.search(/\bexperience\b/i);
  const eduStart = text.search(/\beducation\b/i);
  if (expStart < 0) return text;
  return text.slice(expStart, eduStart > expStart ? eduStart : text.length);
};

export type ProductionInfraOwnershipGap = {
  active: boolean;
  /** Canonical Key Risk / survivability penalty line. */
  riskNote?: string;
  survivabilityDock: number;
  levelFitDock: number;
};

/**
 * Required/core production-infra ownership (scale, observability, on-call, distributed systems)
 * without matching candidate evidence — drives Key Risk + survivability/Level-fit docks together.
 */
export const detectProductionInfraOwnershipGap = (params: {
  job: ExtractedJobData;
  resumeText?: string;
  claimable?: ClaimableStack;
}): ProductionInfraOwnershipGap => {
  const { job, resumeText = "", claimable } = params;
  const jdBlob = normalizeText(
    [
      job.title,
      ...(job.stack ?? []),
      ...(job.requiredSkills ?? []),
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
      job.rawText ?? "",
    ].join("\n"),
  );

  const requiredOrStackBlob = normalizeText(
    [
      ...(job.stack ?? []),
      ...(job.requiredSkills ?? []),
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
    ].join("\n"),
  );

  const evidenceBlob = requiredOrStackBlob.trim() ? requiredOrStackBlob : jdBlob;
  if (!JD_INFRA_OWNERSHIP_RE.test(evidenceBlob)) {
    return { active: false, survivabilityDock: 0, levelFitDock: 0 };
  }

  // JD must ask for ownership-shaped work (on-call / observability / production-scale),
  // not merely list Terraform as a stack chip.
  const ownershipAsk =
    /\b(on[-\s]?call|observability|slo(?:s)?|production[-\s]?scale|incident)\b/i.test(evidenceBlob);
  if (!ownershipAsk) {
    return { active: false, survivabilityDock: 0, levelFitDock: 0 };
  }

  const experienceBlob = normalizeText(experienceSectionOnly(resumeText));
  if (CANDIDATE_STRONG_OWNERSHIP_RE.test(experienceBlob)) {
    return { active: false, survivabilityDock: 0, levelFitDock: 0 };
  }

  const hasClaimableInfra =
    Boolean(claimable) &&
    (hasClaimableCoverage(claimable!, "aws") ||
      hasClaimableCoverage(claimable!, "docker") ||
      hasClaimableCoverage(claimable!, "github_actions"));

  const infraHits = (evidenceBlob.match(
    /\b(production[-\s]?scale|observability|on[-\s]?call|distributed\s+systems?|terraform|kubernetes|\bslo\b)\b/gi,
  ) ?? []).length;
  // Thin JD + related devops claimable → no dock (avoid false positives on soft infra mentions).
  if (infraHits <= 1 && hasClaimableInfra) {
    return { active: false, survivabilityDock: 0, levelFitDock: 0 };
  }

  const teamBit = /\bscaling\b/i.test(job.title ?? "")
    ? "the Scaling team's expectations"
    : "this listing's production-infrastructure expectations";

  return {
    active: true,
    riskNote: `Limited hands-on production-scale infrastructure, observability, and on-call ownership compared with ${teamBit}.`,
    survivabilityDock: PRODUCTION_INFRA_OWNERSHIP_SURV_PENALTY,
    levelFitDock: PRODUCTION_INFRA_OWNERSHIP_LEVEL_FIT_DOCK,
  };
};

/**
 * True when a Key Risk / note names a concrete missing skill or experience category
 * (not generic recruiter fluff). Used to keep Survivability Penalties in sync with Key Risks.
 */
export const textIsNamedCapabilityGapRisk = (text: string): boolean => {
  const t = text.trim();
  if (!t || t.length < 24) return false;
  if (/^degree[-\s]?positive|^employer restricts|^vague or thin jd/i.test(t)) return false;
  if (/title\/responsibility mismatch/i.test(t)) return true;
  if (/experience bar is restated/i.test(t)) return true;
  if (/high ownership,\s*low support/i.test(t)) return true;
  if (/JD requires named tool\/platform/i.test(t)) return true;
  if (/required core (?:language|stack) gap/i.test(t)) return true;
  if (/limited hands-on production-scale/i.test(t)) return true;
  if (
    /\b(limited|lacks?|missing|no demonstrated|without|absent|gap|stretch)\b/i.test(t) &&
    /\b(experience|ownership|background|proficiency|hands[-\s]?on|infrastructure|observability|on[-\s]?call|kubernetes|terraform|rust|redis|distributed)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
};
