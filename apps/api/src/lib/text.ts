export const normalizeText = (value: string | undefined): string =>
  (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Hyphen/slash-insensitive text for includesAny / role-shape matchers. */
export const normalizeMatcherText = (value: string | undefined): string =>
  normalizeText((value ?? "").replace(/[-–—/]/g, " "));

export const dedupeStrings = (values: string[]): string[] => [...new Set(values.map((v) => v.trim()).filter(Boolean))];
