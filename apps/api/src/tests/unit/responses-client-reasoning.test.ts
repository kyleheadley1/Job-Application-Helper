import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { env } from "../../config/env.js";
import { ResponsesClient } from "../../services/llm/responsesClient.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const original = { key: env.openAiApiKey, model: env.openAiModel };
const ok = () => new Response(JSON.stringify({ output_text: '{"ok":true}' }), { status: 200 });
const sentBody = (call: number) => JSON.parse(fetchMock.mock.calls[call]![1].body as string);
const request = {
  systemPrompt: "s",
  userPrompt: "u",
  schema: z.object({ ok: z.boolean() }),
  fallback: () => ({ ok: false }),
  reasoningEffort: "minimal" as const,
};

describe("ResponsesClient reasoning effort", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    env.openAiApiKey = "test-key";
    env.openAiModel = "gpt-5-mini";
  });

  afterAll(() => {
    env.openAiApiKey = original.key;
    env.openAiModel = original.model;
  });

  it("sends the effort to reasoning models", async () => {
    fetchMock.mockResolvedValueOnce(ok());
    const result = await new ResponsesClient().runStructured(request);
    expect(result.success).toBe(true);
    expect(sentBody(0).reasoning).toEqual({ effort: "minimal" });
  });

  it("omits it for non-reasoning models", async () => {
    env.openAiModel = "gpt-4o-mini";
    fetchMock.mockResolvedValueOnce(ok());
    await new ResponsesClient().runStructured(request);
    expect(sentBody(0).reasoning).toBeUndefined();
  });

  it("retries once without it when the model rejects the parameter", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Unsupported value: 'reasoning.effort'", param: "reasoning.effort" } }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(ok());
    const result = await new ResponsesClient().runStructured(request);
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(1).reasoning).toBeUndefined();
  });
});
