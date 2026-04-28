import { describe, expect, it } from "vitest";
import { canConfirmApplied } from "../../services/jobs/jobs.service.js";

describe("canConfirmApplied", () => {
  it("allows confirm for non-no recommendations", () => {
    expect(canConfirmApplied({ recommendation: "yes", score: { total: 10 } as { total: number } })).toBe(true);
    expect(
      canConfirmApplied({ recommendation: "selective_yes", score: { total: 10 } as { total: number } }),
    ).toBe(true);
  });

  it("allows override for recommendation no when score is above 50", () => {
    expect(canConfirmApplied({ recommendation: "no", score: { total: 51 } as { total: number } })).toBe(true);
  });

  it("blocks recommendation no when score is 50 or lower", () => {
    expect(canConfirmApplied({ recommendation: "no", score: { total: 50 } as { total: number } })).toBe(false);
    expect(canConfirmApplied({ recommendation: "no", score: { total: 32 } as { total: number } })).toBe(false);
  });
});
