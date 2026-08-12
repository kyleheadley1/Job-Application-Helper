import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { detectCapabilityGap, detectSpecializationGap } from "../../lib/capabilityGap.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import {
  applyJdLanguageOutputBoundary,
  coreLanguageMismatchMessage,
  outputCitesAbsentLanguage,
} from "../../lib/jdLanguageOutputBoundary.js";
import { extractJdLanguageLabels } from "../../lib/jdLanguagePresence.js";
import { guardCompositeRecommendation } from "../../lib/recommendationGuard.js";
import { applyScoringClampLayer, buildHardRuleFlags } from "../../lib/scoringClampLayer.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { HardRuleFlag, RuleEvaluation, ScoreBreakdown, SurvivabilityPenalty } from "../../types/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

/**
 * Fixture shape mirrors optimizely-calibration.test.ts OPTIMIZELY_JOB:
 * IAM/SAML/OIDC role, TypeScript + Node.js present, no Go in structured fields.
 */
export const GO_FREE_JD: ExtractedJobData = {
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
    "TypeScript",
    "Node.js",
  ],
  requiredSkills: ["SAML", "OAuth", "OIDC", "LDAP", "TypeScript", "Node.js"],
  preferredSkills: ["GraphQL"],
  domainTags: ["identity", "IAM", "enterprise"],
  degreeRequirement: {
    level: "required",
    raw: "Bachelor's or master's degree in a related field, or related experience required",
  },
  responsibilities: [
    "Build and maintain enterprise identity integrations using SAML, OAuth, and OIDC",
    "Integrate LDAP and Active Directory for customer SSO",
  ],
  requirements: [
    "Bachelor's or master's degree in Computer Science or related field, or related experience required",
    "Production experience with SAML, OAuth, and OIDC",
    "TypeScript and Node.js for service APIs",
  ],
  rawText: `
Optimizely — Software Engineer II, Identity Platform
Remote
Build enterprise IAM integrations: SAML, OAuth, OIDC, LDAP, Active Directory.
TypeScript and Node.js. REST and GraphQL APIs.
  `.trim(),
};

/** Go-only backend JD — Go must survive presence validation. */
export const GO_REQUIRED_JD: ExtractedJobData = {
  company: "GoPlatform Inc",
  title: "Backend Engineer",
  location: "Remote",
  remoteType: "remote",
  seniority: "mid",
  stack: ["Go", "gRPC", "PostgreSQL"],
  requiredSkills: ["Go"],
  preferredSkills: [],
  domainTags: ["platform"],
  responsibilities: ["Build production backend services in Go"],
  requirements: ["5+ years production Go experience required"],
  rawText: "Backend engineer. Strong Go required. No Node.js alternative.",
};

const OPTIMIZELY_LLM_SCORE: ScoreBreakdown = {
  stackFit: 17,
  levelFit: 14,
  domainFit: 6,
  resumeStoryClarity: 8,
  functionalOverlap: 13,
  recruiterFriendliness: 9,
  careerValue: 7,
  total: 0,
};

const GO_PROSE_RE = /\b(go(lang)?)\b/i;

const minimalRules = (): RuleEvaluation => ({
  explicitDegreeRisk: false,
  traditionalCompanyPenalty: false,
  financePenalty: false,
  strictNewGradPipeline: false,
  earlyCareerFriendlyRole: false,
  newGradPenalty: false,
  seniorityOverreach: false,
  locationMismatch: false,
  visaMismatch: false,
  citizenshipMismatch: false,
  clearanceMismatch: false,
  stackMismatch: false,
  domainMismatch: false,
  startupFounderMismatch: false,
  notes: [],
});

/** Simulates upstream rules carrying a phantom Go gap (not in structured JD). */
const phantomGoStackRules = (base: RuleEvaluation = minimalRules()): RuleEvaluation => ({
  ...base,
  stackMismatch: true,
  coreLanguageGap: ["Go"],
  notes: ["Required core language gap: Go — not in claimable stack."],
  hardRuleNotes: ["Required core stack gap (Go) — major recruiter-screen risk."],
});

