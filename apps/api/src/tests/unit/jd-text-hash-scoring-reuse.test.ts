import { describe, expect, it, vi } from "vitest";
import { evaluateRules } from "../../agents/jobAgent/rules.js";
import { scoreJob } from "../../agents/jobAgent/scoring.js";
import { userProfile } from "../../config/userProfile.js";
import {
  canReuseStoredScoringCategories,
  computeJdTextHash,
  jdTextHashFromInput,
  mergedParsedJdText,
} from "../../lib/jdTextHash.js";
import { storedCategoryScores } from "../../lib/recomputeStoredJobScore.js";
import type { ExtractedJobData, JobRecord } from "../../types/job.js";
import type { ScoreBreakdown } from "../../types/scoring.js";

vi.mock("../../services/llm/responsesClient.js", () => ({
  responsesClient: {
    runStructured: vi.fn(() => {
      throw new Error("scoring LLM should not run when categories are preserved");
    }),
  },
}));

const JD =
  "Software Engineer\nQualifications\n2+ years experience with Ruby on Rails, React, and/or Typescript";

const EXTRACTED: ExtractedJobData = {
  company: "Fleetio",
  title: "Software Engineer",
  rawText: JD,
  stack: ["React", "TypeScript"],
  requiredSkills: ["React", "TypeScript"],
  preferredSkills: [],
  domainTags: [],
  responsibilities: [],
  requirements: ["2+ years experience with Ruby on Rails, React, and/or Typescript"],
};

const STORED_CATEGORIES: ScoreBreakdown = {
  stackFit: 13,
  levelFit: 18,
  domainFit: 8,
  resumeStoryClarity: 7,
  functionalOverlap: 11,
  recruiterFriendliness: 12,
  careerValue: 8,
  total: 0,
};

describe("jdTextHash", () => {
  it("is stable for equivalent whitespace-normalized JD text", () => {
    const a = jdTextHashFromInput({ rawText: "Line one\n\nLine two" });
    const b = jdTextHashFromInput({ rawText: "Line one\r\n\r\nLine two" });
    expect(a).toBe(b);
  });

  it("changes when JD body text changes", () => {
    const a = computeJdTextHash(mergedParsedJdText({ rawText: JD }));
    const b = computeJdTextHash(
      mergedParsedJdText({ rawText: `${JD}\nExtra requirement line` }),
    );
    expect(a).not.toBe(b);
  });
});

describe("canReuseStoredScoringCategories", () => {
  const hash = jdTextHashFromInput({ rawText: JD });

  const previousJob = (): Pick<
    JobRecord,
    "scoringJdTextHash" | "score" | "debugExtraction"
  > => ({
    scoringJdTextHash: hash,
    score: { ...STORED_CATEGORIES, total: 77 },
    debugExtraction: {
      fallbackUsed: false,
      extraction: { success: true, fallbackUsed: false },
      scoring: { success: true, fallbackUsed: false },
      extractedFromRawText: [],
      missingCriticalFields: [],
    },
  });

  it("allows reuse when hash and prior successful scoring match", () => {
    expect(
      canReuseStoredScoringCategories({
        currentJdTextHash: hash,
        previousJob: previousJob(),
      }),
    ).toBe(true);
  });

  it("blocks reuse when JD hash differs", () => {
    expect(
      canReuseStoredScoringCategories({
        currentJdTextHash: "different-hash",
        previousJob: previousJob(),
      }),
    ).toBe(false);
  });

  it("blocks reuse when prior scoring LLM did not succeed", () => {
    const prev = previousJob();
    prev.debugExtraction!.scoring.success = false;
    expect(
      canReuseStoredScoringCategories({
        currentJdTextHash: hash,
        previousJob: prev,
      }),
    ).toBe(false);
  });
});

describe("scoreJob preserved categories", () => {
  it("reuses stored levelFit/domainFit without calling the scoring LLM", async () => {
    const rules = evaluateRules(EXTRACTED, userProfile);
    const result = await scoreJob({
      extracted: EXTRACTED,
      rules,
      userProfile,
      preservedScoring: {
        categoryScores: STORED_CATEGORIES,
        narrative: {
          topMatch: "Stored top match",
          mainRisk: "Stored main risk",
          risks: ["Stored risk"],
          rationale: ["Stored rationale"],
        },
      },
    });

    expect(result.scoringCategoriesReused).toBe(true);
    expect(result.scoringLlmSucceeded).toBe(true);
    expect(result.scoringDiagnostics.reason).toBe(
      "jd_text_hash_unchanged_reused_categories",
    );

    const raw = storedCategoryScores(result.scoring.score);
    expect(raw.levelFit).toBe(STORED_CATEGORIES.levelFit);
    expect(raw.domainFit).toBe(STORED_CATEGORIES.domainFit);
    expect(result.scoring.score.survivabilityBreakdown?.domainMatchForListing).toBeDefined();
  });
});
