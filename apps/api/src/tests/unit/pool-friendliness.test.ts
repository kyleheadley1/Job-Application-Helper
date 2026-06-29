import { describe, expect, it } from "vitest";
import { userProfile } from "../../config/userProfile.js";
import { POOL_FRIENDLINESS } from "../../config/capabilitySurvivabilityPolicy.js";
import { recomputeStoredJobScore, storedCategoryScores } from "../../lib/recomputeStoredJobScore.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import {
  computePoolFriendliness,
  scoreListingEmployerRecognizability,
} from "../../lib/poolFriendliness.js";
import { countTechCanonOverlap } from "../../lib/techCanon.js";
import { computeSurvivability } from "../../lib/survivabilityScore.js";
import {
  countDifferentiatorTags,
  evaluateDifferentiatorCoverage,
} from "../../lib/differentiatorCoverage.js";
import type { ExtractedJobData, JobRecord } from "../../types/job.js";
import type { RuleEvaluation, ScoreBreakdown } from "../../types/scoring.js";

const cleanRules = (): RuleEvaluation => ({
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

/** Real Cherry Hill Programs listing shape (holiday photography, scraped JD). */
const CHERRY_HILL_PROGRAMS_JOB: ExtractedJobData = {
  company: "Cherry Hill Programs",
  companyDisplayName: "Cherry Hill Programs",
  title: "Full Stack Developer -TypeScript - React - AWS (Remote)",
  location: "United States",
  remoteType: "remote",
  seniority: "junior",
  stack: [
    "TypeScript",
    "React",
    "PostgreSQL",
    "GraphQL",
    "AWS S3",
    "AWS DynamoDB",
    "AWS Lambda",
    "AWS CloudWatch",
    "AWS EventBridge",
    "Docker",
  ],
  requiredSkills: ["TypeScript", "React", "PostgreSQL", "GraphQL", "AWS"],
  preferredSkills: [],
  requirements: ["TypeScript", "React", "PostgreSQL", "GraphQL", "AWS"],
  rawText: `
Cherry Hill Programs
· 2 days ago
Full Stack Developer -TypeScript - React - AWS (Remote)
United States · Remote · Entry Level
$95K/yr - $105K/yr
When you reach out via email instead of linkedin. Beyond your network.
Build full-stack features with TypeScript, React, PostgreSQL, GraphQL, AWS Lambda, DynamoDB.
  `.trim(),
};

const CATTLE_CALL_CONTROL_JOB: ExtractedJobData = {
  company: "Civis Analytics",
  companyDisplayName: "Civis Analytics",
  title: "Software Engineer",
  location: "Remote",
  remoteType: "remote",
  seniority: "junior",
  stack: ["React", "TypeScript", "JavaScript"],
  requiredSkills: ["React", "TypeScript"],
  preferredSkills: ["JavaScript"],
  requirements: ["React", "TypeScript", "JavaScript"],
  rawText: `
Civis Analytics — Software Engineer
Remote · Entry Level · Posted 2 days ago
Well-known AI analytics startup. React and TypeScript required.
  `.trim(),
};

const CHERRY_HILL_STORED_SCORE: ScoreBreakdown = {
  stackFit: 17,
  levelFit: 18,
  domainFit: 7,
  resumeStoryClarity: 9,
  functionalOverlap: 13,
  recruiterFriendliness: 13,
  careerValue: 8,
  total: 66,
};

function cherryHillJobRecord(): JobRecord {
  return {
    id: "cherry-hill-programs-test",
    extracted: CHERRY_HILL_PROGRAMS_JOB,
    rules: cleanRules(),
    score: CHERRY_HILL_STORED_SCORE,
    recommendation: "referral_gated",
    salaryAsk: {},
    recommendedResume: "SWE",
    resumeRationale: [],
    topMatch: "Match",
    mainRisk: "Risk",
    rationale: [],
    risks: [],
    generated: {},
    tracker: {
      priority: "medium",
      recommendedAction: "Apply",
      statusOutcome: "referral_gated",
      shortlist: false,
      color: "gray",
    },
    status: "to_review",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("differentiator auth guard", () => {
  it("does not count work authorization as auth differentiator", () => {
    const blob =
      "Must be legally authorized to work in the United States. React and GraphQL on AWS.";
    const { matchedTags } = countDifferentiatorTags(blob);
    expect(matchedTags).not.toContain("auth");
    expect(matchedTags).not.toContain("authentication");
    expect(matchedTags).not.toContain("oauth");
  });

  it("still counts authentication-context terms", () => {
    const { matchedTags } = countDifferentiatorTags("OAuth2 authentication flow with JWT sessions");
    expect(matchedTags.some((t) => /oauth|authentication|jwt|session/i.test(t))).toBe(true);
  });
});

describe("Cherry Hill Programs pool inputs", () => {
  it("employerRecognizability ~0.30 despite linkedin boilerplate in rawText", () => {
    const rec = scoreListingEmployerRecognizability(CHERRY_HILL_PROGRAMS_JOB);
    expect(rec).toBeGreaterThanOrEqual(0.28);
    expect(rec).toBeLessThanOrEqual(0.32);
    expect(rec).toBe(POOL_FRIENDLINESS.DEFAULT_EMPLOYER_RECOGNIZABILITY);
  });

  it("fires favorable adjustments, not brand/generic penalties", () => {
    const pool = computePoolFriendliness(CHERRY_HILL_PROGRAMS_JOB, userProfile);
    const ids = pool.adjustments.map((a) => a.id);
    expect(ids).toContain("nicheEmployer");
    expect(ids).toContain("differentiatorRole");
    expect(ids).toContain("specificStack");
    expect(ids).not.toContain("brandEmployer");
    expect(ids).not.toContain("genericStackOnly");
    expect(pool.score).toBeGreaterThanOrEqual(0.68);
    expect(pool.score).toBeLessThanOrEqual(0.78);
    expect(pool.bindingness).toBe("favorable");
  });

  it("differentiator tags include cloud/backend terms from stack", () => {
    const { count, matchedTags } = countDifferentiatorTags(
      [
        CHERRY_HILL_PROGRAMS_JOB.rawText ?? "",
        ...(CHERRY_HILL_PROGRAMS_JOB.stack ?? []),
      ].join("\n"),
    );
    expect(count).toBeGreaterThanOrEqual(1);
    expect(matchedTags.some((t) => ["aws", "graphql", "lambda", "postgresql"].includes(t))).toBe(true);
    expect(evaluateDifferentiatorCoverage(CHERRY_HILL_PROGRAMS_JOB).tier).not.toBe("none");
  });

  it("specific-stack overlap ≥4 with alias normalization", () => {
    const listing = [
      ...(CHERRY_HILL_PROGRAMS_JOB.stack ?? []),
      ...(CHERRY_HILL_PROGRAMS_JOB.requiredSkills ?? []),
    ].join(" ");
    const candidate = [
      ...userProfile.strengths,
      ...userProfile.flagshipProjects.flatMap((p) => p.tech),
      ...(userProfile.certifications ?? []).flatMap((c) => c.relatedSkills ?? []),
    ].join(" ");
    expect(countTechCanonOverlap(listing, candidate)).toBeGreaterThanOrEqual(4);
  });

  it("recomputed final lands ~82–84", () => {
    const next = recomputeStoredJobScore({ job: cherryHillJobRecord() });
    expect(next.score.survivabilityBreakdown?.poolFriendliness).toBeGreaterThanOrEqual(0.68);
    expect(next.score.total).toBeGreaterThanOrEqual(80);
    expect(next.score.total).toBeLessThanOrEqual(86);
  });
});

describe("cattle-call control (recognizable startup, not FAANG brand list)", () => {
  it("cattle-call shape → crowded pool ~0.35–0.42", () => {
    const pool = computePoolFriendliness(CATTLE_CALL_CONTROL_JOB, userProfile);
    const ids = pool.adjustments.map((a) => a.id);
    expect(ids).toContain("cattleCall");
    expect(ids).not.toContain("brandEmployer");
    expect(scoreListingEmployerRecognizability(CATTLE_CALL_CONTROL_JOB)).toBe(0.3);
    expect(pool.score).toBeGreaterThanOrEqual(0.33);
    expect(pool.score).toBeLessThanOrEqual(0.42);
    expect(pool.lever).toBe("referral");
  });

  it("Cherry Hill Programs and cattle-call control diverge strongly", () => {
    const cherry = computePoolFriendliness(CHERRY_HILL_PROGRAMS_JOB, userProfile).score;
    const cattle = computePoolFriendliness(CATTLE_CALL_CONTROL_JOB, userProfile).score;
    expect(cherry - cattle).toBeGreaterThanOrEqual(0.25);
  });
});

describe("pool friendliness display", () => {
  it("renders favorable pool row in score display", () => {
    const rawScore: ScoreBreakdown = {
      ...CHERRY_HILL_STORED_SCORE,
      total: 0,
      capability: 71,
    };
    const surv = computeSurvivability({
      extracted: CHERRY_HILL_PROGRAMS_JOB,
      rules: cleanRules(),
      profile: userProfile,
      rawScore,
    });
    const display = buildScoreDisplay({
      score: {
        ...rawScore,
        survivability: surv.multiplier,
        survivabilityBreakdown: surv,
      },
      rules: cleanRules(),
      extracted: CHERRY_HILL_PROGRAMS_JOB,
      recommendation: "referral_gated",
    });
    const poolRow = display?.survivabilityRows.find((r) => r.key === "poolFriendliness");
    expect(poolRow?.bindingness).toBe("favorable");
    expect(display?.poolFriendlinessNote).toMatch(/Pool shape:/);
  });
});
