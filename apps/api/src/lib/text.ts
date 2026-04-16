export const normalizeText = (value: string | undefined): string =>
  (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const dedupeStrings = (values: string[]): string[] => [...new Set(values.map((v) => v.trim()).filter(Boolean))];
