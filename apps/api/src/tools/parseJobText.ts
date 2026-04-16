import { dedupeStrings } from "../lib/text.js";

export const parseJobText = (rawText: string): { lines: string[]; normalized: string } => {
  const normalizedInput = rawText.replace(/\r\n/g, "\n");
  const lines = dedupeStrings(
    normalizedInput
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
  return {
    lines,
    normalized: lines.join("\n"),
  };
};
