const ET_TZ = "America/New_York";

const ymdFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: ET_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const weekdayFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TZ,
  weekday: "short",
});

const weekdayToMonIndex: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function etDateKey(date: Date): string {
  const parts = ymdFmt.formatToParts(date);
  const y = Number(parts.find((p) => p.type === "year")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "month")?.value ?? "0");
  const d = Number(parts.find((p) => p.type === "day")?.value ?? "0");
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function etWeekdayMonIndex(date: Date): number {
  const key = weekdayFmt.format(date);
  return weekdayToMonIndex[key] ?? 0;
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const seed = new Date(`${dateKey}T12:00:00.000Z`);
  seed.setUTCDate(seed.getUTCDate() + deltaDays);
  return `${seed.getUTCFullYear()}-${pad2(seed.getUTCMonth() + 1)}-${pad2(seed.getUTCDate())}`;
}

export function etRangeKeys(now = new Date()): {
  todayKey: string;
  weekStartKey: string;
  monthStartKey: string;
} {
  const todayKey = etDateKey(now);
  const weekStartKey = shiftDateKey(todayKey, -etWeekdayMonIndex(now));
  const [year, month] = todayKey.split("-");
  const monthStartKey = `${year}-${month}-01`;
  return { todayKey, weekStartKey, monthStartKey };
}

export function isDateKeyInRange(dateKey: string, fromKey?: string, toKey?: string): boolean {
  if (fromKey && dateKey < fromKey) return false;
  if (toKey && dateKey > toKey) return false;
  return true;
}
