import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  detectSpecializationGap,
  extractJdBackendLabel,
} from "../../lib/capabilityGap.js";
import { polishRisksAndMain } from "../../lib/scoringOutputPolish.js";
import { userProfile } from "../../config/userProfile.js";
import {
  loadCalibrationFixture,
  scoreCalibrationAnchor,
  calibrationSweResumeContexts,
} from "../fixtures/calibrationAnchors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

describe("JSR Tech Consulting — Required Node, not Python; no ungrounded degree risk", () => {
  it("does not treat Responsibilities including-but-not-limited-to Python as the backend lead", () => {
    const fixture = loadCalibrationFixture("jsrTechConsultingRequiredNode");
    expect(extractJdBackendLabel(fixture.extracted)).toBeUndefined();

    const gap = detectSpecializationGap(
      fixture.extracted,
      { ...fixture.storedCategoryScores, total: 0 },
      SWE_RESUME,
    );
    expect(gap).toBeUndefined();
  });

  it("recompute does not dock Python backend or emit Python-leads action line", () => {
    const scored = scoreCalibrationAnchor("jsrTechConsultingRequiredNode");
    expect(scored.rules.specializationGap).toBeUndefined();
    expect(scored.score.scoreDisplay?.gapDock ?? 0).toBe(0);
    const action = scored.score.scoreDisplay?.actionLine ?? "";
    expect(action).not.toMatch(/python/i);
    expect(action).not.toMatch(/role leads with Python/i);
  });

  it("strips stale ungrounded degree mainRisk when JD has no degree language", () => {
    const fixture = loadCalibrationFixture("jsrTechConsultingRequiredNode") as ReturnType<
      typeof loadCalibrationFixture
    > & {
      staleNarrative?: { mainRisk: string; risks: string[] };
    };
    const scored = scoreCalibrationAnchor("jsrTechConsultingRequiredNode");
    const polished = polishRisksAndMain({
      mainRisk:
        fixture.staleNarrative?.mainRisk ??
        "No bachelor's degree noted — conservative financial-services screens or ATS filters could disadvantage the candidate.",
      risks: fixture.staleNarrative?.risks ?? [],
      extracted: fixture.extracted,
      rules: scored.rules,
      userProfile,
      max: 5,
    });
    const blob = [polished.mainRisk, ...polished.risks].join(" | ");
    expect(blob).not.toMatch(/bachelor'?s?\s+degree\s+noted/i);
    expect(blob).not.toMatch(/no bachelor/i);
    expect(scored.rules.explicitDegreeRisk).toBe(false);
  });
});