const assertNoGoOnSurfaces = (
  job: ExtractedJobData,
  rules: RuleEvaluation,
  penalties: SurvivabilityPenalty[],
  keyRisks: string[],
) => {
  expect(outputCitesAbsentLanguage(job, rules)).toBe(false);
  for (const flag of rules.hardRuleFlags ?? []) {
    expect(flag.citedLanguages ?? []).not.toContain("Go");
    expect(flag.message).not.toMatch(GO_PROSE_RE);
  }
  for (const note of [...(rules.notes ?? []), ...(rules.hardRuleNotes ?? [])]) {
    expect(note).not.toMatch(GO_PROSE_RE);
  }
  for (const penalty of penalties) {
    expect(penalty.message).not.toMatch(GO_PROSE_RE);
  }
  for (const risk of keyRisks) {
    expect(risk).not.toMatch(GO_PROSE_RE);
  }
};

const runOptimizelyScoringPipeline = (rules: RuleEvaluation) => {
  const clamped = applyScoringClampLayer({
    score: OPTIMIZELY_LLM_SCORE,
    extracted: GO_FREE_JD,
    rules,
  });
  const rulesWithGap = {
    ...clamped.rules,
    specializationGap: detectSpecializationGap(GO_FREE_JD, clamped.score, SWE_RESUME),
    capabilityGap: detectCapabilityGap(GO_FREE_JD, clamped.score, SWE_RESUME),
  };
  const composite = computeCompositeScore({
    rawScore: clamped.score,
    rules: rulesWithGap,
    extracted: GO_FREE_JD,
    profile: userProfile,
    resumeText: SWE_RESUME,
  });
  const display = buildScoreDisplay({
    score: composite.score,
    rules: rulesWithGap,
    extracted: GO_FREE_JD,
    recommendation: composite.recommendation,
    referralPathwayAvailable: false,
  });
  const recommendation = guardCompositeRecommendation({
    recommendation: composite.recommendation,
    capability: composite.score.capability ?? 0,
    survivability: composite.score.survivability ?? 0,
    rules: rulesWithGap,
    survivabilityPenalties: display?.survivabilityPenalties ?? [],
  });
  const keyRisks = [
    ...(rulesWithGap.hardRuleNotes ?? []),
    ...(rulesWithGap.notes ?? []),
  ];
  return {
    recommendation,
    rules: rulesWithGap,
    survivabilityPenalties: display?.survivabilityPenalties ?? [],
    keyRisks,
  };
};

