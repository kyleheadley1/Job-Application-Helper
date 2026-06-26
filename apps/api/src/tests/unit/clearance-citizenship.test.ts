import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import {
  classifyClearanceTiming,
  evaluateClearanceCitizenship,
  resolveClearanceRequirement,
} from "../../lib/clearanceCitizenship.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { evaluateHardGates } from "../../lib/hardGates.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { ScoreBreakdown } from "../../types/scoring.js";
import type { UserProfile } from "../../types/userProfile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

const TRIA_JOB: ExtractedJobData = {
  company: "Tria Federal",
  title: "Software Engineer",
  location: "Remote",
  remoteType: "remote",
  stack: ["TypeScript", "Node.js", "Python", "AWS"],
  requiredSkills: ["TypeScript", "Python"],
  preferredSkills: ["AWS"],
  domainTags: ["federal"],
  citizenshipRequirement: "Must be a U.S. citizen due to the security clearance required for this position.",
  clearanceRequirement: {
    required: true,
    timing: "sponsorable",
    raw: "security clearance required for this position",
  },
  responsibilities: ["Build software for federal clients"],
  requirements: [
    "Must be a U.S. citizen due to the security clearance required for this position.",
    "Strong TypeScript and Python experience",
  ],
  rawText: `
Tria Federal — Software Engineer
Remote
Must be a U.S. citizen due to the security clearance required for this position.
Strong TypeScript and Python experience.
  `.trim(),
};

const TRIA_RAW: ScoreBreakdown = {
  stackFit: 17,
  levelFit: 15,
  domainFit: 6,
  resumeStoryClarity: 8,
  functionalOverlap: 14,
  recruiterFriendliness: 10,
  careerValue: 8,
  total: 0,
};

const ACTIVE_CLEARANCE_JOB: ExtractedJobData = {
  company: "Defense Corp",
  title: "Software Engineer",
  location: "Remote",
  remoteType: "remote",
  stack: ["Java"],
  requiredSkills: ["Java"],
  preferredSkills: [],
  domainTags: [],
  requirements: ["Active TS/SCI clearance required"],
  rawText: "Active TS/SCI clearance required. Java experience.",
  clearanceRequirement: {
    required: true,
    timing: "active_upfront",
    raw: "Active TS/SCI clearance required",
  },
};

const compositeFor = (job: ExtractedJobData, rules: ReturnType<typeof evaluateRules>) =>
  computeCompositeScore({
    rawScore: TRIA_RAW,
    rules,
    extracted: job,
    profile: userProfile,
    resumeText: SWE_RESUME,
  });

describe("clearance timing classification", () => {
  it("classifies Tria phrasing as sponsorable", () => {
    expect(
      classifyClearanceTiming(
        "Must be a U.S. citizen due to the security clearance required for this position.",
        "Must be a U.S. citizen",
      ),
    ).toBe("sponsorable");
  });

  it("classifies active/current language as active_upfront", () => {
    expect(classifyClearanceTiming("Active TS/SCI clearance required")).toBe("active_upfront");
    expect(classifyClearanceTiming("Must already hold an active clearance")).toBe("active_upfront");
  });

  it("defaults bare clearance required to unspecified (treated as sponsorable)", () => {
    expect(classifyClearanceTiming("Security clearance required")).toBe("unspecified");
    const resolved = resolveClearanceRequirement({
      ...TRIA_JOB,
      rawText: "Security clearance required",
      citizenshipRequirement: undefined,
      clearanceRequirement: undefined,
      requirements: ["Security clearance required"],
    });
    expect(resolved?.timing).toBe("unspecified");
  });
});

describe("Tria Federal — citizen + sponsorable clearance", () => {
  it("passes citizenship, soft clearance flag, no hard gates, apply band", () => {
    const rules = evaluateRules(TRIA_JOB, userProfile, { activeResumeType: "SWE" });
    expect(rules.citizenshipMismatch).toBe(false);
    expect(rules.clearanceMismatch).toBe(false);
    expect(rules.clearanceEligibilityFlag).toBeDefined();
    expect(rules.clearanceEligibilityFlag?.reason).toMatch(/sponsorable/i);

    const composite = compositeFor(TRIA_JOB, rules);
    expect(composite.hardGateFired).toBe(false);
    expect(composite.recommendation).not.toBe("no");
    expect(composite.scoreBand).not.toBe("no");
    expect(composite.score.capability).toBeGreaterThanOrEqual(78);

    const display = buildScoreDisplay({
      score: composite.score,
      rules,
      extracted: TRIA_JOB,
      recommendation: composite.recommendation,
    });
    expect(display?.hardGates).toEqual([]);
    expect(display?.eligibilityAdvisories?.some((a) => a.reason.match(/clearance/i))).toBe(true);
    expect(display?.bandHeadline).toMatch(/Yes|Strong yes/);
  });
});

describe("citizenship hard gate", () => {
  it("fires when US citizenship required and candidate is not a citizen", () => {
    const nonCitizen: UserProfile = {
      ...userProfile,
      citizenshipStatus: { isUSCitizen: false },
    };
    const result = evaluateClearanceCitizenship(TRIA_JOB, nonCitizen);
    expect(result.citizenshipMismatch).toBe(true);
    expect(result.clearanceEligibilityFlag).toBeUndefined();

    const rules = evaluateRules(TRIA_JOB, nonCitizen, { activeResumeType: "SWE" });
    const gates = evaluateHardGates(rules, TRIA_JOB);
    expect(gates.fired).toBe(true);
    expect(gates.reasons.some((r) => /citizenship/i.test(r))).toBe(true);
  });

  it("passes when citizenship required and candidate is a citizen", () => {
    const result = evaluateClearanceCitizenship(TRIA_JOB, userProfile);
    expect(result.citizenshipMismatch).toBe(false);
  });
});

describe("active clearance hard gate", () => {
  it("hard gates when active clearance required and candidate lacks one", () => {
    const rules = evaluateRules(ACTIVE_CLEARANCE_JOB, userProfile, { activeResumeType: "SWE" });
    expect(rules.clearanceMismatch).toBe(true);
    expect(rules.clearanceEligibilityFlag).toBeUndefined();

    const composite = compositeFor(ACTIVE_CLEARANCE_JOB, rules);
    expect(composite.hardGateFired).toBe(true);
    expect(composite.recommendation).toBe("no");
  });
});

describe("clearance soft flag score isolation", () => {
  it("does not change capability, survivability, dock, final, or band", () => {
    const rules = evaluateRules(TRIA_JOB, userProfile, { activeResumeType: "SWE" });
    const withFlag = buildScoreDisplay({
      score: compositeFor(TRIA_JOB, rules).score,
      rules,
      extracted: TRIA_JOB,
      recommendation: "apply_cold",
    });
    const withoutFlag = buildScoreDisplay({
      score: compositeFor(TRIA_JOB, rules).score,
      rules: { ...rules, clearanceEligibilityFlag: undefined },
      extracted: TRIA_JOB,
      recommendation: "apply_cold",
    });

    for (const field of [
      "capability",
      "survivability",
      "final",
      "survAdjustment",
      "gapDock",
      "scoreBand",
      "bandHeadline",
    ] as const) {
      expect(withFlag![field]).toBe(withoutFlag![field]);
    }
    expect(withFlag!.eligibilityAdvisories?.length).toBeGreaterThan(
      withoutFlag!.eligibilityAdvisories?.length ?? 0,
    );
  });
});
