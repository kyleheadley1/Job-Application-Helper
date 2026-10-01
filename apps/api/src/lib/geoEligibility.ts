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
  /\b(must|required to)\s+(?:currently\s+)?(?:be\s+)?(?:based|located|residing|living|reside|live)\s+in\s+([^.\n;]+)/i;
const EXPLICIT_LOCATED_IN_RE =
  /\b(?:candidates?\s+)?(?:must|need to)\s+(?:be\s+)?(?:located|based)\s+in\s+([^.\n;]+)/i;
const GLOBAL_REMOTE_ALT_RE =
  /\b(work from anywhere|global remote|anywhere in the world|worldwide remote|open to candidates globally)\b/i;

/** Present-tense residency radius — binary eligibility, not soft preference. */
const MUST_RESIDE_WITHIN_MILES_RE =
  /\b(?:(?:the\s+)?candidate\s+)?(?:must|required\s+to)\s+(?:currently\s+)?(?:reside|live|be\s+living|be\s+residing)\s+within\s+(\d+)\s+miles?\s+of\s+([^.\n]+)/i;

const MUST_CURRENTLY_LIVE_WITHIN_RE =
  /\b(?:must|required\s+to)\s+currently\s+(?:live|reside)\s+(?:within\s+(\d+)\s+miles?\s+of|in)\s+([^.\n]+)/i;

/** Softens a residency hard gate when the JD explicitly supports relocating. */
const RELOCATION_SOFTENER_RE =
  /\b(relocation\s+assistance|relocation\s+package|relocation\s+support|relocation\s+bonus|relocation\s+(?:available|provided|offered|included)|open\s+to\s+relocat|willing\s+to\s+relocat|will\s+relocate|committed\s+to\s+relocat)\b/i;

/** Known metros for radius/hub matching (candidate vs required hubs). */
const METRO_CATALOG: Array<{ id: string; label: string; patterns: RegExp[] }> = [
  {
    id: "nyc",
    label: "New York City metro",
    patterns: [
      /\b(nyc|new\s+york(\s+city)?|brooklyn|manhattan|queens|bronx|staten\s+island|jersey\s+city|hoboken|newark)\b/i,
    ],
  },
  {
    id: "boston",
    label: "Boston, MA",
    patterns: [/\bboston\b/i, /\bcambridge,?\s*ma\b/i],
  },
  {
    id: "portland_me",
    label: "Portland, ME",
    patterns: [/\bportland,?\s*me\b/i, /\bportland,?\s*maine\b/i],
  },
  {
    id: "portland_or",
    label: "Portland, OR",
    patterns: [/\bportland,?\s*or\b/i, /\bportland,?\s*oregon\b/i],
  },
  {
    id: "chicago",
    label: "Chicago, IL",
    patterns: [/\bchicago\b/i],
  },
  {
    id: "dallas",
    label: "Dallas, TX",
    patterns: [/\bdallas\b/i],
  },
  {
    id: "sf_bay",
    label: "San Francisco Bay Area",
    patterns: [
      /\bsan\s+francisco\b/i,
      /\bbay\s+area\b/i,
      /\bsf\b/i,
      /\bsilicon\s+valley\b/i,
      /\bsan\s+jose\b/i,
      /\boakland\b/i,
    ],
  },
  {
    id: "seattle",
    label: "Seattle, WA",
    patterns: [/\bseattle\b/i, /\bbellevue\b/i, /\bredmond\b/i],
  },
  {
    id: "austin",
    label: "Austin, TX",
    patterns: [/\baustin\b/i],
  },
  {
    id: "denver",
    label: "Denver, CO",
    patterns: [/\bdenver\b/i, /\bboulder\b/i],
  },
  {
    id: "atlanta",
    label: "Atlanta, GA",
    patterns: [/\batlanta\b/i],
  },
  {
    id: "los_angeles",
    label: "Los Angeles, CA",
    patterns: [/\blos\s+angeles\b/i, /\bLA\b/, /\bsanta\s+monica\b/i],
  },
];

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

const metrosInText = (text: string): string[] => {
  const ids: string[] = [];
  for (const metro of METRO_CATALOG) {
    if (metro.patterns.some((re) => re.test(text)) && !ids.includes(metro.id)) {
      ids.push(metro.id);
    }
  }
  return ids;
};

