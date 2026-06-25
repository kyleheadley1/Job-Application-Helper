import { describe, expect, it } from "vitest";
import {
  buildScoreDisplay,
  buildSurvivabilityRows,
  selectDominantLever,
} from "../../lib/scoreDisplayModel.js";
import { computeStrategicValue } from "../../lib/strategicLever.js";
import type { RuleEvaluation, SurvivabilityDisplayRow } from "../../types/scoring.js";
import type { SurvivabilityBreakdown } from "../../lib/survivabilityScore.js";

const RULES: RuleEvaluation = {
  explicitDegreeRisk: true,
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
  matureStructuredEmployer: true,
  productionBarCompetitivePool: false,
  notes: [],
};

const makeBreakdown = (overrides: Partial<SurvivabilityBreakdown>): SurvivabilityBreakdown => {
  const subFactors = {
    employerRecognizability: 0.4,
    credentialSignal: 0.4,
    impactMetricQuality: 0.32,
    resumeStoryCoherence: 0.6,
    domainMatchForListing: 0.45,
    poolFriendliness: 0.5,
    ...overrides,
  };
  let weightedAverage = 0;
  weightedAverage +=
    subFactors.employerRecognizability * 0.22 +
    subFactors.credentialSignal * 0.15 +
    subFactors.impactMetricQuality * 0.18 +
    subFactors.resumeStoryCoherence * 0.15 +
    subFactors.domainMatchForListing * 0.15 +
    subFactors.poolFriendliness * 0.15;
  return {
    ...subFactors,
    weightedAverage,
    multiplier: Math.min(1, Math.max(0.3, weightedAverage)),
  };
};

const rowsFromBreakdown = (breakdown: SurvivabilityBreakdown): SurvivabilityDisplayRow[] =>
  buildSurvivabilityRows(breakdown, RULES);

describe("strategicLever selection", () => {
  it("binding penalty at 0.45 outranks cosmetic penalty at 0.30", () => {
    expect(
      computeStrategicValue("binding", 0.45, "referral", true),
    ).toBeGreaterThan(computeStrategicValue("cosmetic", 0.3, "resume", true));

    const rows = rowsFromBreakdown(
      makeBreakdown({
        credentialSignal: 0.45,
        impactMetricQuality: 0.3,
        employerRecognizability: 0.85,
        domainMatchForListing: 0.85,
        resumeStoryCoherence: 0.85,
        poolFriendliness: 0.85,
      }),
    );
    const dominant = selectDominantLever(rows, RULES, true);
    expect(dominant?.key).toBe("credentialSignal");
    expect(dominant?.bindingness).toBe("binding");
  });

  it("collapses referral cluster and names highest-tier penalty in cluster", () => {
    const rows = rowsFromBreakdown(
      makeBreakdown({
        credentialSignal: 0.4,
        employerRecognizability: 0.28,
        impactMetricQuality: 0.32,
      }),
    );
    const dominant = selectDominantLever(rows, RULES, true);
    expect(dominant?.lever).toBe("referral");
    expect(dominant?.isCollapsedReferral).toBe(true);
    expect(dominant?.penaltyName).toBe("degree requirement");
  });

  it("stays stable when cosmetic sub-scores jitter below binding tier", () => {
    const metricJitter = [0.28, 0.32, 0.35, 0.29, 0.31];
    const selections = metricJitter.map((impactMetricQuality) => {
      const breakdown = makeBreakdown({
        credentialSignal: 0.4,
        employerRecognizability: 0.4,
        impactMetricQuality,
      });
      const rows = rowsFromBreakdown(breakdown);
      const dominant = selectDominantLever(rows, RULES, true);
      return {
        key: dominant?.key,
        penaltyName: dominant?.penaltyName,
        lever: dominant?.lever,
      };
    });

    for (const selection of selections) {
      expect(selection).toEqual({
        key: "credentialSignal",
        penaltyName: "degree requirement",
        lever: "referral",
      });
    }
  });

  it("action-line target penalty stays stable under jittered cosmetic scores", () => {
    const lines = [0.25, 0.32, 0.38, 0.29].map((impactMetricQuality) => {
      const breakdown = makeBreakdown({
        credentialSignal: 0.38,
        impactMetricQuality,
      });
      const display = buildScoreDisplay({
        score: {
          stackFit: 16,
          levelFit: 14,
          domainFit: 6,
          resumeStoryClarity: 6,
          functionalOverlap: 11,
          recruiterFriendliness: 10,
          careerValue: 7,
          capability: 75,
          survivability: breakdown.multiplier,
          survivabilityBreakdown: breakdown,
          total: 37,
        },
        rules: RULES,
        extracted: {
          company: "Aledade",
          title: "Software Engineer I",
          stack: [],
          requiredSkills: [],
          preferredSkills: [],
          domainTags: [],
          responsibilities: [],
          requirements: [],
        },
        recommendation: "referral_gated",
        referralPathwayAvailable: true,
        referralPathwayNotes: "Connection via Codesmith",
      });
      return display?.actionLine;
    });

    for (const line of lines) {
      expect(line).toMatch(/tailored|Strong shot|Worth applying/i);
      expect(line).not.toMatch(/impact metric quality/i);
      expect(line).not.toMatch(/Codesmith/i);
    }
    expect(new Set(lines).size).toBe(1);
  });
});
