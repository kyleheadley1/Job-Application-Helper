/**
 * Repair soft-wrapped mid-word line breaks common in scraped JD HTML/PDF text.
 * Rule: lowercase letter + newline + lowercase letter → rejoin (no space).
 * Skip when the second fragment is a job-board chrome / metadata label so we do not
 * glue "States\\nposition" into "Statesposition".
 */
const CHROME_SECOND_FRAGMENTS = new Set(
  [
    "position",
    "time",
    "remote",
    "seniority",
    "date",
    "money",
    "category",
    "required",
    "preferred",
    "qualification",
    "qualifications",
    "responsibilities",
    "summary",
    "history",
    "check",
    "note",
    "linkedin",
    "logo",
    "from",
    "with",
    "and",
    "the",
    "for",
    "our",
    "you",
    "are",
    "bad",
    "full",
    "entry",
    "strong",
    "skill",
    "industry",
    "connection",
    "network",
    "email",
    "today",
    "ago",
  ].map((s) => s.toLowerCase()),
);

export const repairMidWordLineBreaks = (value: string): string => {
  if (!value.includes("\n") && !value.includes("\r")) return value;
  return value.replace(/([a-z])\r?\n([a-z][a-z0-9]*)/g, (full, before: string, after: string) => {
    if (CHROME_SECOND_FRAGMENTS.has(after.toLowerCase())) return `${before}\n${after}`;
    // Single-letter chrome scraps (e.g. "J\nK") — keep as line breaks
    if (after.length <= 1) return `${before}\n${after}`;
    return `${before}${after}`;
  });
};
