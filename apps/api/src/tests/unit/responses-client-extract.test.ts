import { describe, expect, it } from "vitest";
import { extractJsonTextFromOpenAiResponse } from "../../services/llm/responsesClient.js";

describe("extractJsonTextFromOpenAiResponse", () => {
  it("reads top-level output_text when present", () => {
    const text = extractJsonTextFromOpenAiResponse({ output_text: '{"a":1}' });
    expect(text).toBe('{"a":1}');
  });

  it("reads nested message output_text parts when output_text is absent", () => {
    const text = extractJsonTextFromOpenAiResponse({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: '{"whyCompany":"x"}' }],
        },
      ],
    });
    expect(text).toBe('{"whyCompany":"x"}');
  });

  it("concatenates multiple text chunks in order", () => {
    const text = extractJsonTextFromOpenAiResponse({
      output: [
        { type: "output_text", text: '{"a":' },
        { type: "output_text", text: "1}" },
      ],
    });
    expect(text).toBe('{"a":1}');
  });

  it("returns undefined for empty output", () => {
    expect(extractJsonTextFromOpenAiResponse({ output: [] })).toBeUndefined();
    expect(extractJsonTextFromOpenAiResponse({})).toBeUndefined();
  });
});
