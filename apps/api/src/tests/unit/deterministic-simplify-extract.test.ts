import { describe, expect, it } from "vitest";
import { extractFromRawText, mergeExtractedWithHeuristics } from "../../tools/deterministicRawTextExtract.js";
import type { ExtractedJobData } from "../../types/job.js";

const SIMPLIFY_PASTE = `
Contract

Open user menu

AI Enablement Engineer
Updated on 5/26/2026

Unlock job analytics with
Simplify+
GreenLite
GreenLite
51-200 employees
Permit management and code compliance services
`.trim();

describe("deterministic extractFromRawText (Simplify paste)", () => {
  it("does not use first line as company or title", () => {
    const { partial } = extractFromRawText(SIMPLIFY_PASTE);
    expect(partial.company).toBe("GreenLite");
    expect(partial.title).toBe("AI Enablement Engineer");
    expect(partial.employmentType).toBe("Contract");
  });

  it("merge prefers heuristic company over LLM Unknown Company", () => {
    const llm: ExtractedJobData = {
      company: "Unknown Company",
      title: "Contract",
      remoteType: "unknown",
      stack: [],
      requiredSkills: [],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [],
      requirements: [],
      rawText: SIMPLIFY_PASTE,
    };
    const heur = extractFromRawText(SIMPLIFY_PASTE);
    const merged = mergeExtractedWithHeuristics(llm, heur);
    expect(merged.company).toBe("GreenLite");
    expect(merged.title).toBe("AI Enablement Engineer");
  });
});
