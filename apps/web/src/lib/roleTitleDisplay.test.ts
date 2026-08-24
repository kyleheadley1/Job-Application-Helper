import { describe, expect, it } from "vitest";
import { jobHeaderLabel } from "./jobDisplay";
import {
  formatRoleTitle,
  resolveDisplayTitle,
  resolveVagueRoleReferences,
  roleTeamQualifier,
} from "./roleTitleDisplay";

describe("roleTitleDisplay", () => {
  it("formats team-qualified titles with an em dash", () => {
    expect(formatRoleTitle("Software Engineer, Reflections")).toBe(
      "Software Engineer — Reflections",
    );
    expect(formatRoleTitle("Software Engineer, AI Platforms")).toBe(
      "Software Engineer — AI Platforms",
    );
    expect(formatRoleTitle("Software Engineer, Interactive News")).toBe(
      "Software Engineer — Interactive News",
    );
  });

  it("extracts team qualifiers", () => {
    expect(roleTeamQualifier("Software Engineer, Reflections")).toBe("Reflections");
    expect(roleTeamQualifier("Software Engineer")).toBeNull();
  });

  it("recovers team from raw JD when stored title was stripped", () => {
    const display = resolveDisplayTitle({
      title: "Software Engineer",
      rawText:
        "The New York Times\nSoftware Engineer, Reflections\n10,001+ employees\nHybrid — New York, NY",
    });
    expect(display).toBe("Software Engineer — Reflections");
  });

  it("resolves vague this role references to the team", () => {
    const out = resolveVagueRoleReferences("This role could be a stretch on Python.", {
      title: "Software Engineer, AI Platforms",
    });
    expect(out.toLowerCase()).toContain("ai platforms");
    expect(out.toLowerCase()).not.toMatch(/\bthis role\b/);
  });
});

describe("jobHeaderLabel", () => {
  it("always includes title/team, not company alone", () => {
    const label = jobHeaderLabel({
      company: "The New York Times",
      companyDisplayName: "The New York Times",
      title: "Software Engineer, Reflections",
      rawText: "The New York Times\nSoftware Engineer, Reflections",
    });
    expect(label).toContain("The New York Times");
    expect(label).toContain("Software Engineer");
    expect(label).toContain("Reflections");
  });

  it("distinguishes three concurrent NYT postings", () => {
    const labels = [
      jobHeaderLabel({
        company: "The New York Times",
        title: "Software Engineer, AI Platforms",
      }),
      jobHeaderLabel({
        company: "The New York Times",
        title: "Software Engineer, Interactive News",
      }),
      jobHeaderLabel({
        company: "The New York Times",
        title: "Software Engineer, Reflections",
      }),
    ];
    expect(new Set(labels).size).toBe(3);
    expect(labels[0]).toContain("AI Platforms");
    expect(labels[1]).toContain("Interactive News");
    expect(labels[2]).toContain("Reflections");
  });
});
