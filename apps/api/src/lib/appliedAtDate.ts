/**
 * Normalize a user-entered applied date (YYYY-MM-DD or ISO) to a stable noon-UTC ISO.
 * Noon UTC keeps calendar-day display stable across US timezones.
 */
export const toAppliedAtIso = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Applied date is required.");
  }
  const ymd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (
      d.getUTCFullYear() !== year ||
      d.getUTCMonth() !== month - 1 ||
      d.getUTCDate() !== day
    ) {
      throw new Error("Invalid applied date.");
    }
    return d.toISOString();
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid applied date.");
  }
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12, 0, 0),
  ).toISOString();
};

/** YYYY-MM-DD for `<input type="date">` from a stored appliedAt ISO. */
export const appliedAtToDateInputValue = (iso?: string | null): string => {
  if (!iso?.trim()) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
