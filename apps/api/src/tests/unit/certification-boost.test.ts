import { describe, expect, it } from "vitest";
import { userProfile } from "../../config/userProfile.js";
import { computeDegreeGapDock } from "../../lib/degreeGap.js";
import {
  applyCertificationBoost,
  CERT_BOOST_LAPSED,
  countCertListingOverlap,
  findBestRelevantCert,
} from "../../lib/certificationBoost.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { evaluateHardGates } from "../../lib/hardGates.js";
import { deriveReferralAdvice } from "../../lib/referralAdvice.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import { computeSurvivability, scoreCredentialSignal } from "../../lib/survivabilityScore.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { RuleEvaluation, ScoreBreakdown } from "../../types/scoring.js";
import type { UserProfile } from "../../types/userProfile.js";

const CHERRY_HILL_JOB: ExtractedJobData = {
  company: "Township of Cherry Hill",
  title: "Cloud Applications Developer",
  location: "Cherry Hill, NJ",
  remoteType: "hybrid",
  seniority: "mid",
  stack: ["AWS", "Lambda", "DynamoDB", "S3", "CloudWatch", "EventBridge", "API Gateway", "IAM"],
  requiredSkills: ["AWS Lambda", "DynamoDB", "S3", "CloudWatch", "EventBridge"],
  preferredSkills: ["SQS", "SNS"],
  domainTags: ["government"],
  responsibilities: [
    "Build serverless applications on AWS Lambda and DynamoDB",
    "Monitor workloads with CloudWatch and EventBridge",
  ],
  requirements: [
    "Bachelor's degree in Computer Science or related field required",
    "Experience with AWS Lambda, DynamoDB, S3, CloudWatch, and EventBridge",
  ],
  rawText: `
Township of Cherry Hill — Cloud Applications Developer
Cherry Hill, NJ
Build AWS serverless apps: Lambda, DynamoDB, S3, CloudWatch, EventBridge, API Gateway, IAM.
Bachelor's degree required. No equivalency.
  `.trim(),
};

const CHERRY_HILL_RULES: RuleEvaluation = {
  explicitDegreeRisk: true,
  traditionalCompanyPenalty: true,
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
  matureStructuredEmployer: true,
  productionBarCompetitivePool: false,
  degreeHasEquivalencyClause: false,
  notes: [],
};

const RAW_SCORE: ScoreBreakdown = {
  stackFit: 15,
  levelFit: 14,
  domainFit: 6,
  resumeStoryClarity: 8,
  functionalOverlap: 12,
  recruiterFriendliness: 9,
  careerValue: 7,
  total: 0,
};

const profileWithoutCerts = (): UserProfile => {
  const { certifications: _certs, ...rest } = userProfile;
  return rest;
};

describe("certification overlap detection", () => {
  it("matches normalized service names against listing stack", () => {
    const awsCert = userProfile.certifications![0];
    const { count, matchedSkills } = countCertListingOverlap(awsCert, `
      aws lambda dynamodb s3 cloudwatch eventbridge api gateway iam sqs
    `);
    expect(count).toBeGreaterThanOrEqual(5);
    expect(matchedSkills).toEqual(
      expect.arrayContaining(["S3", "DynamoDB", "Lambda", "CloudWatch", "EventBridge"]),
    );
  });

  it("takes the single best-matching cert only", () => {
    const profile: UserProfile = {
      ...userProfile,
      certifications: [
        ...(userProfile.certifications ?? []),
        {
          name: "LPI Linux Essentials",
          issuer: "LPI",
          status: "active",
          relatedSkills: ["Linux", "bash"],
        },
      ],
    };
    const match = findBestRelevantCert(profile, CHERRY_HILL_JOB);
    expect(match?.certName).toMatch(/AWS Developer/i);
    expect(match?.overlapCount).toBeGreaterThanOrEqual(5);
  });
});

