import { DIFFERENTIATOR_COVERAGE, POOL_FRIENDLINESS } from "../config/capabilitySurvivabilityPolicy.js";
import type { BindingnessTier } from "../config/capabilitySurvivabilityPolicy.js";
import { userProfile as defaultUserProfile } from "../config/userProfile.js";
import type { ExtractedJobData } from "../types/job.js";
import type { UserProfile } from "../types/userProfile.js";
import { countDifferentiatorTags } from "./differentiatorCoverage.js";
import { isLargeEmployerByHeadcount } from "./companyEmployeeCount.js";
import {
  resolveEmployerScale,
  scoreEmployerRecognizabilityFromScale,
} from "./employerScale.js";
import { FRESH_POST_RE } from "./poolCompetitiveness.js";
import { structuredFirstJobBlob } from "./structuredFirstJobBlob.js";
import { countTechCanonOverlap } from "./techCanon.js";
import { normalizeText } from "./text.js";

export type PoolFriendlinessAdjustment = {
  id: string;
  label: string;
  delta: number;
};

export type PoolFriendlinessResult = {
  score: number;
  adjustments: PoolFriendlinessAdjustment[];
  note: string;
  lever: "none" | "referral";
  leverLabel: string;
  bindingness: BindingnessTier;
};

const clampPool = (n: number): number =>
  Math.min(POOL_FRIENDLINESS.MAX, Math.max(POOL_FRIENDLINESS.MIN, n));

const COMPANY_BOILERPLATE_RE =
  /\b(linkedin|indeed|glassdoor|insider connection|reach out via|find any email|email credits|beyond your network)\b/gi;

