import { describe, expect, it } from "vitest";
import { nextSyncDelayMs } from "../../services/gmail/gmailSyncScheduler.js";

const HOUR = 60 * 60 * 1000;
const now = Date.parse("2026-10-03T12:00:00.000Z");

describe("nextSyncDelayMs", () => {
  it("syncs shortly after startup when never synced or overdue", () => {
    expect(nextSyncDelayMs(undefined, HOUR, now)).toBe(60_000);
    expect(nextSyncDelayMs("2026-10-03T09:00:00.000Z", HOUR, now)).toBe(60_000);
  });

  it("waits out the rest of the interval after a recent (possibly manual) sync", () => {
    expect(nextSyncDelayMs("2026-10-03T11:40:00.000Z", HOUR, now)).toBe(40 * 60_000);
  });

  it("never waits longer than one interval, even with a future timestamp", () => {
    expect(nextSyncDelayMs("2026-10-03T15:00:00.000Z", HOUR, now)).toBe(HOUR);
  });
});
