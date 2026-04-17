import fs from "node:fs";
import path from "node:path";
import { env, repoRootDir } from "./env.js";
import type { ResumeType } from "../types/resume.js";

type ResumePathMap = Record<ResumeType, { txt: string; pdf: string }>;

const DEFAULT_RESUME_DIR = path.join(repoRootDir, "apps", "api", "data", "resumes");

const resolveResumeDir = (): string => {
  const fromEnv = (env as { resumeContextDir?: string }).resumeContextDir?.trim();
  if (!fromEnv) return DEFAULT_RESUME_DIR;
  return path.isAbsolute(fromEnv) ? fromEnv : path.join(repoRootDir, fromEnv);
};

export const resumeContextDir = resolveResumeDir();

export const resumeFilePaths: ResumePathMap = {
  SWE: {
    txt: path.join(resumeContextDir, "swe_resume.txt"),
    pdf: path.join(resumeContextDir, "swe_resume.pdf"),
  },
  SIE: {
    txt: path.join(resumeContextDir, "sie_resume.txt"),
    pdf: path.join(resumeContextDir, "sie_resume.pdf"),
  },
  EARLY_CAREER: {
    txt: path.join(resumeContextDir, "early_career_resume.txt"),
    pdf: path.join(resumeContextDir, "early_career_resume.pdf"),
  },
};

export const resolveResumeCandidatePaths = (type: ResumeType): string[] => [
  resumeFilePaths[type].txt,
  resumeFilePaths[type].pdf,
];

export const pickResumeSourcePath = (type: ResumeType): { path: string; kind: "txt" | "pdf" } | null => {
  const txt = resumeFilePaths[type].txt;
  if (fs.existsSync(txt)) return { path: txt, kind: "txt" };
  const pdf = resumeFilePaths[type].pdf;
  if (fs.existsSync(pdf)) return { path: pdf, kind: "pdf" };
  return null;
};
