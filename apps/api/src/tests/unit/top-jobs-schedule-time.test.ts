import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOP_JOBS_SYNC_TIMEZONE,
  needsCatchupSync,
  scheduledSlotStartUtc,
} from "../../services/topJobs/topJobsScheduleTime.js";

describe("topJobsScheduleTime", () => {
  it("scheduled slot for 6 AM Eastern on a winter date", () => {
    const now = new Date("2026-01-15T15:00:00.000Z");
    const slot = scheduledSlotStartUtc(now, "America/New_York", 6, 0);
    expect(slot.toISOString()).toBe("2026-01-15T11:00:00.000Z");
  });

  it("needs catchup after 6 AM EST when last sync was yesterday", () => {
    const now = new Date("2026-01-15T15:00:00.000Z");
    expect(
      needsCatchupSync({
        lastSyncAt: "2026-01-14T12:00:00.000Z",
        now,
        timeZone: DEFAULT_TOP_JOBS_SYNC_TIMEZONE,
        scheduleHour: 6,
        scheduleMinute: 0,
      }),
    ).toBe(true);
  });

  it("does not need catchup when sync already ran after today's 6 AM EST", () => {
    const now = new Date("2026-01-15T15:00:00.000Z");
    expect(
      needsCatchupSync({
        lastSyncAt: "2026-01-15T12:00:00.000Z",
        now,
        timeZone: DEFAULT_TOP_JOBS_SYNC_TIMEZONE,
        scheduleHour: 6,
        scheduleMinute: 0,
      }),
    ).toBe(false);
  });

  it("does not need catchup before today's 6 AM EST slot", () => {
    const now = new Date("2026-01-15T09:00:00.000Z");
    expect(
      needsCatchupSync({
        lastSyncAt: null,
        now,
        timeZone: DEFAULT_TOP_JOBS_SYNC_TIMEZONE,
        scheduleHour: 6,
        scheduleMinute: 0,
      }),
    ).toBe(false);
  });
});
