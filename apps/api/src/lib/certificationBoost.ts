import type { ExtractedJobData } from "../types/job.js";
import type { UserCertification, UserProfile } from "../types/userProfile.js";
import { normalizeText } from "./text.js";

export const CERT_MATCH_THRESHOLD = 2;
export const CERT_BOOST_ACTIVE = 0.15;
export const CERT_BOOST_LAPSED = 0.1;
export const CREDENTIAL_SIGNAL_CAP = 0.75;
export const CREDENTIAL_REFERRAL_SOFTEN_THRESHOLD = 0.5;

export type CertificationBoostMeta = {
  certName: string;
  status: UserCertification["status"];
  matchedSkills: string[];
  overlapCount: number;
  boost: number;
  note: string;
};

export const listingSkillBlob = (job: ExtractedJobData): string =>
  normalizeText(
    [
      job.title ?? "",
      job.rawText ?? "",
      ...(job.stack ?? []),
      ...(job.requiredSkills ?? []),
      ...(job.preferredSkills ?? []),
      ...(job.requirements ?? []),
    ].join("\n"),
  );

const skillMatchesListing = (skill: string, listingBlob: string): boolean => {
  const norm = normalizeText(skill);
  if (norm.length < 2) return false;
  return listingBlob.includes(norm);
};

export const countCertListingOverlap = (
  cert: UserCertification,
  listingBlob: string,
): { count: number; matchedSkills: string[] } => {
  const matchedSkills = cert.relatedSkills.filter((skill) =>
    skillMatchesListing(skill, listingBlob),
  );
  return { count: matchedSkills.length, matchedSkills };
};

export const findBestRelevantCert = (
  profile: UserProfile,
  job: ExtractedJobData,
): (CertificationBoostMeta & { cert: UserCertification }) | null => {
  const certs = profile.certifications ?? [];
  if (!certs.length) return null;

  const listingBlob = listingSkillBlob(job);
  let best: {
    cert: UserCertification;
    overlapCount: number;
    matchedSkills: string[];
  } | null = null;

  for (const cert of certs) {
    const { count, matchedSkills } = countCertListingOverlap(cert, listingBlob);
    if (count < CERT_MATCH_THRESHOLD) continue;
    const isBetter =
      !best ||
      count > best.overlapCount ||
      (count === best.overlapCount &&
        cert.status === "active" &&
        best.cert.status === "lapsed");
    if (isBetter) {
      best = { cert, overlapCount: count, matchedSkills };
    }
  }

  if (!best) return null;

  const boost = best.cert.status === "active" ? CERT_BOOST_ACTIVE : CERT_BOOST_LAPSED;
  const statusLabel = best.cert.status === "lapsed" ? "lapsed" : "active";
  const serviceSample = best.matchedSkills.slice(0, 5).join(", ");
  const note = `Credential boost: ${best.cert.name} (${statusLabel}) matches ${best.overlapCount} listing services (${serviceSample}) → +${boost.toFixed(2)}`;

  return {
    cert: best.cert,
    certName: best.cert.name,
    status: best.cert.status,
    matchedSkills: best.matchedSkills,
    overlapCount: best.overlapCount,
    boost,
    note,
  };
};

export const applyCertificationBoost = (
  baseCredentialSignal: number,
  profile: UserProfile,
  job: ExtractedJobData,
): { score: number; boost?: CertificationBoostMeta } => {
  const match = findBestRelevantCert(profile, job);
  if (!match) {
    return { score: baseCredentialSignal };
  }

  const score = Math.min(CREDENTIAL_SIGNAL_CAP, baseCredentialSignal + match.boost);
  const { cert: _cert, ...boost } = match;
  return { score, boost };
};

export const certificationCredentialLeverLabel = (
  status: UserCertification["status"],
): string =>
  status === "lapsed"
    ? "relevant cert (lapsed) — list with dates"
    : "relevant cert — surface on resume";
