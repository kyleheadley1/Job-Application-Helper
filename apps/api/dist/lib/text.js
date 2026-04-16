export const normalizeText = (value) => (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
export const dedupeStrings = (values) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];
