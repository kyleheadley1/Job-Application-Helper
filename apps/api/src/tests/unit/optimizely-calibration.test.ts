import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { detectCapabilityGap } from "../../lib/capabilityGap.js";
import {
  extractJdLanguageLabels,
  filterLanguagesToJdPresence,
  suppressAbsentLanguageClaims,
} from "../../lib/jdLanguagePresence.js";
import { buildHardRuleFlags } from "../../lib/scoringClampLayer.js";
import { applyScoringClampLayer } from "../../lib/scoringClampLayer.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import { guardCompositeRecommendation, skipReasonIsValid } from "../../lib/recommendationGuard.js";
import { sanitizeVisibleRiskLine } from "../../lib/riskDisplaySanitizer.js";
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
    const flags = buildHardRuleFlags(OPTIMIZELY_JOB, clamped.rules);
    for (const flag of flags) {
      expect(flag.citedLanguages ?? []).not.toContain("Go");
      expect(flag.message).not.toMatch(GO_ABSENT_RE);
    }

    const riskLines = [
      "Missing Go production experience is a major stack gap.",
      rules.notes.join(" "),
      "Required core stack gap (Go) — major recruiter-screen risk.",
    ];
    for (const line of riskLines) {
      const sanitized = sanitizeVisibleRiskLine(line, {
        extracted: OPTIMIZELY_JOB,
        userProfile,
        rules: clamped.rules,
      });
      expect(sanitized).not.toMatch(GO_ABSENT_RE);
      expect(suppressAbsentLanguageClaims(line, OPTIMIZELY_JOB)).not.toMatch(GO_ABSENT_RE);
    }
  });

  it("softens degree penalty via equivalency clause and sets IAM capability gap", () => {
    const rules = evaluateRules(OPTIMIZELY_JOB, userProfile, { activeResumeType: "SWE" });
    expect(rules.degreeHasEquivalencyClause).toBe(true);
    expect(rules.explicitDegreeRisk).toBe(false);

    const clamped = applyScoringClampLayer({
      score: OPTIMIZELY_RAW_SCORE,
      extracted: OPTIMIZELY_JOB,
      rules,
    });
    const flags = buildHardRuleFlags(OPTIMIZELY_JOB, clamped.rules);
    expect(flags.some((f) => f.id === "degreeGateStructuredEmployer")).toBe(false);
    expect(
      flags.some((f) => f.id === "degreePreferenceWithEquivalency"),
    ).toBe(true);

    const capabilityGap = detectCapabilityGap(OPTIMIZELY_JOB, OPTIMIZELY_RAW_SCORE);
    expect(capabilityGap?.reason).toMatch(/enterprise IAM/i);

    const composite = computeCompositeScore({
      rawScore: clamped.score,
      rules: { ...clamped.rules, capabilityGap },
      extracted: OPTIMIZELY_JOB,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });

    const display = buildScoreDisplay({
      score: composite.score,
      rules: { ...clamped.rules, capabilityGap },
      extracted: OPTIMIZELY_JOB,
      recommendation: composite.recommendation,
      referralPathwayAvailable: true,
      referralPathwayNotes: "Connection via Codesmith",
    });

    const finalRec = guardCompositeRecommendation({
      recommendation: composite.recommendation,
      capability: composite.score.capability ?? 0,
      survivability: composite.score.survivability ?? 0,
      rules: { ...clamped.rules, capabilityGap },
      survivabilityPenalties: display?.survivabilityPenalties ?? [],
      referralPathwayAvailable: true,
    });

    if (finalRec === "skip") {
      expect(display?.actionLine).toMatch(/enterprise IAM/i);
      expect(display?.actionLine).not.toMatch(/degree requirement/i);
      expect(
        skipReasonIsValid({
          recommendation: "skip",
          statedReason: display?.actionLine ?? "",
          rules: { ...clamped.rules, capabilityGap },
          survivabilityPenalties: display?.survivabilityPenalties ?? [],
          referralPathwayAvailable: true,
        }),
      ).toBe(true);
    } else {
      expect(["stretch_signal", "referral_gated"]).toContain(finalRec);
    }
  });
});

describe("skip recommendation invariants", () => {
  it("never blames skip on referral-addressable penalty when pathway exists", () => {
    const rules = evaluateRules(OPTIMIZELY_JOB, userProfile, { activeResumeType: "SWE" });
    const clamped = applyScoringClampLayer({
      score: OPTIMIZELY_RAW_SCORE,
      extracted: OPTIMIZELY_JOB,
      rules,
    });
    const capabilityGap = detectCapabilityGap(OPTIMIZELY_JOB, OPTIMIZELY_RAW_SCORE);
    const rulesWithGap = { ...clamped.rules, capabilityGap };

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
      recommendation: "skip",
      referralPathwayAvailable: true,
      referralPathwayNotes: "Connection via Codesmith",
    });

    const upgraded = guardCompositeRecommendation({
      recommendation: "skip",
      capability: composite.score.capability ?? 0,
      survivability: composite.score.survivability ?? 0,
      rules: { ...rulesWithGap, capabilityGap: undefined },
      survivabilityPenalties: display?.survivabilityPenalties ?? [],
      referralPathwayAvailable: true,
    });
    expect(upgraded).not.toBe("skip");

    const skipWithGap = guardCompositeRecommendation({
      recommendation: "skip",
      capability: composite.score.capability ?? 0,
      survivability: composite.score.survivability ?? 0,
      rules: rulesWithGap,
      survivabilityPenalties: display?.survivabilityPenalties ?? [],
      referralPathwayAvailable: true,
    });
    expect(skipWithGap).toBe("skip");
  });
});