const candidateMetroIds = (candidate: CandidateLocation, profile: UserProfile): string[] => {
  const blob = [
    candidate.label,
    ...(candidate.regions ?? []),
    ...(profile.locationPreferences?.primary ?? []),
    ...(profile.locationPreferences?.acceptable ?? []),
  ].join(" ");
  return metrosInText(blob);
};

const jobTextBlob = (job: ExtractedJobData): string =>
  [
    job.rawText ?? "",
    ...(job.requirements ?? []),
    ...(job.responsibilities ?? []),
  ].join("\n");

export type ResidencyRadiusRequirement = {
  miles: number;
  hubsText: string;
  hubMetroIds: string[];
  hubLabels: string[];
};

/** Parse "must reside within N miles of A; B; or C" present-tense residency bars. */
export const extractResidencyRadiusRequirement = (
  job: ExtractedJobData,
): ResidencyRadiusRequirement | null => {
  const blob = jobTextBlob(job);
  const match =
    blob.match(MUST_RESIDE_WITHIN_MILES_RE) ?? blob.match(MUST_CURRENTLY_LIVE_WITHIN_RE);
  if (!match) return null;

  const miles = Number(match[1] ?? "0");
  const hubsText = (match[2] ?? "").trim();
  if (!hubsText) return null;

  // Prefer state-qualified Portland ME / OR when listed that way.
  const hubMetroIds = metrosInText(hubsText);
  const hubLabels = hubMetroIds
    .map((id) => METRO_CATALOG.find((m) => m.id === id)?.label)
    .filter((x): x is string => Boolean(x));

  if (hubMetroIds.length === 0) {
    // Fallback: keep raw hub list for the gate message even if metros are unknown.
    return {
      miles: Number.isFinite(miles) && miles > 0 ? miles : 30,
      hubsText: hubsText.replace(/\s+/g, " ").slice(0, 240),
      hubMetroIds: [],
      hubLabels: [],
    };
  }

  return {
    miles: Number.isFinite(miles) && miles > 0 ? miles : 30,
    hubsText: hubsText.replace(/\s+/g, " ").slice(0, 240),
    hubMetroIds,
    hubLabels,
  };
};

export const jdOffersRelocationSupport = (job: ExtractedJobData): boolean => {
  if (job.relocationRequired === true) return true;
  const blob = normalizeText(jobTextBlob(job));
  return RELOCATION_SOFTENER_RE.test(blob);
};

/**
 * Present-tense residency / radius requirements without relocation support are hard gates —
 * same category as citizenship/clearance (binary eligibility), not soft Key Risks.
 */
export const evaluateResidencyRadiusHardGate = (
  job: ExtractedJobData,
  profile: UserProfile,
  candidate: CandidateLocation,
): GeoEligibilityResult | null => {
  const req = extractResidencyRadiusRequirement(job);
  if (!req) return null;

  // Relocation assistance / "open to relocating" → soft verify, not auto-disqualify.
  if (jdOffersRelocationSupport(job)) {
    return {
      geoExclusionHardGate: false,
      eligibilityFlag: {
        reason: `Location constraint: must reside within ${req.miles} miles of listed hubs, but JD mentions relocation — confirm eligibility before applying (${candidate.label}).`,
        evidence: `residencyRadius=${req.miles}; hubs=${req.hubsText}; candidate=${candidate.label}; relocationSoftener=true`,
        lever: "verify",
        severity: "check",
      },
    };
  }

  const candidateMetros = candidateMetroIds(candidate, profile);
  const overlap =
    req.hubMetroIds.length === 0
      ? false
      : req.hubMetroIds.some((id) => candidateMetros.includes(id));

  if (overlap) {
    return { geoExclusionHardGate: false };
  }

  const hubs =
    req.hubLabels.length > 0 ? req.hubLabels.join("; ") : req.hubsText;
  return {
    geoExclusionHardGate: true,
    geoExclusionReason: `Must reside within ${req.miles} miles of ${hubs} — candidate is based in ${candidate.label}; no relocation assistance stated.`,
  };
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

  // 1) Present-tense residency radius (Wex-style) — hard gate when unmet and no relocation softener.
  const residencyGate = evaluateResidencyRadiusHardGate(job, profile, candidate);
  if (residencyGate) {
    if (residencyGate.geoExclusionHardGate || residencyGate.eligibilityFlag) {
      return residencyGate;
    }
  }

  // 2) Explicit "must be based/located in REGION" (LatAm-style).
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
