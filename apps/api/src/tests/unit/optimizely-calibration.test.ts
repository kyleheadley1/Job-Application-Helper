import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { detectCapabilityGap, detectSpecializationGap } from "../../lib/capabilityGap.js";
import {
  extractJdLanguageLabels,
  filterLanguagesToJdPresence,
} from "../../lib/jdLanguagePresence.js";
import { outputCitesAbsentLanguage } from "../../lib/jdLanguageOutputBoundary.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import { guardCompositeRecommendation, skipReasonIsValid } from "../../lib/recommendationGuard.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { ScoreBreakdown } from "../../types/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

const OPTIMIZELY_JOB: ExtractedJobData = {
  company: "Optimizely",
  title: "Software Engineer II — Identity Platform",
  location: "Remote",
  remoteType: "remote",
  seniority: "mid",
  stack: [
    "SAML",
    "OAuth",
    "OIDC",
    "REST",
    "GraphQL",
    "LDAP",
    "Active Directory",
    "Kubernetes",
    "Docker",
  ],
  requiredSkills: ["SAML", "OAuth", "OIDC", "LDAP"],
  preferredSkills: ["GraphQL", "Kubernetes"],
  domainTags: ["identity", "IAM", "enterprise"],
  degreeRequirement: {
    level: "required",
    raw: "Bachelor's or master's degree in a related field, or related experience required",
  },
  responsibilities: [
    "Build and maintain enterprise identity integrations using SAML, OAuth, and OIDC",
    "Integrate LDAP and Active Directory for customer SSO",
    "Design secure REST and GraphQL APIs for identity services",
  ],
  requirements: [
    "Bachelor's or master's degree in Computer Science or related field, or related experience required",
    "Production experience with SAML, OAuth, and OIDC",
    "LDAP / Active Directory integration experience",
    "Kubernetes and Docker for service deployment",
  ],
  rawText: `
Optimizely — Software Engineer II, Identity Platform
Remote
Bachelor's or master's degree in a related field, or related experience required.
Build enterprise IAM integrations: SAML, OAuth, OIDC, LDAP, Active Directory.
REST and GraphQL APIs. Kubernetes and Docker.
  `.trim(),
};

/** Low functional overlap reflects IAM specialization gap vs OAuth/GitHub-only auth on resume. */
const OPTIMIZELY_RAW_SCORE: ScoreBreakdown = {
  stackFit: 14,
  levelFit: 12,
  domainFit: 5,
  resumeStoryClarity: 6,
  functionalOverlap: 7,
  recruiterFriendliness: 8,
  careerValue: 6,
  total: 0,
};

const GO_ABSENT_RE = /\b(go(lang)?|missing go|lacks go)\b/i;