describe("Cherry Hill — AWS cert boost", () => {
  it("raises credentialSignal from 0.40 to ~0.50 with lapsed AWS cert", () => {
    const base = scoreCredentialSignal(userProfile, CHERRY_HILL_RULES);
    expect(base).toBe(0.4);

    const boosted = applyCertificationBoost(base, userProfile, CHERRY_HILL_JOB);
    expect(boosted.boost).toBeDefined();
    expect(boosted.boost?.boost).toBe(CERT_BOOST_LAPSED);
    expect(boosted.score).toBeCloseTo(0.5, 2);
  });

  it("re-tags credential row as credential/material and softens referral urgency", () => {
    const survivability = computeSurvivability({
      extracted: CHERRY_HILL_JOB,
      rules: CHERRY_HILL_RULES,
      profile: userProfile,
      rawScore: RAW_SCORE,
      resumeText: "TypeScript Node engineer with AWS project work",
    });

    expect(survivability.credentialSignal).toBeCloseTo(0.5, 2);
    expect(survivability.certificationBoost?.note).toMatch(/AWS Developer/i);
    expect(survivability.certificationBoost?.note).toMatch(/S3, DynamoDB, Lambda/i);

    const composite = computeCompositeScore({
      rawScore: RAW_SCORE,
      rules: CHERRY_HILL_RULES,
      extracted: CHERRY_HILL_JOB,
      profile: userProfile,
      resumeText: "TypeScript Node engineer with AWS project work",
    });

    const display = buildScoreDisplay({
      score: composite.score,
      rules: CHERRY_HILL_RULES,
      extracted: CHERRY_HILL_JOB,
      recommendation: composite.recommendation,
    });

    const credentialRow = display?.survivabilityRows.find((r) => r.key === "credentialSignal");
    expect(credentialRow?.score).toBeCloseTo(0.5, 2);
    expect(credentialRow?.lever).toBe("credential");
    expect(credentialRow?.bindingness).toBe("material");
    expect(credentialRow?.leverLabel).toMatch(/relevant cert \(lapsed\)/i);
    expect(display?.credentialBoostNote).toMatch(/Credential boost:/i);

    const withoutCert = computeSurvivability({
      extracted: CHERRY_HILL_JOB,
      rules: CHERRY_HILL_RULES,
      profile: profileWithoutCerts(),
      rawScore: RAW_SCORE,
      resumeText: "TypeScript Node engineer with AWS project work",
    });
    const referralWithCert = deriveReferralAdvice({ survivabilityBreakdown: survivability });
    const referralWithoutCert = deriveReferralAdvice({ survivabilityBreakdown: withoutCert });
    expect(referralWithoutCert.urgency).toBe("strongly_advised");
    expect(referralWithCert.urgency).toBe("advised");
  });

  it("does not satisfy degree hard gates or reduce degree dock", () => {
    const withCertDock = computeDegreeGapDock(CHERRY_HILL_RULES, userProfile);
    const withoutCertDock = computeDegreeGapDock(CHERRY_HILL_RULES, profileWithoutCerts());
    expect(withCertDock).toBe(withoutCertDock);
    expect(withCertDock).toBeGreaterThan(0);

    const gates = evaluateHardGates(CHERRY_HILL_RULES, CHERRY_HILL_JOB);
    expect(gates.fired).toBe(false);
    expect(CHERRY_HILL_RULES.explicitDegreeRisk).toBe(true);
  });
});

describe("certification boost guardrails", () => {
  it("does not stack multiple certs additively", () => {
    const profile: UserProfile = {
      ...userProfile,
      certifications: [
        {
          name: "AWS Developer – Associate",
          issuer: "AWS",
          status: "lapsed",
          relatedSkills: ["AWS", "S3", "DynamoDB", "Lambda", "CloudWatch", "EventBridge"],
        },
        {
          name: "AWS Solutions Architect – Associate",
          issuer: "AWS",
          status: "active",
          relatedSkills: ["AWS", "S3", "DynamoDB", "Lambda", "CloudWatch", "EventBridge", "VPC"],
        },
      ],
    };
    const base = 0.4;
    const boosted = applyCertificationBoost(base, profile, CHERRY_HILL_JOB);
    expect(boosted.score).toBeCloseTo(0.55, 2);
    expect(boosted.boost?.boost).toBe(0.15);
  });
});
