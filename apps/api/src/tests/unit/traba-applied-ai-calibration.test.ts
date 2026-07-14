import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { evaluateHardGates } from "../../lib/hardGates.js";
import { computePoolFriendliness } from "../../lib/poolFriendliness.js";
import {
  detectRoleSeniorityOverreach,
  earlyCareerLevelVetoesSeniorityGate,
  explainSeniorityGateTrigger,
} from "../../lib/seniorityGate.js";
import {
  calibrationSweResumeContexts,
  fixtureToJobRecord,
  loadCalibrationFixture,
  scoreCalibrationAnchor,
} from "../fixtures/calibrationAnchors.js";

const TRABA_FIXTURE = loadCalibrationFixture("trabaAppliedAi");
const TRABA_JOB = TRABA_FIXTURE.extracted;

describe("Traba Applied AI calibration", () => {
  it("early-career veto blocks seniority gate despite architect verb and founding context in body", () => {
    expect(earlyCareerLevelVetoesSeniorityGate(TRABA_JOB)).toBe(true);
    expect(detectRoleSeniorityOverreach(TRABA_JOB)).toBe(false);

    const rules = evaluateRules(TRABA_JOB, userProfile, { activeResumeType: "SWE" });
    expect(rules.seniorityOverreach).toBe(false);
    expect(evaluateHardGates(rules, TRABA_JOB).fired).toBe(false);
    expect(rules.foundingEngineerStretch).toBe(true);
  });

  it("re-scores without hard gate; favorable pool; apply-band final with survivability dings", () => {
    const scored = scoreCalibrationAnchor("trabaAppliedAi");

    expect(scored.rules.seniorityOverreach).toBe(false);
    expect(scored.score.scoreDisplay?.hardGates ?? []).toEqual([]);
    expect(scored.score.survivability).toBeGreaterThanOrEqual(0.5);
    expect(scored.score.survivability).toBeLessThanOrEqual(0.58);
    expect(scored.poolFriendliness).toBeGreaterThanOrEqual(0.83);
    expect(scored.poolFriendliness).toBeLessThanOrEqual(0.92);
    expect(scored.score.total!).toBeGreaterThanOrEqual(74);
    expect(scored.score.total!).toBeLessThanOrEqual(86);

    const display = scored.score.scoreDisplay!;
    expect(display.final).toBe(scored.score.total);
    expect(display.final).toBeGreaterThanOrEqual(74);
    expect(display.scoreBand).not.toBe("no");
    expect(display.scoreBand).not.toBe("skip");
    expect(display.bandHeadline).not.toBe("Skip");
    expect(display.actionLine.toLowerCase()).not.toMatch(/^do not apply|^not worth the effort/);
    expect(display.referralUrgency).toMatch(/strongly_advised|advised|optional/);
  });

  it("vetoes gate when body polluted seniority=senior but rawText header has Mid Level", () => {
    const polluted = { ...TRABA_JOB, seniority: "senior" as const };
    expect(earlyCareerLevelVetoesSeniorityGate(polluted)).toBe(true);
    expect(detectRoleSeniorityOverreach(polluted)).toBe(false);

    const rules = evaluateRules(polluted, userProfile, { activeResumeType: "SWE" });
    expect(rules.seniorityOverreach).toBe(false);
    expect(evaluateHardGates(rules, polluted).fired).toBe(false);
    expect(evaluateHardGates(rules, polluted).reasons).toEqual([]);

    const trigger = explainSeniorityGateTrigger(polluted, { seniorityOverreach: true });
    expect(trigger.vetoed).toBe(true);
    expect(trigger.resolvedLevel).toMatch(/mid level/i);
    expect(trigger.parsedSeniorityField).toBe("senior");
  });
});

describe("seniority gate guard — junior/mid + years ≤4", () => {
  it("never hard-gates regardless of responsibilities prose", () => {
    const polluted = {
      ...TRABA_JOB,
      title: "Architect core systems and founding engineer pipelines",
      responsibilities: [
        "Architect core systems",
        "Lead the architecture for founding team",
        "Own the architecture end to end",
        "founding engineer expectations",
      ],
      rawText:
        "Architect core systems. founding team. founding engineer. lead the architecture. own the architecture.",
    };
    const rules = evaluateRules(polluted, userProfile, { activeResumeType: "SWE" });
    expect(rules.seniorityOverreach).toBe(false);
    expect(evaluateHardGates(rules, polluted).fired).toBe(false);
  });
});

describe("Speechify-style Tech Lead — veto must not leak to genuine senior roles", () => {
  it("still hard-gates Tech Lead title without junior/mid structured level", () => {
    const speechifyLead = {
      company: "Speechify",
      title: "Tech Lead",
      yearsExperience: { min: 5, raw: "5+ years" },
      rawText: "Speechify\nTech Lead\n5+ years exp\nRemote\nBuild voice AI platform.",
    };
    expect(earlyCareerLevelVetoesSeniorityGate(speechifyLead)).toBe(false);
    expect(detectRoleSeniorityOverreach(speechifyLead)).toBe(true);

    const rules = evaluateRules(speechifyLead, userProfile, { activeResumeType: "SWE" });
    expect(rules.seniorityOverreach).toBe(true);
    const gate = evaluateHardGates(rules, speechifyLead);
    expect(gate.fired).toBe(true);
    expect(gate.reasons).toContain("Role seniority/staff bar exceeds early-career profile.");

    const trigger = explainSeniorityGateTrigger(speechifyLead, rules);
    expect(trigger.vetoed).toBe(false);
    expect(trigger.triggerSource).toBe("title");
    expect(trigger.triggerDetail).toBe("Tech Lead");
  });
});
