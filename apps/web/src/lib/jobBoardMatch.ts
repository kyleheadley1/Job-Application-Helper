/** Job-board paste chrome (e.g. Next Match AI "77% STRONG MATCH") — not app triage score. */

export function extractBoardMatchPercent(rawText?: string): number | null {
  if (!rawText?.trim()) return null;
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