describe("Optimizely calibration anchor", () => {
  it("no fabricated Go penalty or risk when Go is absent from the JD", () => {
    const jdLangs = extractJdLanguageLabels(OPTIMIZELY_JOB);
    expect(jdLangs.has("Go")).toBe(false);

    const rules = evaluateRules(OPTIMIZELY_JOB, userProfile, { activeResumeType: "SWE" });
    expect(rules.coreLanguageGap ?? []).not.toContain("Go");
    expect(filterLanguagesToJdPresence(["Go", "Java"], OPTIMIZELY_JOB)).toEqual([]);

    const clamped = applyScoringClampLayer({
      score: OPTIMIZELY_RAW_SCORE,
      extracted: OPTIMIZELY_JOB,
      rules,
    });
    expect(outputCitesAbsentLanguage(OPTIMIZELY_JOB, clamped.rules)).toBe(false);
    for (const flag of clamped.rules.hardRuleFlags ?? []) {
      expect(flag.citedLanguages ?? []).not.toContain("Go");
      expect(flag.message).not.toMatch(GO_ABSENT_RE);
    }
    for (const note of [...clamped.rules.notes, ...(clamped.rules.hardRuleNotes ?? [])]) {
      expect(note).not.toMatch(GO_ABSENT_RE);
    }
  });

  it("softens degree penalty via equivalency clause and sets structured IAM specialization gap", () => {
    const rules = evaluateRules(OPTIMIZELY_JOB, userProfile, { activeResumeType: "SWE" });
    expect(rules.degreeHasEquivalencyClause).toBe(true);
    expect(rules.explicitDegreeRisk).toBe(false);

    const clamped = applyScoringClampLayer({
      score: OPTIMIZELY_RAW_SCORE,
      extracted: OPTIMIZELY_JOB,
      rules,
    });
    expect(
      clamped.rules.hardRuleFlags?.some((f) => f.id === "degreeGateStructuredEmployer"),
    ).toBe(false);
    expect(
      clamped.rules.hardRuleFlags?.some((f) => f.id === "degreePreferenceWithEquivalency"),
    ).toBe(true);

    const specializationGap = detectSpecializationGap(OPTIMIZELY_JOB, OPTIMIZELY_RAW_SCORE, SWE_RESUME);
    expect(specializationGap?.name).toMatch(/enterprise IAM/i);
    expect(specializationGap?.lever).toBe("none");

    const capabilityGap = detectCapabilityGap(OPTIMIZELY_JOB, OPTIMIZELY_RAW_SCORE, SWE_RESUME);
    expect(capabilityGap?.reason).toMatch(/enterprise IAM/i);

    const rulesWithGap = {
      ...clamped.rules,
      specializationGap,
      capabilityGap,
    };

    const composite = computeCompositeScore({
      rawScore: clamped.score,
      rules: rulesWithGap,
      extracted: OPTIMIZELY_JOB,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });

    const display = buildScoreDisplay({
      score: composite.score,
      rules: rulesWithGap,
      extracted: OPTIMIZELY_JOB,
      recommendation: composite.recommendation,
      referralPathwayAvailable: false,
    });

    expect(display?.survivabilityPenalties.some((p) => p.message.match(/enterprise IAM/i))).toBe(
      true,
    );
    expect(display?.dominantLever?.penaltyName).toMatch(/enterprise IAM/i);

    const finalRec = guardCompositeRecommendation({
      recommendation: composite.recommendation,
      capability: composite.score.capability ?? 0,
      survivability: composite.score.survivability ?? 0,
      rules: rulesWithGap,
      survivabilityPenalties: display?.survivabilityPenalties ?? [],
    });

    if (finalRec === "skip") {
      expect(display?.actionLine).toMatch(/enterprise IAM/i);
      expect(display?.actionLine).not.toMatch(/degree requirement/i);
      expect(
        skipReasonIsValid({
          recommendation: "skip",
          statedReason: display?.actionLine ?? "",
          rules: rulesWithGap,
          survivabilityPenalties: display?.survivabilityPenalties ?? [],
        }),
      ).toBe(true);
    } else {
      expect(["stretch_signal", "referral_gated"]).toContain(finalRec);
      expect(finalRec).not.toBe("referral_gated");
    }
  });
});

describe("skip recommendation invariants", () => {
  it("referral pathway does not change guard outcome for non-addressable blockers", () => {
    const rules = evaluateRules(OPTIMIZELY_JOB, userProfile, { activeResumeType: "SWE" });
    const clamped = applyScoringClampLayer({
      score: OPTIMIZELY_RAW_SCORE,
      extracted: OPTIMIZELY_JOB,
      rules,
    });

    const compositeNoGap = computeCompositeScore({
      rawScore: clamped.score,
      rules: { ...clamped.rules, specializationGap: undefined, capabilityGap: undefined },
      extracted: OPTIMIZELY_JOB,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });

    const penalties = buildScoreDisplay({
      score: compositeNoGap.score,
      rules: { ...clamped.rules, specializationGap: undefined, capabilityGap: undefined },
      extracted: OPTIMIZELY_JOB,
      recommendation: "skip",
      referralPathwayAvailable: true,
      referralPathwayNotes: "Connection via Etana Kopin",
    })?.survivabilityPenalties ?? [];

    const withPathway = guardCompositeRecommendation({
      recommendation: "skip",
      capability: compositeNoGap.score.capability ?? 0,
      survivability: compositeNoGap.score.survivability ?? 0,
      rules: { ...clamped.rules, specializationGap: undefined, capabilityGap: undefined },
      survivabilityPenalties: penalties,
    });
    const withoutPathway = guardCompositeRecommendation({
      recommendation: "skip",
      capability: compositeNoGap.score.capability ?? 0,
      survivability: compositeNoGap.score.survivability ?? 0,
      rules: { ...clamped.rules, specializationGap: undefined, capabilityGap: undefined },
      survivabilityPenalties: penalties,
    });
    expect(withPathway).toBe(withoutPathway);
  });
});
