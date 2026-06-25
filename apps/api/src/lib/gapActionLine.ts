import type {
  SpecializationGap,
  SpecializationGapLever,
} from "../types/scoring.js";

const leverInstruction = (lever: SpecializationGapLever): string => {
  switch (lever) {
    case "resume":
      return "reframe backend experience via resume";
    case "portfolio":
      return "build portfolio evidence first";
    case "upskill":
      return "close the gap with real project work";
    default:
      return "not addressable in-loop";
  }
};

const tailorSuffix = (worthTailoring: boolean, severity: SpecializationGap["severity"]): string =>
  worthTailoring && severity !== "central" ? " Worth a tailored resume + cover letter." : "";

/** One coherent action sentence derived from structured gap fields — no template fragments. */
export const composeSpecializationGapActionLine = (
  prefix: string,
  gap: SpecializationGap,
  worthTailoring: boolean,
): string => {
  if (gap.kind === "backend_stack" && gap.jdSide && gap.resumeSide) {
    const core = `${prefix} — role leads with ${gap.jdSide} on the backend; your resume leads with ${gap.resumeSide} — ${leverInstruction(gap.lever)}`;
    return `${core}.${tailorSuffix(worthTailoring, gap.severity)}`;
  }

  if (gap.kind === "design_portfolio") {
    const pillar = gap.jdSide ?? gap.name;
    if (gap.severity === "central") {
      return `${prefix} — ${pillar} is central and your evidence is ${gap.resumeSide ?? "engineering-side"}; a referral won't close it. Build portfolio evidence first.`;
    }
    const core = `${prefix} — ${pillar} is load-bearing but your evidence is ${gap.resumeSide ?? "engineering-side"}; build portfolio evidence via resume framing`;
    return `${core}.${tailorSuffix(worthTailoring, gap.severity)}`;
  }

  if (gap.kind === "enterprise_iam") {
    const pillar = gap.jdSide ?? gap.name;
    if (gap.severity === "central") {
      return `${prefix} — ${pillar} is central and your evidence is ${gap.resumeSide ?? "OAuth-only"}; a referral won't close it. ${leverInstruction(gap.lever).charAt(0).toUpperCase()}${leverInstruction(gap.lever).slice(1)}.`;
    }
    return `${prefix} — ${gap.evidence}. ${leverInstruction(gap.lever).charAt(0).toUpperCase()}${leverInstruction(gap.lever).slice(1)}.`;
  }

  return `${prefix} — ${gap.evidence}. ${leverInstruction(gap.lever).charAt(0).toUpperCase()}${leverInstruction(gap.lever).slice(1)}.${tailorSuffix(worthTailoring, gap.severity)}`;
};

/** Test helper — catches stutter from fragment concatenation. */
export const actionLineHasDuplicateFragments = (line: string): boolean => {
  const lower = line.toLowerCase();
  if (/\bworth\s+worth\b/.test(lower)) return true;
  if (/\breframe\b.*\breframe\b/.test(lower)) return true;
  if (/tailored resume.*tailored resume/.test(lower)) return true;
  return false;
};

export const backendTechFromGapActionLine = (line: string): string | undefined => {
  const match = line.match(/leads with ([^;]+) on the backend/i);
  return match?.[1]?.trim();
};
