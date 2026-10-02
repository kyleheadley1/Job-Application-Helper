import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import {
  deriveCandidateLocation,
  evaluateGeoEligibility,
  extractResidencyRadiusRequirement,
  jdOffersRelocationSupport,
} from "../../lib/geoEligibility.js";
import { extractTitleRegionFromTitle, resolveGeoScope } from "../../lib/geoScope.js";
import { evaluateHardGates } from "../../lib/hardGates.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { RuleEvaluation, ScoreBreakdown } from "../../types/scoring.js";
import type { UserProfile } from "../../types/userProfile.js";
import {
  loadCalibrationFixture,
  scoreCalibrationAnchor,
} from "../fixtures/calibrationAnchors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../fixtures/resumes/swe_resume.txt"),
  "utf8",
);

const CAPABILITY_SCORE: ScoreBreakdown = {
  stackFit: 16,
  levelFit: 14,
  domainFit: 6,
  resumeStoryClarity: 8,
  functionalOverlap: 11,
  recruiterFriendliness: 9,
  careerValue: 7,
  total: 0,
};

const REFLOW_GEO_JOB: ExtractedJobData = {
  company: "Reflow",
  title: "Junior Software Engineer - Latin America",
  location: "United States / Remote",
  remoteType: "remote",
  seniority: "junior",
  stack: ["Python", "Django"],
  requiredSkills: ["Python", "Django"],
  preferredSkills: [],
  domainTags: ["product"],
  responsibilities: ["Build Django REST APIs"],
  requirements: ["Python and Django experience"],
  rawText: `
Reflow — Junior Software Engineer - Latin America
United States / Remote
Build production Python/Django backends.
  `.trim(),
  geoScope: {
    titleRegion: "Latin America",
    postingLocation: "United States / Remote",
    cardLocation: "United States / Remote",
    remoteType: "remote",
  },
};

const compositeFor = (job: ExtractedJobData, rules: RuleEvaluation) => {
  const composite = computeCompositeScore({
    rawScore: CAPABILITY_SCORE,
    rules,
    extracted: job,
    profile: userProfile,
    resumeText: SWE_RESUME,
  });
  const display = buildScoreDisplay({
    score: composite.score,
    rules,
    extracted: job,
    recommendation: composite.recommendation,
    hardGateReasons: composite.hardGateReasons,
  });
  return { composite, display };
};

describe("geo scope extraction", () => {
  it("parses Latin America from title suffix", () => {
    expect(extractTitleRegionFromTitle("Junior Software Engineer - Latin America")).toBe(
      "Latin America",
    );
  });

  it("does not treat Mid-Level compound titles as a geo region", () => {
    expect(extractTitleRegionFromTitle("Mid-Level Software Engineer")).toBeNull();
    expect(extractTitleRegionFromTitle("Senior Software Engineer")).toBeNull();
  });

  it("resolveGeoScope captures title, card, and posting fields", () => {
    const scope = resolveGeoScope(REFLOW_GEO_JOB);
    expect(scope.titleRegion).toBe("Latin America");
    expect(scope.cardLocation).toBe("United States / Remote");
  });
});

describe("Reflow geo eligibility advisory", () => {
  it("fires soft verify flag; hard gates stay empty; score/band unchanged by flag", () => {
    const rules = evaluateRules(REFLOW_GEO_JOB, userProfile, { activeResumeType: "BASE" });
    expect(rules.eligibilityFlag).toBeDefined();
    expect(rules.eligibilityFlag?.lever).toBe("verify");
    expect(rules.eligibilityFlag?.severity).toBe("check");
    expect(rules.eligibilityFlag?.reason).toMatch(/Latin America/i);
    expect(rules.eligibilityFlag?.reason).toMatch(/United States \/ Remote/i);
    expect(rules.geoExclusionHardGate).toBe(false);

    const { composite, display } = compositeFor(REFLOW_GEO_JOB, rules);
    expect(display!.hardGates).toEqual([]);
    expect(display!.eligibilityAdvisory?.reason).toBe(rules.eligibilityFlag?.reason);
    expect(composite.hardGateFired).toBe(false);

    const rulesWithoutFlag: RuleEvaluation = { ...rules, eligibilityFlag: undefined };
    const baseline = compositeFor(REFLOW_GEO_JOB, rulesWithoutFlag);
    expect(composite.score.total).toBe(baseline.composite.score.total);
    expect(composite.scoreBand).toBe(baseline.composite.scoreBand);
    expect(display!.final).toBe(baseline.display!.final);
    expect(display!.bandHeadline).toBe(baseline.display!.bandHeadline);
  });
});

