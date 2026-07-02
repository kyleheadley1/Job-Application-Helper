import { userProfile } from "../../config/userProfile.js";
import { classifyClearanceTiming, isStrictExistingClearanceRequired } from "../../lib/clearanceCitizenship.js";
import { normalizeText } from "../../lib/text.js";
import type { DiscoveredListing } from "../../types/topJob.js";

const SENIORITY_OVERREACH_RE =
  /\b(senior|staff|principal|lead|director|manager|head of|vp\b|vice president)\b/i;

const TITLE_DENY_RE =
  /\b(sales engineer|devops|sre|site reliability|data analyst|data scientist|qa engineer|quality assurance|recruiter|account executive|customer success)\b/i;

const TITLE_KEEP_RE =
  /\b(engineer|developer|software|full[\s-]?stack|backend|frontend|platform|programmer)\b/i;

const STACK_KEYWORDS = [
  "typescript",
  "javascript",
  "node",
  "react",
  "express",
  "mongodb",
  "postgres",
  "python",
  "java",
  "api",
];

const CLEARANCE_MENTION_RE =
  /\b(security clearance|ts\/sci|top secret|clearance required|dod clearance)\b/i;
const RAW_VISA = /\bno\s+(visa\s+)?sponsorship\b|\bunable\s+to\s+sponsor\b/i;
const RAW_DEGREE_HARD =
  /\b(bachelor'?s?\s+degree|bachelors\s+degree|bs\s+in|b\.s\.)\b[^.\n]{0,120}\brequired\b/i;
const DEGREE_SOFTEN =
  /\bor equivalent\b|\bdegree preferred\b|\bwithout a degree\b|\bno degree required\b/i;

const NYC_REMOTE_OK_RE =
  /\b(remote|hybrid|work from home|wfh|nyc|new york|manhattan|brooklyn|queens|jersey city|hoboken|newark)\b/i;
const ONSITE_ONLY_AWAY_RE =
  /\b(on[-\s]?site only|in[-\s]?office only|must (?:relocate|be located) (?:in|to|near))\b[^.\n]{0,80}\b(san francisco|seattle|austin|boston|chicago|denver|atlanta|dallas|los angeles|bay area)\b/i;

export type PreFilterResult = {
  pass: boolean;
  reason?: string;
};

export const preFilterListing = (listing: DiscoveredListing): PreFilterResult => {
  const title = listing.title.trim();
  const blob = normalizeText(`${title} ${listing.description} ${listing.location ?? ""}`);

  if (listing.description.trim().length < 200) {
    return { pass: false, reason: "description_too_short" };
  }
  if (SENIORITY_OVERREACH_RE.test(title)) {
    return { pass: false, reason: "seniority_overreach" };
  }
  if (TITLE_DENY_RE.test(title)) {
    return { pass: false, reason: "title_denylist" };
  }
  if (!TITLE_KEEP_RE.test(title)) {
    return { pass: false, reason: "title_not_engineering" };
  }
  if (!STACK_KEYWORDS.some((k) => blob.includes(k))) {
    return { pass: false, reason: "no_stack_overlap" };
  }
  if (CLEARANCE_MENTION_RE.test(blob)) {
    const timing = classifyClearanceTiming(blob);
    if (
      timing === "active_upfront" &&
      isStrictExistingClearanceRequired(blob) &&
      !(userProfile.holdsActiveClearance ?? false)
    ) {
      return { pass: false, reason: "clearance_required" };
    }
  }
  if (userProfile.requiresSponsorship && RAW_VISA.test(blob)) {
    return { pass: false, reason: "no_sponsorship" };
  }
  if (RAW_DEGREE_HARD.test(blob) && !DEGREE_SOFTEN.test(blob)) {
    return { pass: false, reason: "strict_degree" };
  }
  if (ONSITE_ONLY_AWAY_RE.test(blob) && !NYC_REMOTE_OK_RE.test(blob) && !listing.remote) {
    return { pass: false, reason: "location_mismatch" };
  }

  return { pass: true };
};

export const preFilterListings = (listings: DiscoveredListing[]): DiscoveredListing[] =>
  listings.filter((l) => preFilterListing(l).pass);

export const sortListingsByPostedDesc = (listings: DiscoveredListing[]): DiscoveredListing[] =>
  [...listings].sort(
    (a, b) => new Date(b.sourcePostedAt).getTime() - new Date(a.sourcePostedAt).getTime(),
  );
