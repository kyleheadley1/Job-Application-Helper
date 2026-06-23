/** IANA timezone for the daily Top Jobs sync window (default US Eastern). */
export const DEFAULT_TOP_JOBS_SYNC_TIMEZONE = "America/New_York";

type YmdHm = { year: number; month: number; day: number; hour: number; minute: number };

const zonedParts = (date: Date, timeZone: string): YmdHm => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const v = parts.find((p) => p.type === type)?.value ?? "0";
    return Number(v);
  };

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
  };
};

/**
 * Convert a wall-clock time in `timeZone` to a UTC `Date` (handles DST).
 */
export const wallClockToUtc = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date => {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i += 1) {
    const shown = zonedParts(new Date(utcMs), timeZone);
    const targetTotal = Date.UTC(year, month - 1, day, hour, minute, 0);
    const shownTotal = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, 0);
    utcMs -= shownTotal - targetTotal;
  }
  return new Date(utcMs);
};

/** Start of today's scheduled sync slot in UTC (e.g. 6:00 AM America/New_York). */
export const scheduledSlotStartUtc = (
  now: Date,
  timeZone: string,
  hour: number,
  minute: number,
): Date => {
  const z = zonedParts(now, timeZone);
  return wallClockToUtc(z.year, z.month, z.day, hour, minute, timeZone);
};

/**
 * True when the app is live after today's scheduled time but no sync has completed
 * since that slot (missed 6 AM while API was down → run on startup).
 */
export const needsCatchupSync = (params: {
  lastSyncAt: string | null;
  now?: Date;
  timeZone: string;
  scheduleHour: number;
  scheduleMinute: number;
}): boolean => {
  const now = params.now ?? new Date();
  const slotStart = scheduledSlotStartUtc(now, params.timeZone, params.scheduleHour, params.scheduleMinute);

  if (now.getTime() < slotStart.getTime()) {
    return false;
  }

  if (!params.lastSyncAt) {
    return true;
  }

  const last = new Date(params.lastSyncAt);
  if (Number.isNaN(last.getTime())) {
    return true;
  }

  return last.getTime() < slotStart.getTime();
};
