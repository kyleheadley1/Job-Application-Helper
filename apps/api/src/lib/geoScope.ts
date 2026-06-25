import type { ExtractedJobData, GeoScope } from "../types/job.js";
import { normalizeText } from "./text.js";
import { isTitleLikeLine } from "../tools/preScoringMetadataExtract.js";

export type { GeoScope };

const REGION_LABELS: Array<{ re: RegExp; label: string }> = [
  { re: /\blatin america\b/i, label: "Latin America" },
  { re: /\bemea\b/i, label: "EMEA" },
  { re: /\bapac\b|\basia[-\s]?pacific\b/i, label: "APAC" },
  { re: /\bunited states\b|\bus[-\s]?only\b|\bu\.?s\.?\s+only\b/i, label: "United States" },
  { re: /\beurope\b|\beu\b/i, label: "Europe" },
  { re: /\bindia\b/i, label: "India" },
  { re: /\bcanada\b/i, label: "Canada" },
  { re: /\buk\b|\bunited kingdom\b/i, label: "United Kingdom" },
];

export const normalizeRegionLabel = (text: string): string | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const { re, label } of REGION_LABELS) {
    if (re.test(trimmed)) return label;
  }
  if (/^(remote|hybrid|on-site|onsite)$/i.test(trimmed)) return null;
  if (/^[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(trimmed)) return trimmed;
  return trimmed.length <= 40 ? trimmed : null;
};

export const looksLikeRegion = (text: string): boolean => normalizeRegionLabel(text) !== null;

/** Title suffix: "Software Engineer - Latin America". */
export const extractTitleRegionFromTitle = (title: string): string | null => {
  const trimmed = title.trim();
  const dash = trimmed.match(/^(.+?)\s*-\s*(.+)$/);
  if (!dash) return null;
  const left = dash[1]!.trim();
  const right = dash[2]!.trim();
  if (isTitleLikeLine(left) && looksLikeRegion(right)) {
    return normalizeRegionLabel(right);
  }
  if (looksLikeRegion(left) && isTitleLikeLine(right)) {
    return normalizeRegionLabel(left);
  }
  return null;
};

const parseCardLocation = (location: string | undefined): string | null => {
  if (!location?.trim()) return null;
  return location.trim();
};

const parsePostingLocationFromText = (job: ExtractedJobData): string | null => {
  const blob = normalizeText(
    [job.location ?? "", job.rawText ?? "", ...(job.requirements ?? [])].join("\n"),
  );
  const locationLine = blob.match(/\blocation\s*:\s*([^\n.]+)/i)?.[1]?.trim();
  if (locationLine) return locationLine;
  if (job.location?.trim()) return job.location.trim();
  return null;
};

export const resolveGeoScope = (job: ExtractedJobData): GeoScope => ({
  titleRegion: extractTitleRegionFromTitle(job.title),
  postingLocation: parsePostingLocationFromText(job),
  cardLocation: parseCardLocation(job.location),
  remoteType: job.remoteType ?? "unknown",
});

export const regionKeysConflict = (a: string, b: string): boolean => {
  const norm = (s: string) => normalizeRegionLabel(s)?.toLowerCase() ?? s.toLowerCase();
  const ka = norm(a);
  const kb = norm(b);
  if (ka === kb) return false;
  const usLike = (k: string) => k === "united states" || k === "us" || /\bunited states\b/i.test(k);
  const laLike = (k: string) => k === "latin america" || /\blatin america\b/i.test(k);
  if (laLike(ka) && usLike(kb)) return true;
  if (laLike(kb) && usLike(ka)) return true;
  if (usLike(ka) && laLike(kb)) return true;
  return ka !== kb && !ka.includes(kb) && !kb.includes(ka);
};
