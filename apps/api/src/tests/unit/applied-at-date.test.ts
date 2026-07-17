import { describe, expect, it } from "vitest";
import { appliedAtToDateInputValue, toAppliedAtIso } from "../../lib/appliedAtDate.js";

describe("appliedAtDate", () => {
  it("normalizes YYYY-MM-DD to noon UTC ISO", () => {
    expect(toAppliedAtIso("2026-07-10")).toBe("2026-07-10T12:00:00.000Z");
  });

  it("round-trips date input values from stored ISO", () => {
    expect(appliedAtToDateInputValue("2026-07-10T12:00:00.000Z")).toBe("2026-07-10");
  });

  it("rejects invalid calendar dates", () => {
    expect(() => toAppliedAtIso("2026-02-31")).toThrow(/invalid applied date/i);
  });
});
