import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { evaluateHardGates } from "../../lib/hardGates.js";
import {
  normalizeRiskBulletForDedup,
  riskBulletsNearIdentical,
} from "../../lib/jdGroundedRiskNotes.js";
import { sanitizeVisibleRiskLine } from "../../lib/riskDisplaySanitizer.js";
import {
  loadCalibrationFixture,
  scoreCalibrationAnchor,
  type CalibrationFixtureKey,
} from "../fixtures/calibrationAnchors.js";

describe("Fun + Luminos seniority + Key Risks grounding", () => {
  it("Fun: multi-band Mid+Lead/Staff does not hard-gate; no co-branded card; no associate-level boilerplate", () => {
    const scored = scoreCalibrationAnchor("funMultiBandSeniority");
    const gates = evaluateHardGates(scored.rules, scored.fixture.extracted);

    expect(gates.reasons).not.toContain("Role seniority/staff bar exceeds early-career profile.");
    expect(scored.rules.seniorityOverreach).toBe(false);

    const riskText = [
      ...(scored.rules.notes ?? []),
      ...(scored.rules.hardRuleNotes ?? []),
      ...(scored.risks ?? []),
    ].join(" | ");
    expect(riskText.toLowerCase()).not.toMatch(/co-branded\s+card/);
    expect(riskText.toLowerCase()).not.toContain(
      "backend/cloud/database production depth despite the associate level",
    );
  });

  it("Luminos: senior-depth Required still hard-gates despite Mid in multi-band tag", () => {
    const scored = scoreCalibrationAnchor("luminosSeniorDepthGuard");
    const gates = evaluateHardGates(scored.rules, scored.fixture.extracted);

    expect(scored.rules.seniorityOverreach).toBe(true);
    expect(gates.reasons).toContain("Role seniority/staff bar exceeds early-career profile.");

    const riskText = [...(scored.rules.notes ?? []), ...(scored.rules.hardRuleNotes ?? [])].join(
      " | ",
    );
    expect(riskText.toLowerCase()).toMatch(/memory management|load testing|profiling/);
    expect(riskText.toLowerCase()).not.toContain(
      "backend/cloud/database production depth despite the associate level",
    );
  });

  it("Fun and Luminos (and Kong) share no identical Key Risk bullets", () => {
    const fun = scoreCalibrationAnchor("funMultiBandSeniority");
    const luminos = scoreCalibrationAnchor("luminosSeniorDepthGuard");
    const kong = scoreCalibrationAnchor("kongAiEnablementUngrounded");

    const bulletsFor = (scored: ReturnType<typeof scoreCalibrationAnchor>) => {
      const company = scored.fixture.extracted.company ?? "";
      return [...(scored.rules.notes ?? []), ...(scored.rules.hardRuleNotes ?? [])]
        .map((n) =>
          sanitizeVisibleRiskLine(n, {
            extracted: scored.fixture.extracted,
            userProfile,
            rules: scored.rules,
          }),
        )
        .map((n) => normalizeRiskBulletForDedup(n, [company]))
        .filter((n) => n.length > 20);
    };

    const funB = bulletsFor(fun);
    const luminosB = bulletsFor(luminos);
    const kongB = bulletsFor(kong);

    for (const a of funB) {
      for (const b of luminosB) {
        expect(
          riskBulletsNearIdentical(a, b),
          `Fun/Luminos shared near-identical risk:\nA: ${a}\nB: ${b}`,
        ).toBe(false);
      }
      for (const b of kongB) {
        expect(
          riskBulletsNearIdentical(a, b),
          `Fun/Kong shared near-identical risk:\nA: ${a}\nB: ${b}`,
        ).toBe(false);
      }
    }
  });
});

describe("standing: Key Risks uniqueness across calibration anchors", () => {
  /** Fixed set where category-matched templates previously collided across unrelated JDs. */
  const KEY_RISKS_UNIQUENESS_ANCHORS: CalibrationFixtureKey[] = [
    "funMultiBandSeniority",
    "luminosSeniorDepthGuard",
    "kongAiEnablementUngrounded",
    "neonTextuallyUngrounded",
    "preciselyAssociateSweFrontend",
    "picnicFrontend",
    "leapHealthcareProduct",
    "clinicalInkHealthcare",
    "stubHubCoreCompute",
    "trabaAppliedAi",
  ];

  it("no two unrelated anchors share an identical risk bullet (company-stripped)", () => {
    const rows: Array<{ key: string; bullet: string }> = [];

    for (const key of KEY_RISKS_UNIQUENESS_ANCHORS) {
      const fixture = loadCalibrationFixture(key);
      const rules = evaluateRules(fixture.extracted, userProfile);
      const company = fixture.extracted.company ?? "";
      for (const note of [...(rules.notes ?? []), ...(rules.hardRuleNotes ?? [])]) {
        const cleaned = sanitizeVisibleRiskLine(note, {
          extracted: fixture.extracted,
          userProfile,
          rules,
        });
        const norm = normalizeRiskBulletForDedup(cleaned, [company]);
        if (norm.length < 24) continue;
        rows.push({ key, bullet: norm });
      }
    }

    const collisions: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (rows[i].key === rows[j].key) continue;
        // Exact identical after company strip = shared template (Ticket 1).
        // Near-identical (≥0.92) catches company-swapped boilerplate with tiny edits.
        if (
          rows[i].bullet === rows[j].bullet ||
          riskBulletsNearIdentical(rows[i].bullet, rows[j].bullet, 0.92)
        ) {
          collisions.push(
            `${rows[i].key} ↔ ${rows[j].key}: "${rows[i].bullet}" ≈ "${rows[j].bullet}"`,
          );
        }
      }
    }

    expect(collisions, collisions.slice(0, 8).join("\n")).toEqual([]);
  });

  it("never emits co-branded card or associate-level boilerplate without JD evidence", () => {
    for (const key of KEY_RISKS_UNIQUENESS_ANCHORS) {
      const fixture = loadCalibrationFixture(key);
      const rules = evaluateRules(fixture.extracted, userProfile);
      const blob = [
        fixture.extracted.rawText ?? "",
        ...(fixture.extracted.requirements ?? []),
        ...(fixture.extracted.responsibilities ?? []),
      ]
        .join("\n")
        .toLowerCase();
      const notes = [...(rules.notes ?? []), ...(rules.hardRuleNotes ?? [])]
        .map((n) =>
          sanitizeVisibleRiskLine(n, {
            extracted: fixture.extracted,
            userProfile,
            rules,
          }),
        )
        .join(" | ")
        .toLowerCase();

      if (!/\bco[-\s]?branded\b/.test(blob)) {
        expect(notes, key).not.toMatch(/co-branded\s+card/);
      }
      expect(notes, key).not.toContain(
        "backend/cloud/database production depth despite the associate level",
      );
      expect(notes, key).not.toContain(
        "hiring rubrics often emphasize production reliability",
      );
    }
  });
});
