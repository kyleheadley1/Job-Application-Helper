import { ZodSchema } from "zod";
import { env } from "../../config/env.js";

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

export type StructuredCallResult<T> = {
  success: boolean;
  data: T;
};

export class ResponsesClient {
  async runStructured<T>(request: StructuredRequest<T>): Promise<StructuredCallResult<T>> {
    const fallbackData = request.fallback();
    if (!env.openAiApiKey) {
      return { success: false, data: fallbackData };
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
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

    if (!response.ok) {
      return { success: false, data: fallbackData };
    }

    const payload = (await response.json()) as { output_text?: string };
    const parsed = tryParseJson(payload.output_text ?? "");
    if (!parsed) {
      return { success: false, data: fallbackData };
    }

    const checked = request.schema.safeParse(parsed);
    if (!checked.success) {
      return { success: false, data: fallbackData };
    }

    return { success: true, data: checked.data };
  }
}

export const responsesClient = new ResponsesClient();
