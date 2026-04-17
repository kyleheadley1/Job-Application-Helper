import { ZodSchema } from "zod";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";

type StructuredRequest<T> = {
  systemPrompt: string;
  userPrompt: string;
  schema: ZodSchema<T>;
  fallback: () => T;
};

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

const diag = (partial: StructuredCallDiagnostics): StructuredCallDiagnostics => ({
  fallbackUsed: partial.fallbackUsed,
  ...partial,
});

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

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.openAiApiKey}`,
        },
        body: JSON.stringify({
          model: env.openAiModel,
          input: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt },
          ],
          text: { format: { type: "json_object" } },
        }),
      });
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
