import { describe, expect, it } from "vitest";
import { canConfirmApplied } from "../../services/jobs/jobs.service.js";

describe("canConfirmApplied", () => {
  it("allows confirm for non-no recommendations", () => {
    expect(canConfirmApplied({ recommendation: "yes", score: { total: 10 } as { total: number } })).toBe(true);
    expect(
      canConfirmApplied({ recommendation: "selective_yes", score: { total: 10 } as { total: number } }),
    ).toBe(true);
  });

  it("allows confirm for recommendation no at low and high scores", () => {
    expect(canConfirmApplied({ recommendation: "no", score: { total: 51 } as { total: number } })).toBe(true);
    expect(canConfirmApplied({ recommendation: "no", score: { total: 50 } as { total: number } })).toBe(true);
    expect(canConfirmApplied({ recommendation: "no", score: { total: 32 } as { total: number } })).toBe(true);
  });
});
