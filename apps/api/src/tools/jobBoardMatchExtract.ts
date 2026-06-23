/** Job-board paste chrome (e.g. Next Match AI "77% STRONG MATCH") — not app scores. */

export function isBoardMatchChromeLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^\d{1,3}%$/.test(t)) return true;
  if (/\bstrong\s+match\b/i.test(t)) return true;
  if (/\bexperience\.?\s*level\b/i.test(t) && /\bskill\b/i.test(t)) return true;
  if (/\bmatch(ed)?\s+(?:score|level)\b/i.test(t)) return true;
  return false;
}

/** Remove pasted job-board match chrome so it is never fed into scoring prompts. */
export function stripBoardMatchChromeFromText(rawText: string): string {
  return rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !isBoardMatchChromeLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Best-effort percent from pasted job-board match widgets (not triage score). */
export function extractBoardMatchPercent(rawText: string): number | null {
  const lines = rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const line = lines[i]!;
    const inline = line.match(/\b(\d{1,3})%\s*STRONG\s+MATCH\b/i);
    if (inline) {
      const pct = Number(inline[1]);
      if (pct >= 0 && pct <= 100) return pct;
    }
    const pctOnly = line.match(/^(\d{1,3})%$/);
    if (pctOnly) {
      const pct = Number(pctOnly[1]);
      if (pct >= 0 && pct <= 100) {
        const next = lines[i + 1] ?? "";
        if (/strong match|experience|skill match/i.test(next)) return pct;
      }
    }
  }
  return null;
}
