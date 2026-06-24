import type { ExtractedJobData } from "../types/job.js";
import type { UserProfile } from "../types/userProfile.js";
import { normalizeText } from "./text.js";

export type ReferralPathway = {
  referralPathwayAvailable: boolean;
  referralPathwayNotes: string;
};

const KNOWN_PROGRAMS =
  /\b(codesmith|bootcamp|residency|fellowship|app academy|hack reactor|flatiron|general assembly)\b/i;

const NAMED_CONNECTION =
  /\b(referred by|referral from|know someone|connection at|alumni at|former colleague at)\b/i;

/** Display-only referral route signals — never used in score math. */
export const detectReferralPathway = (params: {
  profile: UserProfile;
  extracted: ExtractedJobData;
  resumeText?: string;
}): ReferralPathway => {
  const notes: string[] = [];
  const blob = normalizeText(
    [
      params.extracted.company,
      params.extracted.rawText ?? "",
      ...(params.extracted.requirements ?? []),
    ].join("\n"),
  );
  const resume = normalizeText(params.resumeText ?? "");

  const program = params.profile.training?.program?.trim();
  if (program && KNOWN_PROGRAMS.test(program)) {
    notes.push(`Connection via ${program}`);
  }

  if (program && blob.includes(normalizeText(program))) {
    notes.push(`Shared program connection (${program}) mentioned in posting`);
  }

  if (NAMED_CONNECTION.test(blob)) {
    notes.push("Named connection or referral language in posting");
  }

  const employers = resume.match(
    /\b(?:engineer|developer|contract|residency)\s*[—–-]\s*([A-Za-z0-9][A-Za-z0-9\s.&]+?)(?:\s*[—–-]|\s*\d{4}|\n)/gi,
  );
  if (employers) {
    for (const match of employers) {
      const name = match.replace(/^[^—–-]+[—–-]\s*/i, "").trim();
      if (name.length >= 3 && blob.includes(normalizeText(name.split(/\s+/).slice(0, 2).join(" ")))) {
        notes.push(`Connection from previous company (${name.split(/\s+/).slice(0, 2).join(" ")})`);
        break;
      }
    }
  }

  const unique = [...new Set(notes)];
  return {
    referralPathwayAvailable: unique.length > 0,
    referralPathwayNotes: unique.join("; "),
  };
};
