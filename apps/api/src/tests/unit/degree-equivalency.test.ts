import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import {
  candidateSatisfiesDegreeEquivalency,
  jdHasDegreeEquivalencyClause,
  profileHasAssociateDegree,
  profileHasBootcampCert,
} from "../../lib/degreeEquivalency.js";

export const TEAM_CARNEY_DEGREE_RAW =
  "Associate or Bachelor's degree in a related field, OR a completed Software Development Certificate in lieu of degree.";

export const TEAM_CARNEY_JOB = {
  company: "Team Carney",
  title: "Software Engineer",
  location: "Remote",
  remoteType: "remote" as const,
  stack: ["TypeScript", "Node.js", "React"],
  requiredSkills: ["TypeScript", "Node.js"],
  preferredSkills: [],
  domainTags: ["consulting"],
  degreeRequirement: {
    level: "required" as const,
    raw: TEAM_CARNEY_DEGREE_RAW,
  },
  requirements: [TEAM_CARNEY_DEGREE_RAW],
  responsibilities: ["Build full-stack product features for consulting clients."],
  rawText: `
Team Carney Software Engineer.
${TEAM_CARNEY_DEGREE_RAW}
Experience implementing REST architecture preferred.
Workplace: Remote.
  `.trim(),
};

describe("degree equivalency detection", () => {
  it("detects Team Carney certificate-in-lieu and associate-or-bachelor clause", () => {
    expect(jdHasDegreeEquivalencyClause(TEAM_CARNEY_JOB.rawText, "required", TEAM_CARNEY_DEGREE_RAW)).toBe(
      true,
    );
  });

  it("candidate profile satisfies Team Carney via associate + Codesmith certificate path", () => {
    expect(profileHasAssociateDegree(userProfile)).toBe(true);
    expect(profileHasBootcampCert(userProfile)).toBe(true);
    expect(
      candidateSatisfiesDegreeEquivalency(
        userProfile,
        TEAM_CARNEY_JOB.rawText,
        "required",
        TEAM_CARNEY_DEGREE_RAW,
      ),
    ).toBe(true);
  });

  it("sets degreeEquivalencySatisfied and clears explicitDegreeRisk for Team Carney", () => {
    const rules = evaluateRules(TEAM_CARNEY_JOB, userProfile, { activeResumeType: "SWE" });
    expect(rules.degreeHasEquivalencyClause).toBe(true);
    expect(rules.degreeEquivalencySatisfied).toBe(true);
    expect(rules.explicitDegreeRisk).toBe(false);
  });

  it("detects Precisely equivalent-work-experience-in-place-of phrasing", () => {
    const preciselyRaw =
      "Bachelor's degree in computer science or related field (Equivalent work experience will be accepted in place of the education requirement).";
    expect(jdHasDegreeEquivalencyClause(preciselyRaw, "required", preciselyRaw)).toBe(true);
    expect(
      candidateSatisfiesDegreeEquivalency(userProfile, preciselyRaw, "required", preciselyRaw),
    ).toBe(true);
  });
});
