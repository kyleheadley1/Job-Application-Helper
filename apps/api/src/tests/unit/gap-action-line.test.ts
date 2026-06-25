import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { userProfile } from "../../config/userProfile.js";
import {
  detectSpecializationGap,
  extractJdBackendLabel,
} from "../../lib/capabilityGap.js";
import {
  actionLineHasDuplicateFragments,
  backendTechFromGapActionLine,
  composeSpecializationGapActionLine,
} from "../../lib/gapActionLine.js";
import { computeCompositeScore } from "../../lib/compositeScoreModel.js";
import { buildScoreDisplay, buildSurvivabilityPenalties } from "../../lib/scoreDisplayModel.js";
import type { ExtractedJobData } from "../../types/job.js";
import type { ScoreBreakdown } from "../../types/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWE_RESUME = fs.readFileSync(
  path.resolve(__dirname, "../../../data/resumes/swe_resume.txt"),
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

const rulesWithGap = (
  job: ExtractedJobData,
  gap: NonNullable<ReturnType<typeof detectSpecializationGap>>,
) => {
  const rules = evaluateRules(job, userProfile, { activeResumeType: "SWE" });
  return {
    ...rules,
    specializationGap: gap,
    capabilityGap: { kind: "specialization" as const, reason: gap.name },
    stackMismatch: false,
    explicitCoreLanguageMismatch: false,
    coreLanguageGap: [],
  };
};

const displayFor = (job: ExtractedJobData, rules: ReturnType<typeof rulesWithGap>) => {
  const composite = computeCompositeScore({
    rawScore: CAPABILITY_SCORE,
    rules,
    extracted: job,
    profile: userProfile,
    resumeText: SWE_RESUME,
  });
  return buildScoreDisplay({
    score: composite.score,
    rules,
    extracted: job,
    recommendation: composite.recommendation,
  });
};

describe("Reflow Django backend gap action line", () => {
  const REFLOW_JOB: ExtractedJobData = {
    company: "Reflow",
    title: "Backend Engineer",
    location: "Remote",
    remoteType: "remote",
    seniority: "mid",
    stack: ["Python", "Django", "PostgreSQL"],
    requiredSkills: ["Python", "Django"],
    preferredSkills: ["PostgreSQL"],
    domainTags: ["product"],
    responsibilities: ["Build Django REST APIs and data pipelines"],
    requirements: ["Strong Python and Django experience in production"],
    rawText: `
Reflow — Backend Engineer
Remote
Build production Python/Django backends. Strong Django REST framework experience required.
    `.trim(),
  };

  it("names Django from JD, not Flask; single coherent sentence; no duplicate fragments", () => {
    const gap = detectSpecializationGap(REFLOW_JOB, CAPABILITY_SCORE, SWE_RESUME);
    expect(gap).toBeDefined();
    expect(gap?.jdSide).toBe("Python/Django");
    expect(gap?.name).toMatch(/django/i);
    expect(gap?.name).not.toMatch(/flask/i);

    const rules = rulesWithGap(REFLOW_JOB, gap!);
    const display = displayFor(REFLOW_JOB, rules);
    const line = display!.actionLine;

    expect(line).toMatch(/django/i);
    expect(line).not.toMatch(/flask/i);
    expect(line).toMatch(/node/i);
    expect(line).toMatch(/tailored resume/i);
    expect(actionLineHasDuplicateFragments(line)).toBe(false);
    expect(line).toMatch(
      /Strong shot — role leads with Python\/Django on the backend; your resume leads with Node — reframe backend experience via resume\./i,
    );
  });
});

