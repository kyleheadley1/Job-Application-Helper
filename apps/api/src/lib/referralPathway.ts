import type { ExtractedJobData } from "../types/job.js";
import type { UserProfile } from "../types/userProfile.js";
import { normalizeText } from "./text.js";

export type ReferralBasis = "named_connection";

export type ReferralPathway = {
  referralPathwayAvailable: boolean;
  referralPathwayNotes: string;
  referralBasis?: ReferralBasis;
};

const REFERRAL_BOILERPLATE =
  /\b(get referrals?|applications?\s+(via|through)\s+(a\s+)?referral|referral[s]?\s+are\s+\d+x|more likely to get|simplify\+|unlock job analytics|\/\s*applications via referral)\b/i;

const NAMED_PERSON_PATTERNS = [
  /\breferred\s+by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/,
  /\breferral\s+from\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/,
  /\bconnection:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
  /\binternal\s+referral\s+from\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
  /\b(?:contact|know)\s+(?:at\s+)?([A-Z][a-z]+\s+[A-Z][a-z]+)\b/,
];

const extractNamedPeople = (text: string): string[] => {
  const names = new Set<string>();
  for (const pattern of NAMED_PERSON_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]?.trim()) names.add(match[1].trim());
  }
  return [...names];
};

const stripBoilerplate = (text: string): string => {
  const lines = text.split("\n").filter((line) => !REFERRAL_BOILERPLATE.test(line));
  return lines.join("\n");
};

/** Display-only referral route signals — never used in score math. */
export const detectReferralPathway = (params: {
  profile: UserProfile;
  extracted: ExtractedJobData;
  resumeText?: string;
}): ReferralPathway => {
  const rawBlob = normalizeText(
    [
      params.extracted.company,
      params.extracted.rawText ?? "",
      ...(params.extracted.requirements ?? []),
      ...(params.extracted.responsibilities ?? []),
    ].join("\n"),
  );
  const blob = stripBoilerplate(rawBlob);
  const resume = normalizeText(params.resumeText ?? "");
  const notes: string[] = [];

  const namedInPosting = extractNamedPeople(blob);
  for (const name of namedInPosting) {
    notes.push(`Connection via ${name}`);
  }

  const program = params.profile.training?.program?.trim();
  if (program && blob.includes(normalizeText(program))) {
    const programNames = extractNamedPeople(blob);
    const alum = programNames.find((n) => blob.toLowerCase().includes(`${n.toLowerCase()}`));
    if (alum) {
      notes.push(`Connection via ${alum} (${program})`);
    }
  }

  const employers = resume.match(
    /\b(?:engineer|developer|contract|residency)\s*[—–-]\s*([A-Za-z0-9][A-Za-z0-9\s.&]+?)(?:\s*[—–-]|\s*\d{4}|\n)/gi,
  );
  if (employers) {
    for (const match of employers) {
      const name = match.replace(/^[^—–-]+[—–-]\s*/i, "").trim();
      const employerToken = normalizeText(name.split(/\s+/).slice(0, 2).join(" "));
      if (name.length >= 3 && employerToken.length >= 3 && blob.includes(employerToken)) {
        notes.push(`Connection from previous company (${name.split(/\s+/).slice(0, 2).join(" ")})`);
        break;
      }
    }
  }

  const unique = [...new Set(notes)];
  return {
    referralPathwayAvailable: unique.length > 0,
    referralPathwayNotes: unique.join("; "),
    referralBasis: unique.length > 0 ? "named_connection" : undefined,
  };
};