/** Strip job-board referral noise from employer display name before recognizability. */
export const stripScraperBoilerplateFromCompany = (name: string): string =>
  normalizeText(name)
    .replace(COMPANY_BOILERPLATE_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

export const resolveEmployerDisplayName = (job: ExtractedJobData): string =>
  stripScraperBoilerplateFromCompany(
    job.companyDisplayName?.trim() || job.company?.trim() || "",
  );

const listingBlob = (job: ExtractedJobData): string => structuredFirstJobBlob(job);

const listingStackBlob = (job: ExtractedJobData): string =>
  normalizeText(
    [
      job.title ?? "",
      job.rawText ?? "",
      ...(job.stack ?? []),
      ...(job.requiredSkills ?? []),
      ...(job.preferredSkills ?? []),
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
    ].join("\n"),
  );

/**
 * How recognizable the listing employer is (0 = niche, 1 = household name).
 * Uses shared employer-scale (brand/niche lists + headcount floor) — never scraped rawText for brand match.
 */
export const scoreListingEmployerRecognizability = (job: ExtractedJobData): number => {
  const company = resolveEmployerDisplayName(job);
  if (!company || company === "unknown") {
    const scale = resolveEmployerScale(job, "");
    return scoreEmployerRecognizabilityFromScale({
      ...scale,
      isBrandName: false,
      isNicheName: false,
    });
  }
  return scoreEmployerRecognizabilityFromScale(resolveEmployerScale(job, company));
};

const candidateProfileBlob = (profile: UserProfile): string =>
  normalizeText(
    [
      ...profile.strengths,
      ...profile.flagshipProjects.flatMap((p) => p.tech),
      ...profile.recurringStory,
      ...(profile.certifications ?? []).flatMap((c) => [c.name, ...(c.relatedSkills ?? [])]),
    ].join(" "),
  );

const countCandidateStackOverlap = (job: ExtractedJobData, profile: UserProfile): number =>
  countTechCanonOverlap(listingStackBlob(job), candidateProfileBlob(profile));

const postedSalaryTop = (job: ExtractedJobData, blob: string): number => {
  const fromStruct = job.salary?.max ?? job.salary?.min ?? 0;
  if (fromStruct >= POOL_FRIENDLINESS.REAL_SALARY_MIN) return fromStruct;
  const range = blob.match(/\$\s*(\d{2,3})\s*k?\s*[–-]\s*\$\s*(\d{2,3})\s*k?/i);
  if (range) {
    const hi = Number(range[2]) * (range[2]!.length <= 3 ? 1000 : 1);
    if (hi >= POOL_FRIENDLINESS.REAL_SALARY_MIN) return hi;
  }
  const single = blob.match(/\$\s*(\d{2,3})\s*k\b/i);
  if (single) {
    const n = Number(single[1]) * 1000;
    if (n >= POOL_FRIENDLINESS.REAL_SALARY_MIN) return n;
  }
  return fromStruct;
};

const isRemoteListing = (job: ExtractedJobData, blob: string): boolean =>
  job.remoteType === "remote" ||
  /\b(remote|work from anywhere|fully remote|distributed team)\b/i.test(blob);

const isOnsiteOrHybridListing = (job: ExtractedJobData, blob: string): boolean =>
  job.remoteType === "hybrid" ||
  job.remoteType === "onsite" ||
  /\b(on[-\s]?site|hybrid|in[-\s]?office|days per week in office)\b/i.test(blob);

const isEntryLevelListing = (job: ExtractedJobData, blob: string): boolean =>
  job.seniority === "junior" ||
  job.seniority === "entry" ||
  /\b(entry[-\s]?level|junior|new grad|new graduate|early career|0-2 years|associate engineer)\b/i.test(
    blob,
  );

const isJuniorListing = (job: ExtractedJobData, blob: string): boolean =>
  isEntryLevelListing(job, blob) ||
  /\b(associate|0-2 years|1-2 years)\b/i.test(blob);

const isLowBarrierListing = (job: ExtractedJobData, blob: string): boolean => {
  if (countDifferentiatorTags(blob).count >= 1) return false;
  const genericStack =
    /\b(react|typescript|javascript)\b/i.test(blob) &&
    !/\b(kubernetes|distributed systems|staff|principal|5\+ years|phd|clearance required)\b/i.test(
      blob,
    );
  const thinRequirements = (job.requirements?.length ?? 0) <= 6;
  return genericStack && thinRequirements;
};

const formatAdjustmentNote = (adjustments: PoolFriendlinessAdjustment[], score: number): string => {
  if (!adjustments.length) {
    return `Pool shape: neutral base (${POOL_FRIENDLINESS.NEUTRAL_BASE.toFixed(2)}) → ${score.toFixed(2)}`;
  }
  const parts = adjustments.map((a) => `${a.label} (${a.delta >= 0 ? "+" : ""}${a.delta.toFixed(2)})`);
  const tone =
    score >= POOL_FRIENDLINESS.FAVORABLE_MIN
      ? "favorable"
      : score < POOL_FRIENDLINESS.CROWDED_MAX
        ? "crowded"
        : "neutral";
  return `Pool shape: ${parts.join(", ")} → ${tone}`;
};

const resolvePoolLever = (score: number): Pick<
  PoolFriendlinessResult,
  "lever" | "leverLabel" | "bindingness"
> => {
  if (score >= POOL_FRIENDLINESS.FAVORABLE_MIN) {
    return {
      lever: "none",
      leverLabel: POOL_FRIENDLINESS.LEVER_LABELS.favorable,
      bindingness: "favorable",
    };
  }
  if (score < POOL_FRIENDLINESS.CROWDED_MAX) {
    return {
      lever: "referral",
      leverLabel: POOL_FRIENDLINESS.LEVER_LABELS.crowded,
      bindingness: "structural",
    };
  }
  return {
    lever: "none",
    leverLabel: POOL_FRIENDLINESS.LEVER_LABELS.neutral,
    bindingness: "structural",
  };
};

export const computePoolFriendliness = (
  job: ExtractedJobData,
  profile: UserProfile = defaultUserProfile,
): PoolFriendlinessResult => {
  const blob = listingBlob(job);
  const adjustments: PoolFriendlinessAdjustment[] = [];
  let pool = POOL_FRIENDLINESS.NEUTRAL_BASE;

  const employerRec = scoreListingEmployerRecognizability(job);
  const remote = isRemoteListing(job, blob);
  const entryLevel = isEntryLevelListing(job, blob);
  const cattleCall = remote && entryLevel && isLowBarrierListing(job, blob);
  const largeEmployer = isLargeEmployerByHeadcount(job);

  // Large employers (10k+) never get the niche-employer bonus, regardless of name heuristic.
  if (
    employerRec < POOL_FRIENDLINESS.NICHE_EMPLOYER_MAX &&
    !cattleCall &&
    !largeEmployer
  ) {
    adjustments.push({
      id: "nicheEmployer",
      label: "niche employer",
      delta: POOL_FRIENDLINESS.NICHE_EMPLOYER_BONUS,
    });
  }
  if (employerRec > POOL_FRIENDLINESS.BRAND_EMPLOYER_MIN || largeEmployer) {
    adjustments.push({
      id: "brandEmployer",
      label: largeEmployer ? "large employer (headcount)" : "recognizable employer",
      delta: POOL_FRIENDLINESS.BRAND_EMPLOYER_PENALTY,
    });
  }

  const stackOverlap = countCandidateStackOverlap(job, profile);
  if (stackOverlap >= POOL_FRIENDLINESS.SPECIFIC_STACK_MIN_HITS) {
    adjustments.push({
      id: "specificStack",
      label: "specific stack match",
      delta: POOL_FRIENDLINESS.SPECIFIC_STACK_BONUS,
    });
  }

  const { count: diffCount } = countDifferentiatorTags(blob);
  if (diffCount >= 1) {
    adjustments.push({
      id: "differentiatorRole",
      label: "differentiator role",
      delta: POOL_FRIENDLINESS.DIFFERENTIATOR_ROLE_BONUS,
    });
  }

  if (cattleCall) {
    adjustments.push({
      id: "cattleCall",
      label: "remote entry-level cattle-call",
      delta: POOL_FRIENDLINESS.CATTLE_CALL_PENALTY,
    });
  } else if (diffCount < 1) {
    adjustments.push({
      id: "genericStackOnly",
      label: "generic-only stack",
      delta: POOL_FRIENDLINESS.GENERIC_STACK_PENALTY,
    });
  }

  const salaryTop = postedSalaryTop(job, blob);
  if (salaryTop >= POOL_FRIENDLINESS.REAL_SALARY_MIN) {
    adjustments.push({
      id: "realSalary",
      label: "real salary",
      delta: POOL_FRIENDLINESS.REAL_SALARY_BONUS,
    });
  }

  if (isOnsiteOrHybridListing(job, blob)) {
    adjustments.push({
      id: "geoFilter",
      label: "on-site/hybrid filter",
      delta: POOL_FRIENDLINESS.GEO_FILTER_BONUS,
    });
  }

  if (!cattleCall && remote && isJuniorListing(job, blob) && FRESH_POST_RE.test(blob)) {
    adjustments.push({
      id: "freshRemoteJunior",
      label: "fresh remote junior post",
      delta: POOL_FRIENDLINESS.FRESH_REMOTE_JUNIOR_PENALTY,
    });
  }

  for (const adj of adjustments) {
    pool += adj.delta;
  }
  const score = clampPool(pool);
  const leverMeta = resolvePoolLever(score);

  return {
    score,
    adjustments,
    note: formatAdjustmentNote(adjustments, score),
    ...leverMeta,
  };
};

/** @deprecated Use computePoolFriendliness — kept for tests importing scorePoolFriendliness. */
export const scorePoolFriendliness = (
  job: ExtractedJobData,
  _combinedText?: string,
  profile?: UserProfile,
): number => computePoolFriendliness(job, profile).score;

export type { PoolFriendlinessResult as PoolFriendlinessMeta };
