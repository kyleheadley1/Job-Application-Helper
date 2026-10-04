import { ZodSchema } from "zod";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { recordLlmUsage, type OpenAiUsage } from "./llmUsage.js";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

type StructuredRequest<T> = {
  systemPrompt: string;
  userPrompt: string;
  schema: ZodSchema<T>;
  fallback: () => T;
  /** Only sent to reasoning models; hidden reasoning is billed as output and dominates cost. */
  reasoningEffort?: ReasoningEffort;
};

const supportsReasoning = (model: string) => /^(gpt-5|o\d)/i.test(model);

const isReasoningParamError = (status: number, payload: unknown) =>
  status === 400 && /reasoning/i.test(JSON.stringify((payload as { error?: unknown })?.error ?? ""));

const tryParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/** Best-effort: Responses API may expose `output_text` or nested `output[]` message parts. */
export const extractJsonTextFromOpenAiResponse = (body: unknown): string | undefined => {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;

  if (typeof b.output_text === "string" && b.output_text.trim()) {
    return b.output_text.trim();
  }

  const output = b.output;
  if (!Array.isArray(output)) return undefined;

  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;

    if (it.type === "output_text" && typeof it.text === "string") {
      chunks.push(it.text);
      continue;
    }

    if (it.type === "message" && Array.isArray(it.content)) {
      for (const c of it.content) {
        if (!c || typeof c !== "object") continue;
        const part = c as Record<string, unknown>;
        if (
          (part.type === "output_text" || part.type === "text") &&
          typeof part.text === "string"
        ) {
          chunks.push(part.text);
        }
      }
    }
  }

  const joined = chunks.join("").trim();
  return joined || undefined;
};

export type StructuredCallDiagnostics = {
  fallbackUsed: boolean;
  /** High-level reason when fallback is used (safe to show in API debug). */
  reason?: string;
  httpStatus?: number;
  errorCode?: string;
  errorType?: string;
  errorMessage?: string;
  parseStage?:
    | "missing_api_key"
    | "http_error"
    | "invalid_response_json"
    | "empty_model_output"
    | "json_parse"
    | "schema_validation"
    | "ok";
};

export type StructuredCallResult<T> = {
  success: boolean;
  data: T;
  diagnostics: StructuredCallDiagnostics;
};

const diag = (partial: StructuredCallDiagnostics): StructuredCallDiagnostics => ({ ...partial });

