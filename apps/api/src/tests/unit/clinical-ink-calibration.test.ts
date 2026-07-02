import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import { detectSpecializationGap } from "../../lib/capabilityGap.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { buildScoreDisplay } from "../../lib/scoreDisplayModel.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { ScoreBreakdown } from "../../types/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
  "utf8",
);

const CLINICAL_INK_JOB: ExtractedJobData = {
  company: "Clinical Ink",
  title: "Software Engineer",
  location: "Remote",
  remoteType: "remote",
  seniority: "entry",
  stack: ["TypeScript", "Node.js", "React", "Python"],
  requiredSkills: ["TypeScript", "Node.js"],
  preferredSkills: ["Python"],
  domainTags: ["healthcare", "clinical"],
  responsibilities: [
    "Build clinical trial software features with TypeScript and Node.js",
    "Collaborate on full-stack product delivery",
  ],
  requirements: [
    "We value engineering fundamentals and learning speed over expertise in any specific programming language.",
    "Experience with TypeScript and Node.js in production web applications.",
    "Python is a plus.",
  ],
  rawText: `
Clinical Ink — Software Engineer
Remote
We value engineering fundamentals and learning speed over expertise in any specific programming language.
Build eClinical software with TypeScript, Node.js, and React. Python is a plus.
  `.trim(),
};

const CLINICAL_INK_CAPABILITY: ScoreBreakdown = {
  stackFit: 16,
  levelFit: 15,
  domainFit: 6,
  resumeStoryClarity: 8,
  functionalOverlap: 12,
  recruiterFriendliness: 10,
  careerValue: 7,
  total: 0,
};

describe("Clinical Ink calibration — soft Python preference", () => {
  it("does not apply Python backend specialization dock when Python is a plus", () => {
    const gap = detectSpecializationGap(CLINICAL_INK_JOB, CLINICAL_INK_CAPABILITY, SWE_RESUME);
    expect(gap).toBeUndefined();

    const rules = evaluateRules(CLINICAL_INK_JOB, userProfile, { activeResumeType: "SWE" });
    const composite = computeCompositeScore({
      rawScore: CLINICAL_INK_CAPABILITY,
      rules,
      extracted: CLINICAL_INK_JOB,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });

    expect(composite.score.total).toBeGreaterThanOrEqual(70);
    expect(composite.scoreBand).not.toBe("skip");

    const display = buildScoreDisplay({
      score: composite.score,
      rules,
      extracted: CLINICAL_INK_JOB,
      recommendation: composite.recommendation,
    });
    expect(display?.gapDock ?? 0).toBe(0);
    expect(display?.actionLine).not.toMatch(/python.*backend|reframe backend/i);
  });
});
