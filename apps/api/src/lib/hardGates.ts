import type { ExtractedJobData } from "../types/job.js";
import type { RuleEvaluation } from "../types/scoring.js";

export type HardGateResult = {
  fired: boolean;
  reasons: string[];
};

/** Section 1 — hard gates evaluated before capability/survivability. */
export const evaluateHardGates = (
  rules: RuleEvaluation,
  extracted: ExtractedJobData,
): HardGateResult => {
  const reasons: string[] = [];

  if (rules.visaMismatch) reasons.push("Visa/sponsorship requirement blocks first-pass progression.");
  if (rules.citizenshipMismatch) reasons.push("Citizenship requirement is a hard gate.");
  if (rules.clearanceMismatch) reasons.push("Security clearance requirement is a hard gate.");

  const notRemoteCommutable =
    rules.locationMismatch &&
    extracted.remoteType !== "remote" &&
    extracted.locationIsCommutable !== true;
  if (notRemoteCommutable) {
    reasons.push("Onsite/hybrid location is not commutable for this profile.");
  }

  if (rules.explicitCoreLanguageMismatch) {
    reasons.push("JD hard-requires a core backend language absent from the resume.");
  }

  if (rules.seniorityOverreach) {
    reasons.push("Role seniority/staff bar exceeds early-career profile.");
  }

  if (rules.geoExclusionHardGate) {
    reasons.push(
      rules.geoExclusionReason ??
        "Explicit geographic location requirement excludes this candidate.",
    );
  }

  return { fired: reasons.length > 0, reasons };
};