describe("contextual backend language in action line", () => {
  it("Flask JD → action line contains Flask, not Django", () => {
    const flaskJob: ExtractedJobData = {
      company: "Acme",
      title: "Backend Engineer",
      location: "Remote",
      remoteType: "remote",
      stack: ["Python", "Flask"],
      requiredSkills: ["Python", "Flask"],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: ["Python and Flask in production"],
      rawText: "Python Flask backend required.",
    };
    const gap = detectSpecializationGap(flaskJob, CAPABILITY_SCORE, SWE_RESUME)!;
    expect(gap.jdSide).toBe("Python/Flask");
    const line = composeSpecializationGapActionLine("Strong shot", gap, true);
    expect(line).toMatch(/flask/i);
    expect(line).not.toMatch(/django/i);
  });

  it("Go JD with no Python → no backend_stack gap and no Python/Flask in action line", () => {
    const goJob: ExtractedJobData = {
      company: "Acme",
      title: "Backend Engineer",
      location: "Remote",
      remoteType: "remote",
      stack: ["Go", "PostgreSQL"],
      requiredSkills: ["Go"],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: ["Strong Go backend experience"],
      rawText: "Go backend services. No Python.",
    };
    expect(extractJdBackendLabel(goJob)).toBeUndefined();
    const gap = detectSpecializationGap(goJob, CAPABILITY_SCORE, SWE_RESUME);
    expect(gap).toBeUndefined();

    const rules = evaluateRules(goJob, userProfile, { activeResumeType: "SWE" });
    const composite = computeCompositeScore({
      rawScore: CAPABILITY_SCORE,
      rules,
      extracted: goJob,
      profile: userProfile,
      resumeText: SWE_RESUME,
    });
    const display = buildScoreDisplay({
      score: composite.score,
      rules,
      extracted: goJob,
      recommendation: composite.recommendation,
    });
    expect(display!.actionLine).not.toMatch(/python|flask|django/i);
  });
});

describe("action line cross-check with survivability penalty", () => {
  it("backend tech in action line matches penalty message for same run", () => {
    const djangoJob: ExtractedJobData = {
      company: "Reflow",
      title: "Backend Engineer",
      location: "Remote",
      remoteType: "remote",
      stack: ["Python", "Django"],
      requiredSkills: ["Python", "Django"],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: ["Python and Django"],
      rawText: "Python Django backend.",
    };
    const gap = detectSpecializationGap(djangoJob, CAPABILITY_SCORE, SWE_RESUME)!;
    const rules = rulesWithGap(djangoJob, gap);
    const display = displayFor(djangoJob, rules)!;
    const penalties = buildSurvivabilityPenalties(rules, djangoJob);
    const gapPenalty = penalties.find((p) => p.message.includes(gap.name))!;

    const actionBackend = backendTechFromGapActionLine(display.actionLine);
    expect(actionBackend).toBe("Python/Django");
    expect(gapPenalty.message).toMatch(/python\/django/i);
    expect(gapPenalty.message).not.toMatch(/flask/i);
  });
});

describe("no-duplicate-fragment guard", () => {
  it("rejects stutter patterns", () => {
    expect(actionLineHasDuplicateFragments("worth worth a tailored resume")).toBe(true);
    expect(
      actionLineHasDuplicateFragments(
        "reframe backend experience. reframe via resume",
      ),
    ).toBe(true);
    expect(
      actionLineHasDuplicateFragments(
        "Strong shot — role leads with Python/Django on the backend; your resume leads with Node — reframe backend experience via resume. Worth a tailored resume + cover letter.",
      ),
    ).toBe(false);
  });
});

describe("no-gap jobs", () => {
  it("clean stack match → no backend-mismatch phrasing in action line", () => {
    const cleanJob: ExtractedJobData = {
      company: "Acme",
      title: "Full Stack Engineer",
      location: "Remote",
      remoteType: "remote",
      stack: ["TypeScript", "React", "Node.js"],
      requiredSkills: ["TypeScript", "Node.js"],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: ["TypeScript and Node.js"],
      rawText: "TypeScript Node full stack.",
    };
    const gap = detectSpecializationGap(cleanJob, CAPABILITY_SCORE, SWE_RESUME);
    expect(gap).toBeUndefined();
    const rules = evaluateRules(cleanJob, userProfile);
    const display = displayFor(cleanJob, {
      ...rules,
      specializationGap: undefined,
      capabilityGap: undefined,
    })!;
    expect(display.actionLine).not.toMatch(/python|flask|django|reframe backend/i);
  });
});
