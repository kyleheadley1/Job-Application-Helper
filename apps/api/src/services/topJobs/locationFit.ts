import type { ExtractedJobData } from "../../types/job.js";

const NYC_RE =
  /\b(new york|nyc|manhattan|brooklyn|queens|bronx|staten island|long island city|jersey city|hoboken|newark, nj)\b/i;
const REMOTE_RE = /\b(remote|work from home|wfh|telecommute|anywhere)\b/i;
const NOT_REMOTE_RE = /\b(not|no|non)[-\s]remote\b/i;
const GENERIC_RE = /^(united states( of america)?|usa|us|u\.s\.?|north america|americas?|worldwide|global)$/i;

export type LocationVerdict = "fit" | "mismatch" | "unknown";

/** Remote or NYC metro is a fit; a named place elsewhere is a mismatch; a bare country says nothing. */
export const classifyLocation = (location: string | null | undefined): LocationVerdict => {
  const s = location?.trim();
  if (!s) return "unknown";
  if (NYC_RE.test(s)) return "fit";
  if (REMOTE_RE.test(s) && !NOT_REMOTE_RE.test(s)) return "fit";
  const place = s
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(on-?site|hybrid|in[-\s]office)\b/gi, " ")
    .replace(/[·|,;-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!place || GENERIC_RE.test(place)) return "unknown";
  return "mismatch";
};

export type LocationEvidence = {
  alertLocation?: string | null;
  postingLocation?: string | null;
  extracted?: Pick<ExtractedJobData, "location" | "remoteType" | "locationIsCommutable">;
};

/**
 * A role is kept only with positive evidence that it is remote or in the NYC metro.
 * The alert's or posting page's own location label outranks the scorer, which can misread JD text.
 */
export const locationFits = (e: LocationEvidence): boolean => {
  const labelled = [e.alertLocation, e.postingLocation].map(classifyLocation);
  if (labelled.includes("fit")) return true;
  if (labelled.includes("mismatch")) return false;
  if (e.extracted?.remoteType === "remote") return true;
  if (e.extracted?.locationIsCommutable === true) return true;
  return [e.alertLocation, e.postingLocation, e.extracted?.location].some((l) => classifyLocation(l) === "fit");
};