export class ResponsesClient {
  async runStructured<T>(request: StructuredRequest<T>): Promise<StructuredCallResult<T>> {
    const fallbackData = request.fallback();

    if (!env.openAiApiKey) {
      const diagnostics = diag({
        fallbackUsed: true,
        reason: "OPENAI_API_KEY not set",
        parseStage: "missing_api_key",
      });
      logger.warn("OpenAI structured call skipped — no API key", { diagnostics, model: env.openAiModel });
      return { success: false, data: fallbackData, diagnostics };
    }

    const send = (effort?: ReasoningEffort) =>
      fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.openAiApiKey}`,
        },
        body: JSON.stringify({
          model: env.openAiModel,
          // gpt-5-mini (Responses API) rejects `temperature` — omit it; retriage JD-hash reuse handles determinism.
          input: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt },
          ],
          text: { format: { type: "json_object" } },
          ...(effort ? { reasoning: { effort } } : {}),
        }),
      });
    const effort =
      request.reasoningEffort && supportsReasoning(env.openAiModel) ? request.reasoningEffort : undefined;

    let response: Response;
    try {
      response = await send(effort);
      if (effort && response.status === 400) {
        const errorBody = await response.clone().json().catch(() => null);
        if (isReasoningParamError(response.status, errorBody)) {
          logger.warn("Model rejected reasoning effort; retrying without it", { model: env.openAiModel, effort });
          response = await send();
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const diagnostics = diag({
        fallbackUsed: true,
        reason: "fetch_failed",
        parseStage: "http_error",
        errorMessage: message,
      });
      logger.error("OpenAI structured call network failure", { diagnostics, model: env.openAiModel });
      return { success: false, data: fallbackData, diagnostics };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      const diagnostics = diag({
        fallbackUsed: true,
        reason: "response_body_not_json",
        httpStatus: response.status,
        parseStage: "invalid_response_json",
      });
      logger.warn("OpenAI structured call failed — response body not JSON", { diagnostics });
      return { success: false, data: fallbackData, diagnostics };
    }

    if (payload && typeof payload === "object" && "usage" in payload) {
      recordLlmUsage(env.openAiModel, (payload as { usage?: OpenAiUsage }).usage);
    }

    if (!response.ok) {
      const errObj =
        payload && typeof payload === "object" && "error" in payload
          ? (payload as { error?: { message?: string; type?: string; code?: string } }).error
          : undefined;
      const diagnostics = diag({
        fallbackUsed: true,
        reason: "openai_http_error",
        httpStatus: response.status,
        errorCode: errObj?.code,
        errorType: errObj?.type,
        errorMessage: errObj?.message,
        parseStage: "http_error",
      });
      logger.warn("OpenAI structured call failed — HTTP error", {
        diagnostics,
        model: env.openAiModel,
      });
      return { success: false, data: fallbackData, diagnostics };
    }

    const outputText = extractJsonTextFromOpenAiResponse(payload);
    if (!outputText) {
      const diagnostics = diag({
        fallbackUsed: true,
        reason: "no_model_text_extracted",
        httpStatus: response.status,
        parseStage: "empty_model_output",
      });
      logger.warn("OpenAI structured call failed — could not extract model JSON text", {
        diagnostics,
        model: env.openAiModel,
        responseTopKeys:
          payload && typeof payload === "object" ? Object.keys(payload as object).slice(0, 20) : [],
      });
      return { success: false, data: fallbackData, diagnostics };
    }

    const parsed = tryParseJson(outputText);
    if (!parsed) {
      const diagnostics = diag({
        fallbackUsed: true,
        reason: "model_output_not_valid_json",
        httpStatus: response.status,
        parseStage: "json_parse",
      });
      logger.warn("OpenAI structured call failed — model output not valid JSON", {
        diagnostics,
        model: env.openAiModel,
        outputTextLength: outputText.length,
      });
      return { success: false, data: fallbackData, diagnostics };
    }

    const checked = request.schema.safeParse(parsed);
    if (!checked.success) {
      const diagnostics = diag({
        fallbackUsed: true,
        reason: "schema_validation_failed",
        httpStatus: response.status,
        parseStage: "schema_validation",
        errorMessage: checked.error.message,
      });
      logger.warn("OpenAI structured call failed — schema validation", {
        diagnostics,
        model: env.openAiModel,
        issueCount: checked.error.issues.length,
      });
      return { success: false, data: fallbackData, diagnostics };
    }

    const diagnostics = diag({
      fallbackUsed: false,
      httpStatus: response.status,
      parseStage: "ok",
    });
    return { success: true, data: checked.data, diagnostics };
  }
}

export const responsesClient = new ResponsesClient();

export type ToolDef = {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

export type ToolLoopResult = {
  success: boolean;
  text: string;
  steps: number;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  error?: string;
};

type OutputItem = { type?: string; name?: string; arguments?: string; call_id?: string };

/** Tool results are clipped so one big lookup can't balloon every later step's input. */
export const MAX_TOOL_OUTPUT_CHARS = 6000;

/**
 * Responses API function-calling loop. Each step replays the conversation plus the model's output
 * items and tool results; the last allowed step forbids tools so the model must answer.
 */
export const runWithTools = async (
  request: {
    systemPrompt: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    tools: ToolDef[];
    maxSteps?: number;
    reasoningEffort?: ReasoningEffort;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<ToolLoopResult> => {
  const maxSteps = request.maxSteps ?? 6;
  const toolCalls: ToolLoopResult["toolCalls"] = [];
  if (!env.openAiApiKey) return { success: false, text: "", steps: 0, toolCalls, error: "OPENAI_API_KEY not set" };

  const byName = new Map(request.tools.map((t) => [t.name, t]));
  const input: unknown[] = [
    { role: "system", content: request.systemPrompt },
    ...request.messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const effort =
    request.reasoningEffort && supportsReasoning(env.openAiModel) ? { reasoning: { effort: request.reasoningEffort } } : {};

  for (let step = 1; step <= maxSteps; step += 1) {
    const last = step === maxSteps;
    let payload: { output?: OutputItem[]; usage?: OpenAiUsage; error?: { message?: string } };
    try {
      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.openAiApiKey}` },
        body: JSON.stringify({
          model: env.openAiModel,
          input,
          tools: request.tools.map(({ name, description, parameters }) => ({ type: "function", name, description, parameters })),
          tool_choice: last ? "none" : "auto",
          ...effort,
        }),
      });
      payload = (await response.json()) as typeof payload;
      recordLlmUsage(env.openAiModel, payload.usage);
      if (!response.ok) {
        return { success: false, text: "", steps: step, toolCalls, error: payload.error?.message ?? `HTTP ${response.status}` };
      }
    } catch (error) {
      return { success: false, text: "", steps: step, toolCalls, error: error instanceof Error ? error.message : String(error) };
    }

    const output = payload.output ?? [];
    const calls = output.filter((o) => o.type === "function_call");
    if (calls.length === 0) {
      return { success: true, text: extractJsonTextFromOpenAiResponse(payload) ?? "", steps: step, toolCalls };
    }

    input.push(...output);
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
      } catch {
        args = {};
      }
      toolCalls.push({ name: call.name ?? "", args });
      const tool = byName.get(call.name ?? "");
      let result: unknown;
      try {
        result = tool ? await tool.run(args) : { error: `Unknown tool ${call.name}` };
      } catch (error) {
        result = { error: error instanceof Error ? error.message : String(error) };
      }
      const text = JSON.stringify(result ?? null);
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: text.length > MAX_TOOL_OUTPUT_CHARS ? `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}…(truncated)` : text,
      });
    }
  }
  return { success: false, text: "", steps: maxSteps, toolCalls, error: "No answer within the step limit" };
};
