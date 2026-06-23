import type { ResumeType } from "../types/resume.js";
import type { ResumeContextSet } from "../types/resumeContext.js";
import { normalizeText } from "./text.js";

export type SkillCoverage = "full" | "partial";

export type ClaimableSkill = {
  id: string;
  label: string;
  coverage: SkillCoverage;
};

export type ClaimableStack = {
  resumeType: ResumeType;
  skills: ClaimableSkill[];
};

const CLAIMABLE_CATALOG: Array<{ id: string; label: string; patterns: RegExp[] }> = [
  { id: "typescript", label: "TypeScript", patterns: [/\btype\s*script\b/i] },
  { id: "javascript", label: "JavaScript", patterns: [/\bjava\s*script\b/i, /\bes6\+?\b/i] },
  { id: "python", label: "Python", patterns: [/\bpython\b/i] },
  { id: "nodejs", label: "Node.js", patterns: [/\bnode(?:\.js)?\b/i] },
  { id: "express", label: "Express", patterns: [/\bexpress\b/i] },
  { id: "rest_apis", label: "REST APIs", patterns: [/\brest(?:ful)?\s+apis?\b/i, /\brest\s+api\b/i] },
  { id: "react", label: "React", patterns: [/\breact\b/i] },
  { id: "tailwind", label: "Tailwind", patterns: [/\btailwind\b/i] },
  { id: "mui", label: "MUI", patterns: [/\bmui\b/i, /\bmaterial\s+ui\b/i] },
  { id: "mongodb", label: "MongoDB", patterns: [/\bmongo(?:db)?\b/i] },
  { id: "postgresql", label: "PostgreSQL", patterns: [/\bpostgres(?:ql)?\b/i] },
  { id: "mysql", label: "MySQL", patterns: [/\bmysql\b/i] },
  { id: "sql", label: "SQL", patterns: [/\bsql\b/i] },
  {
    id: "aws",
    label: "AWS",
    patterns: [/\baws\b/i, /\bec2\b/i, /\blambda\b/i, /\bs3\b/i],
  },
  { id: "docker", label: "Docker", patterns: [/\bdocker\b/i] },
  {
    id: "github_actions",
    label: "GitHub Actions / CI-CD",
    patterns: [/\bgithub\s+actions\b/i, /\bci\/cd\b/i, /\bci\s*cd\b/i],
  },
  { id: "jest", label: "Jest", patterns: [/\bjest\b/i] },
  { id: "supertest", label: "SuperTest", patterns: [/\bsuper\s*test\b/i] },
  { id: "oauth", label: "OAuth", patterns: [/\boauth\b/i] },
  { id: "openai_api", label: "OpenAI API", patterns: [/\bopenai\s+api\b/i, /\bopenai\b/i] },
  { id: "rag", label: "RAG", patterns: [/\brag\b/i, /\bretrieval[-\s]?augmented\b/i] },
  {
    id: "vector_search",
    label: "Vector search",
    patterns: [/\bvector\s+(search|database|db)\b/i, /\bqdrant\b/i, /\bpinecone\b/i],
  },
  { id: "linux", label: "Linux basics", patterns: [/\blinux\b/i, /\blpi\b/i] },
];

const splitResumeSections = (raw: string): { skillsSection: string; experienceSection: string } => {
  const text = raw.replace(/\r/g, "\n");
  const skillsStart = text.search(/\btechnical\s+skills\b/i);
  const experienceStart = text.search(/\bexperience\b/i);
  const educationStart = text.search(/\beducation\b/i);

  const skillsSection =
    skillsStart >= 0
      ? text.slice(
          skillsStart,
          experienceStart >= 0 ? experienceStart : educationStart >= 0 ? educationStart : text.length,
        )
      : "";

  const slicedExperience =
    experienceStart >= 0 ? text.slice(experienceStart, educationStart >= 0 ? educationStart : text.length) : text;
  const bulletEvidence = text
    .split("\n")
    .filter(
      (line) =>
        /[●•▪◦‣·]\s/u.test(line) ||
        /\b(built|implemented|developed|led|shipped|integrated|designed|delivered|created)\b/i.test(line),
    )
    .join("\n");
  const experienceSection = `${slicedExperience}\n${bulletEvidence}`;

  return { skillsSection, experienceSection };
};

/** Derive claimable skills from resume text; experience bullets outweigh skills-list-only mentions. */
export const deriveClaimableStackFromText = (
  resumeRawText: string,
  resumeType: ResumeType = "SWE",
): ClaimableStack => {
  const { skillsSection, experienceSection } = splitResumeSections(resumeRawText);
  const skills: ClaimableSkill[] = [];

  for (const entry of CLAIMABLE_CATALOG) {
    const inExperience = entry.patterns.some((re) => re.test(experienceSection));
    const inSkills = entry.patterns.some((re) => re.test(skillsSection));
    if (inExperience) {
      skills.push({ id: entry.id, label: entry.label, coverage: "full" });
    } else if (inSkills) {
      skills.push({ id: entry.id, label: entry.label, coverage: "partial" });
    }
  }

  return { resumeType, skills };
};

export const claimableStackFromContexts = (
  resumeContexts: ResumeContextSet | undefined,
  activeResumeType: ResumeType = "SWE",
): ClaimableStack => {
  const ctx = resumeContexts?.[activeResumeType] ?? resumeContexts?.SWE;
  if (ctx?.rawText?.trim()) {
    return deriveClaimableStackFromText(ctx.rawText, activeResumeType);
  }
  return deriveClaimableStackFromText("", activeResumeType);
};

export const claimableSkillIds = (stack: ClaimableStack): Set<string> =>
  new Set(stack.skills.map((s) => s.id));

export const claimableSkillLabels = (stack: ClaimableStack): Set<string> =>
  new Set(stack.skills.map((s) => normalizeText(s.label)));

export const hasClaimableCoverage = (stack: ClaimableStack, skillId: string): boolean =>
  stack.skills.some((s) => s.id === skillId);