describe("explicit geographic exclusion", () => {
  const EXPLICIT_JOB: ExtractedJobData = {
    company: "LatAm Corp",
    title: "Software Engineer",
    location: "Remote",
    remoteType: "remote",
    stack: ["Python"],
    requiredSkills: ["Python"],
    preferredSkills: [],
    domainTags: [],
    responsibilities: [],
    requirements: ["Must be based in Latin America"],
    rawText: "Candidates must be located in Latin America. No sponsorship.",
  };

  it("becomes a hard gate for US-based candidate when no global-remote alternative", () => {
    const geo = evaluateGeoEligibility(EXPLICIT_JOB, userProfile);
    expect(geo.geoExclusionHardGate).toBe(true);

    const rules = evaluateRules(EXPLICIT_JOB, userProfile, { activeResumeType: "BASE" });
    expect(rules.geoExclusionHardGate).toBe(true);
    expect(rules.eligibilityFlag).toBeUndefined();

    const { composite, display } = compositeFor(EXPLICIT_JOB, rules);
    expect(composite.hardGateFired).toBe(true);
    expect(composite.recommendation).toBe("weak");
    expect(display!.hardGates.length).toBeGreaterThan(0);
    expect(display!.hardGates[0]).toMatch(/Latin America/i);
  });
});

describe("no geo flag when nothing to verify", () => {
  const US_JOB: ExtractedJobData = {
    company: "Acme",
    title: "Software Engineer",
    location: "United States / Remote",
    remoteType: "remote",
    stack: ["TypeScript"],
    requiredSkills: ["TypeScript"],
    preferredSkills: [],
    domainTags: [],
    responsibilities: [],
    requirements: [],
    rawText: "Remote US software engineer role.",
  };

  it("does not flag US role for US candidate with no title region", () => {
    const rules = evaluateRules(US_JOB, userProfile, { activeResumeType: "BASE" });
    expect(rules.eligibilityFlag).toBeUndefined();
    expect(rules.geoExclusionHardGate).toBe(false);
  });
});

describe("in-region candidate", () => {
  const LA_PROFILE: UserProfile = {
    ...userProfile,
    candidateLocation: {
      label: "São Paulo, Brazil",
      basedInUS: false,
      regions: ["Latin America", "Brazil"],
    },
  };

  const LA_TITLE_JOB: ExtractedJobData = {
    company: "Reflow",
    title: "Junior Software Engineer - Latin America",
    location: "United States / Remote",
    remoteType: "remote",
    stack: ["Python"],
    requiredSkills: ["Python"],
    preferredSkills: [],
    domainTags: [],
    responsibilities: [],
    requirements: [],
    rawText: "Junior Software Engineer - Latin America. Remote.",
    geoScope: {
      titleRegion: "Latin America",
      postingLocation: null,
      cardLocation: "United States / Remote",
      remoteType: "remote",
    },
  };

  it("does not flag when candidate is in the titled region", () => {
    const result = evaluateGeoEligibility(LA_TITLE_JOB, LA_PROFILE);
    expect(result.eligibilityFlag).toBeUndefined();
    expect(result.geoExclusionHardGate).toBe(false);
  });
});

describe("candidate location from profile", () => {
  it("uses structured candidateLocation when present", () => {
    const loc = deriveCandidateLocation(userProfile);
    expect(loc.label).toMatch(/Brooklyn|US/i);
    expect(loc.basedInUS).toBe(true);
  });
});

