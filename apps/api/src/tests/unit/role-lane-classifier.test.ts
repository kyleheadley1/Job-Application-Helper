import { describe, expect, it } from "vitest";
import { classifyRoleLane } from "../../lib/roleFunctionClassifier.js";
import { loadCalibrationFixture } from "../fixtures/calibrationAnchors.js";

describe("classifyRoleLane (Item G)", () => {
  it("maps Precisely to product_frontend", () => {
    const job = loadCalibrationFixture("preciselyAssociateSweFrontend").extracted;
    expect(classifyRoleLane(job).label).toBe("product_frontend");
  });

  it("maps StubHub Core Compute to platform_infra", () => {
    const job = loadCalibrationFixture("stubHubCoreCompute").extracted;
    expect(classifyRoleLane(job).label).toBe("platform_infra");
  });

  it("maps Cherry Hill to a product SWE lane (fullstack or backend)", () => {
    const job = loadCalibrationFixture("cherryHill").extracted;
    const lane = classifyRoleLane(job);
    expect(["product_fullstack", "product_backend"]).toContain(lane.label);
  });

  it("maps Pathpoint-shaped analyst to adjacent_non_engineering", () => {
    const lane = classifyRoleLane({
      company: "Pathpoint",
      title: "Technical Implementation Analyst",
      stack: ["REST API"],
      requiredSkills: ["requirements documentation"],
      preferredSkills: [],
      domainTags: [],
      responsibilities: [
        "Gather business requirements and author functional requirements documentation",
        "Create QA test plans and coordinate UAT",
      ],
      requirements: ["Experience writing requirements documentation"],
      rawText: "Technical Implementation Analyst. Requirements docs, QA test plans, UAT.",
    });
    expect(lane.label).toBe("adjacent_non_engineering");
    expect(lane.adjacentKind).toBe("implementation_analyst");
  });
});
