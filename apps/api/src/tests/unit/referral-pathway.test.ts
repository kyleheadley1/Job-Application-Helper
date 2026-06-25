import { describe, expect, it } from "vitest";
import { userProfile } from "../../config/userProfile.js";
import { detectReferralPathway } from "../../lib/referralPathway.js";
import type { ExtractedJobData } from "../../types/job.js";

const BOILERPLATE_ONLY: ExtractedJobData = {
  company: "Palantir",
  title: "Web Design Engineer",
  stack: ["TypeScript"],
  requiredSkills: [],
  preferredSkills: [],
  domainTags: [],
  responsibilities: [],
  requirements: [],
  rawText: `
Palantir — Web Design Engineer
Get referrals — applications via referral are 3x more likely to get hired.
Unlock job analytics with Simplify+
Connection
  `.trim(),
};

const NAMED_CONNECTION: ExtractedJobData = {
  company: "Aledade",
  title: "Software Engineer I",
  stack: ["Node.js"],
  requiredSkills: [],
  preferredSkills: [],
  domainTags: [],
  responsibilities: [],
  requirements: [],
  rawText: `
Aledade — Software Engineer I
Remote
Internal referral from Etana Kopin welcomed.
  `.trim(),
};

describe("referral pathway attribution", () => {
  it("does not fire on Simplify-style boilerplate alone", () => {
    const pathway = detectReferralPathway({
      profile: userProfile,
      extracted: BOILERPLATE_ONLY,
      resumeText: "TypeScript engineer",
    });
    expect(pathway.referralPathwayAvailable).toBe(false);
    expect(pathway.referralPathwayNotes).toBe("");
    expect(pathway.referralBasis).toBeUndefined();
    expect(pathway.referralPathwayNotes).not.toContain("Codesmith");
  });

  it("fires only on named connection with referralBasis named_connection", () => {
    const pathway = detectReferralPathway({
      profile: userProfile,
      extracted: NAMED_CONNECTION,
      resumeText: "TypeScript engineer",
    });
    expect(pathway.referralPathwayAvailable).toBe(true);
    expect(pathway.referralBasis).toBe("named_connection");
    expect(pathway.referralPathwayNotes).toMatch(/Etana Kopin/i);
    expect(pathway.referralPathwayNotes).not.toMatch(/^Connection via Codesmith$/i);
  });

  it("does not default to profile training program without posting evidence", () => {
    const pathway = detectReferralPathway({
      profile: userProfile,
      extracted: {
        company: "RandomCo",
        title: "Software Engineer",
        stack: [],
        requiredSkills: [],
        preferredSkills: [],
        domainTags: [],
        responsibilities: [],
        requirements: [],
        rawText: "RandomCo software engineer role. TypeScript required.",
      },
      resumeText: "engineer",
    });
    expect(pathway.referralPathwayAvailable).toBe(false);
    expect(pathway.referralPathwayNotes).not.toContain("Codesmith");
  });
});