describe("Wex residency-radius hard gate (permanent fixture)", () => {
  const fixture = loadCalibrationFixture("wexSde1ResidencyRadiusGate");
  const WEX_JOB = fixture.extracted;

  it("parses present-tense must-reside-within-miles hubs", () => {
    const req = extractResidencyRadiusRequirement(WEX_JOB);
    expect(req).not.toBeNull();
    expect(req!.miles).toBe(30);
    expect(req!.hubMetroIds).toEqual(
      expect.arrayContaining([
        "portland_me",
        "boston",
        "chicago",
        "dallas",
        "sf_bay",
        "seattle",
      ]),
    );
    expect(jdOffersRelocationSupport(WEX_JOB)).toBe(false);
  });

  it("hard-gates Brooklyn/NYC candidate — same path as citizenship/clearance", () => {
    const geo = evaluateGeoEligibility(WEX_JOB, userProfile);
    expect(geo.geoExclusionHardGate).toBe(true);
    expect(geo.geoExclusionReason).toMatch(/30 miles/i);
    expect(geo.geoExclusionReason).toMatch(/Brooklyn|NY/i);

    const rules = evaluateRules(WEX_JOB, userProfile, { activeResumeType: "BASE" });
    expect(rules.geoExclusionHardGate).toBe(true);
    expect(rules.eligibilityFlag).toBeUndefined();

    const gates = evaluateHardGates(rules, WEX_JOB);
    expect(gates.fired).toBe(true);
    expect(gates.reasons.some((r) => /reside within 30 miles/i.test(r))).toBe(true);

    const { composite, display } = compositeFor(WEX_JOB, rules);
    expect(composite.hardGateFired).toBe(true);
    expect(composite.recommendation).toBe("weak");
    expect(composite.hardGateFired).toBe(true);
    expect(display!.hardGates.length).toBeGreaterThan(0);
    expect(display!.hardGates[0]).toMatch(/reside within 30 miles/i);
    expect(display!.hardGates[0]).not.toMatch(/None/i);
  });

  it("scoreCalibrationAnchor overrides inflated Apply to Weak (hard gate)", () => {
    const scored = scoreCalibrationAnchor("wexSde1ResidencyRadiusGate");
    expect(scored.rules.geoExclusionHardGate).toBe(true);
    expect(scored.recommendation).toBe("weak");
    expect(scored.score.recommendationLabel).toBe("Weak");
    expect(scored.score.scoreDisplay?.actionLine).toMatch(/^Weak — hard gate: /);
    expect(scored.score.scoreDisplay?.hardGates.length).toBeGreaterThan(0);
    expect(scored.score.scoreDisplay?.hardGates[0]).toMatch(/30 miles/i);
  });

  it("does not hard-gate when candidate metro is in the hub list", () => {
    const bostonProfile: UserProfile = {
      ...userProfile,
      candidateLocation: {
        label: "Boston, MA",
        basedInUS: true,
        regions: ["United States", "US", "Boston"],
      },
      locationPreferences: {
        ...userProfile.locationPreferences,
        primary: ["Boston", "Remote"],
      },
    };
    const geo = evaluateGeoEligibility(WEX_JOB, bostonProfile);
    expect(geo.geoExclusionHardGate).toBe(false);
  });

  it("softens to verify (not hard gate) when JD offers relocation assistance", () => {
    const withRelocation: ExtractedJobData = {
      ...WEX_JOB,
      rawText: `${WEX_JOB.rawText}\n\nBenefits\nRelocation assistance available for qualified candidates.`,
    };
    expect(jdOffersRelocationSupport(withRelocation)).toBe(true);
    const geo = evaluateGeoEligibility(withRelocation, userProfile);
    expect(geo.geoExclusionHardGate).toBe(false);
    expect(geo.eligibilityFlag?.lever).toBe("verify");
    expect(geo.eligibilityFlag?.reason).toMatch(/relocation/i);
  });
});

describe("residency radius vs Latin America region gate parity", () => {
  it("both fire hardGates and recommendation weak for US-based candidate", () => {
    const latAm: ExtractedJobData = {
      company: "LatAm Corp",
      title: "Software Engineer",
      location: "Remote",
      remoteType: "remote",
      stack: ["Python"],
      requiredSkills: ["Python"],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: ["Must be based in Latin America"],
      rawText: "Candidates must be located in Latin America.",
    };
    const wex = loadCalibrationFixture("wexSde1ResidencyRadiusGate").extracted;

    for (const job of [latAm, wex]) {
      const rules = evaluateRules(job, userProfile, { activeResumeType: "BASE" });
      expect(rules.geoExclusionHardGate).toBe(true);
      const { composite, display } = compositeFor(job, rules);
      expect(composite.hardGateFired).toBe(true);
      expect(composite.recommendation).toBe("weak");
      expect(display!.hardGates.length).toBeGreaterThan(0);
    }
  });
});