describe("jd language presence — output boundary (Change 2)", () => {
  it("fixture: structured JD language set has TS/Node, not Go", () => {
    const labels = extractJdLanguageLabels(GO_FREE_JD);
    expect(labels.has("TypeScript")).toBe(true);
    expect(labels.has("Node.js")).toBe(true);
    expect(labels.has("Go")).toBe(false);
  });

  it("does not treat English go-to / go find prose as the Go language", () => {
    const job: ExtractedJobData = {
      ...GO_FREE_JD,
      company: "Rollout",
      title: "Founding Software Engineer",
      stack: [],
      requiredSkills: [],
      preferredSkills: [],
      responsibilities: [
        "You're the team's go-to authority on AI-assisted development",
      ],
      requirements: [
        "Curiosity and initiative — you go find the answer rather than wait to be handed one.",
        "Fast learner: you can go from an unfamiliar codebase to a working solution",
      ],
      rawText: "Founding Software Engineer at Rollout. go-to authority. go find the answer.",
    };
    const labels = extractJdLanguageLabels(job);
    expect(labels.has("Go")).toBe(false);

    const rules = evaluateRules(job, userProfile, { activeResumeType: "SWE" });
    expect(rules.coreLanguageGap ?? []).not.toContain("Go");
    expect(rules.stackMismatch).toBe(false);
    expect(coreLanguageMismatchMessage(["Go"])).toMatch(/Go/);
    const flags = buildHardRuleFlags(job, rules);
    expect(flags.some((f) => f.id === "coreLanguageMismatch")).toBe(false);
  });

  it("1 — applyJdLanguageOutputBoundary drops absent Go, keeps non-language penalty", () => {
    const input: RuleEvaluation = {
      ...minimalRules(),
      hardRuleFlags: [
        {
          id: "coreLanguageMismatch",
          citedLanguages: ["Go"],
          message: coreLanguageMismatchMessage(["Go"]),
        },
        {
          id: "seniorityOverreach",
          message:
            "Seniority overreach — role reads Senior/Staff or expects experienced ownership beyond early-career profile.",
        },
      ],
    };

    const out = applyJdLanguageOutputBoundary(GO_FREE_JD, input);

    expect(out.hardRuleFlags?.map((f) => f.id)).toEqual(["seniorityOverreach"]);
    expect(out.hardRuleFlags?.some((f) => f.id === "coreLanguageMismatch")).toBe(false);
  });

  it("2 — applyJdLanguageOutputBoundary keeps Go penalty when Go is in the JD", () => {
    const flag: HardRuleFlag = {
      id: "coreLanguageMismatch",
      citedLanguages: ["Go"],
      message: coreLanguageMismatchMessage(["Go"]),
    };
    const out = applyJdLanguageOutputBoundary(GO_REQUIRED_JD, {
      ...minimalRules(),
      stackMismatch: true,
      coreLanguageGap: ["Go"],
      hardRuleFlags: [flag],
    });

    const kept = out.hardRuleFlags?.find((f) => f.id === "coreLanguageMismatch");
    expect(kept).toBeDefined();
    expect(kept?.citedLanguages).toEqual(["Go"]);
    expect(kept?.message).toMatch(GO_PROSE_RE);
  });
});

describe("jd language presence — clamp mint + pipeline (Change 1)", () => {
  it("3 — buildHardRuleFlags does not mint Go coreLanguageMismatch for Go-free Optimizely JD", () => {
    const rules = phantomGoStackRules(
      evaluateRules(GO_FREE_JD, userProfile, { activeResumeType: "SWE" }),
    );

    const flags = buildHardRuleFlags(GO_FREE_JD, rules);
    const core = flags.find((f) => f.id === "coreLanguageMismatch");

    expect(core).toBeUndefined();
    expect(flags.some((f) => (f.citedLanguages ?? []).includes("Go"))).toBe(false);
    for (const flag of flags) {
      expect(flag.message).not.toMatch(GO_PROSE_RE);
    }
  });

  it("4 — Optimizely scoring pipeline: no Go on output surfaces; stretch_signal (not referral_gated)", () => {
    const rules = evaluateRules(GO_FREE_JD, userProfile, { activeResumeType: "SWE" });
    const { recommendation, rules: outRules, survivabilityPenalties, keyRisks } =
      runOptimizelyScoringPipeline(rules);

    assertNoGoOnSurfaces(GO_FREE_JD, outRules, survivabilityPenalties, keyRisks);
    expect(recommendation).toBe("stretch_signal");
    expect(recommendation).not.toBe("referral_gated");
  });

  it("4b — phantom Go upstream leak is stripped before user-facing output", () => {
    const rules = phantomGoStackRules(
      evaluateRules(GO_FREE_JD, userProfile, { activeResumeType: "SWE" }),
    );
    const { recommendation, rules: outRules, survivabilityPenalties, keyRisks } =
      runOptimizelyScoringPipeline(rules);

    assertNoGoOnSurfaces(GO_FREE_JD, outRules, survivabilityPenalties, keyRisks);
    expect(outRules.hardRuleFlags?.some((f) => f.id === "coreLanguageMismatch")).toBe(
      false,
    );
    expect(recommendation).not.toBe("referral_gated");
    expect(["stretch_signal", "skip"]).toContain(recommendation);
  });
});
