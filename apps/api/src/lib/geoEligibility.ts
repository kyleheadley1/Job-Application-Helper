import type { ExtractedJobData } from "../types/job.js";
import type { EligibilityFlag } from "../types/scoring.js";
import type { UserProfile } from "../types/userProfile.js";
import { normalizeText } from "./text.js";
import {
  normalizeRegionLabel,
  regionKeysConflict,
  resolveGeoScope,
  type GeoScope,
} from "./geoScope.js";

export type CandidateLocation = {
  label: string;
  basedInUS: boolean;
  regions: string[];
};

export type GeoEligibilityResult = {
  eligibilityFlag?: EligibilityFlag;
  geoExclusionHardGate: boolean;
  geoExclusionReason?: string;
};

const EXPLICIT_MUST_BE_IN_RE =
  /\b(must|required to)\s+be\s+(?:based|located|residing|living)\s+in\s+([^.\n;]+)/i;
const EXPLICIT_LOCATED_IN_RE =
  /\b(?:candidates?\s+)?(?:must|need to)\s+(?:be\s+)?(?:located|based)\s+in\s+([^.\n;]+)/i;
const GLOBAL_REMOTE_ALT_RE =
  /\b(work from anywhere|global remote|anywhere in the world|worldwide remote|open to candidates globally)\b/i;

export const deriveCandidateLocation = (profile: UserProfile): CandidateLocation => {
  if (profile.candidateLocation) {
    return {
      label: profile.candidateLocation.label,
      basedInUS: profile.candidateLocation.basedInUS ?? true,
      regions: profile.candidateLocation.regions ?? ["United States"],
    };
  }
  const primary = profile.locationPreferences.primary.join(", ");
  return {
    label: primary ? `${primary} / US-authorized` : "US-based",
    basedInUS: true,
    regions: ["United States", "US"],
  };
};

const candidateInRegion = (candidate: CandidateLocation, region: string): boolean => {
  const target = normalizeRegionLabel(region)?.toLowerCase() ?? region.toLowerCase();
  if (target === "latin america") {
    return candidate.regions.some((r) => /latin america/i.test(r));
  }
  if (target === "united states" || target === "us" || /\bunited states\b/i.test(target)) {
    return candidate.basedInUS || candidate.regions.some((r) => /united states|^us$/i.test(r));
  }
  return candidate.regions.some(
    (r) => r.toLowerCase() === target || target.includes(r.toLowerCase()),
  );
};

const extractExplicitRequiredRegion = (job: ExtractedJobData): string | null => {
  const blob = normalizeText(
    [
      job.rawText ?? "",
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
    ].join("\n"),
  );
  const mustMatch = blob.match(EXPLICIT_MUST_BE_IN_RE);
  if (mustMatch?.[2]) return normalizeRegionLabel(mustMatch[2].trim());
  const locatedMatch = blob.match(EXPLICIT_LOCATED_IN_RE);
  if (locatedMatch?.[1]) return normalizeRegionLabel(locatedMatch[1].trim());
  return null;
};

export const evaluateGeoEligibility = (
  job: ExtractedJobData,
  profile: UserProfile,
): GeoEligibilityResult => {
  const geoScope = job.geoScope ?? resolveGeoScope(job);
  const candidate = deriveCandidateLocation(profile);
  const combinedText = normalizeText([job.rawText ?? "", ...(job.requirements ?? [])].join("\n"));

  const explicitRegion = extractExplicitRequiredRegion(job);
  if (
    explicitRegion &&
    !GLOBAL_REMOTE_ALT_RE.test(combinedText) &&
    !candidateInRegion(candidate, explicitRegion)
  ) {
    return {
      geoExclusionHardGate: true,
      geoExclusionReason: `Must be based in ${explicitRegion} — no global-remote alternative stated.`,
    };
  }

  const titleRegion = geoScope.titleRegion;
  if (!titleRegion) {
    return { geoExclusionHardGate: false };
  }

  if (candidateInRegion(candidate, titleRegion)) {
    return { geoExclusionHardGate: false };
  }

  const cardLocation = geoScope.cardLocation;
  const cardRegion = cardLocation ? normalizeRegionLabel(cardLocation) : null;
  const titleVsCardConflict =
    cardRegion != null && regionKeysConflict(titleRegion, cardRegion);

  let reason: string;
  let evidence: string;
  if (titleVsCardConflict) {
    reason = `Title scopes to ${titleRegion} but the card lists ${cardLocation} — confirm this role is open to US-based applicants.`;
    evidence = `titleRegion=${titleRegion}; cardLocation=${cardLocation}; candidate=${candidate.label}`;
  } else {
    reason = `Title scopes to ${titleRegion} — confirm work location and eligibility before applying (${candidate.label}).`;
    evidence = `titleRegion=${titleRegion}; candidate=${candidate.label}`;
  }

  return {
    eligibilityFlag: {
      reason,
      evidence,
      lever: "verify",
      severity: "check",
    },
    geoExclusionHardGate: false,
  };
};

export const attachGeoScope = (job: ExtractedJobData): ExtractedJobData => ({
  ...job,
  geoScope: job.geoScope ?? resolveGeoScope(job),
});
