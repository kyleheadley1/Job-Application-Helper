import { describe, expect, it } from "vitest";
import { userProfile } from "../../config/userProfile.js";
import {
  computeDegreeGapDock,
  DEGREE_DOCK_BY_TIER,
  resolveDegreeGapTier,
} from "../../lib/degreeGap.js";
import { evaluateHardGates } from "../../lib/hardGates.js";
import { buildSurvivabilityPenalties } from "../../lib/scoreDisplayModel.js";
import {
  differentiatorTagsForFixture,
  loadCalibrationFixture,
  scoreCalibrationAnchor,
} from "../fixtures/calibrationAnchors.js";

describe("calibration anchors", () => {
  it("ANCHOR 1 (Cherry Hill): favorable specific-match shape — brand-regex-on-name-only + cloud differentiator tags", () => {
    const scored = scoreCalibrationAnchor("cherryHill");
    const { score } = scored;

    expect(
      scored.employerRecognizability,
      "ANCHOR 1 (Cherry Hill): employerRecognizability above 0.40 — brand detection regressed (rawText leak or linkedin/twitter false brand)",
    ).toBeLessThanOrEqual(0.4);

    expect(
      scored.poolFriendliness,
      "ANCHOR 1 (Cherry Hill): poolFriendliness below favorable floor — brand detection or differentiator tags regressed",
    ).toBeGreaterThanOrEqual(0.68);
    expect(
      scored.poolFriendliness,
      "ANCHOR 1 (Cherry Hill): poolFriendliness above favorable ceiling — pool shape bonuses over-applied",
    ).toBeLessThanOrEqual(0.8);

    expect(
      scored.poolFriendlinessLever,
      "ANCHOR 1 (Cherry Hill): poolFriendliness lever is referral — favorable pool should not render as crowded cattle-call",
    ).not.toBe("referral");

    expect(
      score.capability,
      "ANCHOR 1 (Cherry Hill): capability below 84 — differentiator cap lift regressed (cloud/graphql tags missing)",
    ).toBeGreaterThanOrEqual(84);

    expect(
      score.total,
      "ANCHOR 1 (Cherry Hill): final below 82 — composite rescoring regressed on favorable specific-match shape",
    ).toBeGreaterThanOrEqual(82);
    expect(
      score.total,
      "ANCHOR 1 (Cherry Hill): final above 87 — composite overshoot on favorable specific-match shape",
    ).toBeLessThanOrEqual(87);

    expect(scored.poolAdjustments).toContain("differentiatorRole");
    expect(scored.differentiatorCoverage.tier).toBe("strong");
  });

  it("ANCHOR 2 (Fubo): frontend-only capability cap — tag list must not be too permissive", () => {
    const scored = scoreCalibrationAnchor("fuboFrontend");
    const breakdown = scored.score.capabilityBreakdown;
    const { differentiatorCoverage } = scored;

    expect(
      ["partial", "none"].includes(differentiatorCoverage.tier),
      "ANCHOR 2 (Fubo): differentiator coverage classified strong — frontend-only JD should stay partial/none",
    ).toBe(true);

    expect(
      breakdown?.stackFit,
      "ANCHOR 2 (Fubo): stackFit above 30 — differentiator cap not biting on frontend-only shape",
    ).toBeLessThanOrEqual(30);
    expect(
      breakdown?.functionalOverlap,
      "ANCHOR 2 (Fubo): functionalOverlap above 30 — differentiator cap not biting on frontend-only shape",
    ).toBeLessThanOrEqual(30);

    expect(
      scored.score.capability,
      "ANCHOR 2 (Fubo): capability above 80 — cap lifted; frontend-only should land high 70s not high 80s",
    ).toBeLessThanOrEqual(80);
    expect(
      scored.score.capability,
      "ANCHOR 2 (Fubo): capability below 68 — stored category scores or cap floor regressed",
    ).toBeGreaterThanOrEqual(68);

    expect(
      scored.score.total,
      "ANCHOR 2 (Fubo): final below 70 — capability/survivability composite regressed on frontend-only cap shape",
    ).toBeGreaterThanOrEqual(70);
    expect(
      scored.score.total,
      "ANCHOR 2 (Fubo): final above 80 — frontend-only cap should not reach high-80s final band",
    ).toBeLessThanOrEqual(80);
  });

  it("ANCHOR 3 (Civis): remote cattle-call shape — crowded pool, referral lever, niche bonus skipped", () => {
    const scored = scoreCalibrationAnchor("civisCattleCall");
    const cherry = scoreCalibrationAnchor("cherryHill");

    expect(
      scored.poolFriendliness,
      "ANCHOR 3 (Civis): poolFriendliness below crowded floor — cattle-call branching regressed",
    ).toBeGreaterThanOrEqual(0.3);
    expect(
      scored.poolFriendliness,
      "ANCHOR 3 (Civis): poolFriendliness above crowded ceiling — cattle-call penalty missing or niche bonus leaked",
    ).toBeLessThanOrEqual(0.45);

    expect(
      scored.poolFriendlinessLever,
      "ANCHOR 3 (Civis): poolFriendliness lever is not referral — crowded cattle-call shape regressed",
    ).toBe("referral");

    expect(
      scored.poolAdjustments,
      "ANCHOR 3 (Civis): cattle-call adjustment missing — listing-shape branch regressed",
    ).toContain("cattleCall");
    expect(
      scored.poolAdjustments,
      "ANCHOR 3 (Civis): nicheEmployer bonus applied on cattle-call — niche bonus should be skipped",
    ).not.toContain("nicheEmployer");

    expect(
      scored.score.total,
      "ANCHOR 3 (Civis): final not below Cherry Hill — cattle-call vs specific-match ordering regressed",
    ).toBeLessThan(cherry.score.total!);
  });

  it("ANCHOR 4 (Meta): known brand employer — brand list not over-thinned", () => {
    const scored = scoreCalibrationAnchor("metaBrand");

    expect(
      scored.employerRecognizability,
      "ANCHOR 4 (Meta): employerRecognizability below 0.70 — real brand no longer reads as brand after list trim",
    ).toBeGreaterThanOrEqual(0.7);

    expect(
      scored.poolAdjustments,
      "ANCHOR 4 (Meta): nicheEmployer bonus on FAANG-tier brand — over-correction guard failed",
    ).not.toContain("nicheEmployer");

    expect(
      scored.poolAdjustments,
      "ANCHOR 4 (Meta): brandEmployer penalty missing — recognizable employer should trigger brand crowding",
    ).toContain("brandEmployer");
  });

  it("ANCHOR 5 (Cherry Hill): auth false-positive guard — work-auth phrase must not fire auth differentiator", () => {
    const fixture = loadCalibrationFixture("cherryHill");
    const tags = differentiatorTagsForFixture(fixture);
    const scored = scoreCalibrationAnchor("cherryHill");

    expect(
      tags.some((tag) => /^(auth|authentication|oauth|openid|sso|jwt|session)$/i.test(tag)),
      "ANCHOR 5 (Cherry Hill): auth differentiator tag fired on work-authorization listing — Bug-2 auth guard regressed",
    ).toBe(false);

    expect(
      scored.differentiatorCoverage.tier,
      "ANCHOR 5 (Cherry Hill): differentiator coverage collapsed to none — aws/graphql path should still register",
    ).not.toBe("none");

    expect(
      tags.some((tag) => ["aws", "graphql", "lambda", "postgresql"].includes(tag)),
      "ANCHOR 5 (Cherry Hill): cloud/backend differentiator tags missing — tag expansion regressed",
    ).toBe(true);
  });

  it("ANCHOR 6 (IBM): degree hard-gate guard — cert boost must not bypass unconditional degree requirement", () => {
    const scored = scoreCalibrationAnchor("ibmDegreeGate");
    const display = scored.score.scoreDisplay;
    const degreePenalty = buildSurvivabilityPenalties(scored.rules, scored.fixture.extracted).find(
      (penalty) => /degree gate|degree listed/i.test(penalty.message),
    );

    expect(
      scored.rules.explicitDegreeRisk,
      "ANCHOR 6 (IBM): explicitDegreeRisk not set — unconditional degree requirement not detected",
    ).toBe(true);
    expect(scored.rules.degreeHasEquivalencyClause).toBeFalsy();

    expect(
      resolveDegreeGapTier(scored.rules, userProfile),
      "ANCHOR 6 (IBM): degree gap tier not high — structured employer degree gate regressed",
    ).toBe("high");

    const degreeDock = computeDegreeGapDock(scored.rules, userProfile);
    const profileWithoutCerts = { ...userProfile, certifications: [] };
    expect(
      degreeDock,
      "ANCHOR 6 (IBM): degree dock is zero — hard degree gate inactive",
    ).toBe(DEGREE_DOCK_BY_TIER.high);
    expect(
      computeDegreeGapDock(scored.rules, profileWithoutCerts),
      "ANCHOR 6 (IBM): AWS cert presence changed degree dock — cert must not bypass unconditional degree gate",
    ).toBe(degreeDock);
    expect(
      degreeDock,
      "ANCHOR 6 (IBM): degree dock below high tier — gate severity regressed",
    ).toBeGreaterThan(0);

    expect(
      evaluateHardGates(scored.rules, scored.fixture.extracted).fired,
      "ANCHOR 6 (IBM): Section-1 hard gate fired — degree is a dock gate, not visa/geo hard gate",
    ).toBe(false);

    expect(
      degreePenalty,
      "ANCHOR 6 (IBM): survivability degree penalty missing — degree gate not surfaced in display",
    ).toBeDefined();

    expect(
      computeDegreeGapDock(scored.rules, userProfile),
      "ANCHOR 6 (IBM): degree dock must stay active regardless of profile certs — cert must not bypass gate",
    ).toBe(DEGREE_DOCK_BY_TIER.high);

    expect(
      display?.gapDock,
      "ANCHOR 6 (IBM): gapDock below high degree dock — final not reflecting degree gate",
    ).toBeGreaterThanOrEqual(DEGREE_DOCK_BY_TIER.high);

    expect(
      scored.score.total,
      "ANCHOR 6 (IBM): final above 73 — degree dock not applied; cert or pool rescued the score",
    ).toBeLessThan(73);
  });

  it("ANCHOR 7 (Precisely): frontend-primary + degree equivalency — capability ~76, no degree gate", () => {
    const scored = scoreCalibrationAnchor("preciselyAssociateSweFrontend");

    expect(
      scored.rules.frontendPrimaryRole ?? false,
      "ANCHOR 7 (Precisely): frontendPrimaryRole not set",
    ).toBe(true);
    expect(scored.differentiatorCoverage.tier).not.toBe("strong");
    expect(scored.differentiatorCoverage.note).toMatch(/backend\/API edge benched/i);

    expect(scored.rules.degreeHasEquivalencyClause).toBe(true);
    expect(scored.rules.degreeEquivalencySatisfied).toBe(true);
    expect(scored.rules.explicitDegreeRisk).toBe(false);

    expect(scored.score.capability).toBeGreaterThanOrEqual(74);
    expect(scored.score.capability).toBeLessThanOrEqual(77);
    expect(scored.score.survivabilityBreakdown?.credentialSignal ?? 0).toBeGreaterThanOrEqual(0.7);
    expect(scored.score.total).toBeGreaterThanOrEqual(74);
    expect(scored.score.total).toBeLessThanOrEqual(78);
  });

  it("cross-anchor ordering: Cherry Hill > Fubo > Civis for different reasons", () => {
    const cherry = scoreCalibrationAnchor("cherryHill");
    const fubo = scoreCalibrationAnchor("fuboFrontend");
    const civis = scoreCalibrationAnchor("civisCattleCall");

    expect(
      cherry.score.total!,
      "cross-anchor: Cherry Hill final not above Fubo — specific-match vs capability-cap ordering regressed",
    ).toBeGreaterThan(fubo.score.total!);

    expect(
      cherry.score.total!,
      "cross-anchor: Cherry Hill final not above Civis — specific-match vs cattle-call ordering regressed",
    ).toBeGreaterThan(civis.score.total!);

    expect(
      fubo.score.capability!,
      "cross-anchor: Fubo dock not capability-driven — capability should stay below 82 (cap bite)",
    ).toBeLessThan(82);

    expect(
      civis.poolFriendliness,
      "cross-anchor: Civis dock not survivability-driven — poolFriendliness should stay below 0.45 (crowded cattle-call)",
    ).toBeLessThan(0.45);
  });
});
