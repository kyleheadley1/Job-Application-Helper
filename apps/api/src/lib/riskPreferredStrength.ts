import type { ExtractedJobData } from "../types/job.js";
import type { UserProfile } from "../types/userProfile.js";
import {
  classifyJdLines,
  type TagSourceStrength,
} from "./jdTagProvenance.js";
import {
  deriveClaimableStackFromText,
  hasClaimableCoverage,
} from "./claimableStack.js";
import { normalizeText } from "./text.js";

const cleanupFragments = (text: string): string =>
  text
    .replace(/\(\s*\)/g, "")
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/,\s*$/g, "")
    .replace(/\s+([,.])/g, "$1")
    .replace(/\bwith\s+and\b/gi, "with")
    .replace(/\band\s+and\b/gi, "and")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,;]\s*/, "")
    .replace(/,\s*$/, "")
    .trim();

const strengthRank = (s: TagSourceStrength): number =>
  s === "REQUIRED" ? 3 : s === "PREFERRED" ? 2 : 1;

const maxStrength = (a: TagSourceStrength | null, b: TagSourceStrength): TagSourceStrength =>
  a == null || strengthRank(b) > strengthRank(a) ? b : a;

export type TechCiteKey =
  | "kubernetes"
  | "docker"
  | "cicd"
  | "devops"
  | "oncall"
  | "go"
  | "graphql"
  | "aws"
  | "gcp";

const TECH_CITE_PATTERNS: Array<{ key: TechCiteKey; patterns: RegExp[] }> = [
  { key: "kubernetes", patterns: [/\bkubernetes\b/i, /\bk8s\b/i, /\bcontainer[-\s]?orchestration\b/i] },
  { key: "docker", patterns: [/\bdocker\b/i, /\bcontainers?\b/i] },
  { key: "cicd", patterns: [/\bci\s*\/\s*cd\b/i, /\bci-cd\b/i, /\bdrone\b/i, /\bjenkins\b/i, /\bgithub\s+actions\b/i] },
  { key: "devops", patterns: [/\bdevops\b/i] },
  { key: "oncall", patterns: [/\bon[-\s]?call\b/i] },
  { key: "go", patterns: [/\bgolang\b/i, /\bgo\b(?!\s*-)/i] },
  { key: "graphql", patterns: [/\bgraphql\b/i] },
  { key: "aws", patterns: [/\baws\b/i] },
  { key: "gcp", patterns: [/\bgcp\b/i, /\bgoogle\s+cloud\b/i] },
];

/** Resolve JD section strength for a tech concept (skillTags + line classification). */
export const resolveJdTechStrength = (
  extracted: ExtractedJobData,
  key: TechCiteKey,
): TagSourceStrength | null => {
  const entry = TECH_CITE_PATTERNS.find((e) => e.key === key);
  if (!entry) return null;

  let best: TagSourceStrength | null = null;
  for (const tag of extracted.skillTags ?? []) {
    if (entry.patterns.some((re) => re.test(tag.term) || re.test(tag.sourceQuote))) {
      best = maxStrength(best, tag.strength);
    }
  }

  const raw = extracted.rawText?.trim() ?? "";
  if (raw) {
    for (const { line, strength } of classifyJdLines(raw)) {
      if (entry.patterns.some((re) => re.test(line))) {
        best = maxStrength(best, strength);
      }
    }
  }

  // Structured preferred/required arrays as fallback when raw classification missed.
  if (best == null) {
    const pref = normalizeText((extracted.preferredSkills ?? []).join("\n"));
    const req = normalizeText(
      [...(extracted.requiredSkills ?? []), ...(extracted.requirements ?? []), ...(extracted.responsibilities ?? [])].join(
        "\n",
      ),
    );
    if (entry.patterns.some((re) => re.test(req))) best = "REQUIRED";
    else if (entry.patterns.some((re) => re.test(pref))) best = "PREFERRED";
  }

  return best;
};

export const candidateHasCicdExperience = (params: {
  userProfile?: UserProfile;
  resumeRawText?: string;
}): boolean => {
  if (params.resumeRawText?.trim()) {
    const stack = deriveClaimableStackFromText(params.resumeRawText);
    if (hasClaimableCoverage(stack, "github_actions")) return true;
  }
  const blob = normalizeText(
    [
      ...(params.userProfile?.strengths ?? []),
      ...(params.userProfile?.flagshipProjects.flatMap((p) => [...p.tech, p.summary]) ?? []),
      ...(params.userProfile?.certifications?.flatMap((c) => c.relatedSkills) ?? []),
    ].join("\n"),
  );
  return /\b(github\s+actions|ci\s*\/\s*cd|ci-cd|continuous\s+integration)\b/i.test(blob);
};

export const candidateHasProductionDebugExperience = (params: {
  userProfile?: UserProfile;
  resumeRawText?: string;
}): boolean => {
  const blob = normalizeText(
    [
      params.resumeRawText ?? "",
      ...(params.userProfile?.strengths ?? []),
      ...(params.userProfile?.recurringStory ?? []),
      ...(params.userProfile?.flagshipProjects.flatMap((p) => [p.summary, ...p.outcomes]) ?? []),
    ].join("\n"),
  );
  return /\b(production|reliabilit|logging|retries|debugging|troubleshoot|incident|on[-\s]?call|high\s+availability)\b/i.test(
    blob,
  );
};

const SIGNIFICANT_STRETCH_RE =
  /\b(significant|major)\b[^.\n]{0,80}\b(stretch|gap|mismatch|risk)\b|\bcould be a stretch\b|\bweaker\s+(infra|sre|devops|platform)\b|\bstretch\b[^.\n]{0,40}\b(devops|kubernetes|ci\s*\/\s*cd|container)\b/i;

/**
 * Soften or drop Key Risk lines that treat Preferred-only skills as hard stretch,
 * and avoid "weaker infra/CI/CD" claims when the candidate has documented CI/CD.
 */
export const rewritePreferredStrengthRiskLine = (
  text: string,
  params: {
    extracted: ExtractedJobData;
    userProfile?: UserProfile;
    resumeRawText?: string;
  },
): string => {
  if (!text.trim()) return text;
  let t = text;

  const k8s = resolveJdTechStrength(params.extracted, "kubernetes");
  const cicd = resolveJdTechStrength(params.extracted, "cicd");
  const devops = resolveJdTechStrength(params.extracted, "devops");
  const oncall = resolveJdTechStrength(params.extracted, "oncall");
  const docker = resolveJdTechStrength(params.extracted, "docker");

  const hasCicd = candidateHasCicdExperience(params);
  const hasProdDebug = candidateHasProductionDebugExperience(params);

  const infraPreferredOnly =
    (k8s === "PREFERRED" || k8s == null) &&
    (cicd === "PREFERRED" || cicd == null || hasCicd) &&
    (devops === "PREFERRED" || devops == null || hasCicd) &&
    (docker === "PREFERRED" || docker == null || hasCicd);

  // Narrow inaccurate "weaker infra/SRE/DevOps" claims when CI/CD is claimable.
  if (hasCicd && /\bweaker\s+(infra(?:structure)?|sre|devops)\b/i.test(t)) {
    if (k8s === "REQUIRED") {
      t = t.replace(
        /\bweaker\s+(infra(?:structure)?|sre|devops)[^.]*\b/gi,
        "limited Kubernetes/container-orchestration experience ",
      );
    } else if (k8s === "PREFERRED") {
      t = t.replace(
        /\bweaker\s+(infra(?:structure)?|sre|devops)[^.]*\b/gi,
        "Preferred Kubernetes/container-orchestration experience is a nice-to-have gap ",
      );
    } else {
      t = t.replace(/\bweaker\s+(infra(?:structure)?|sre|devops)[^.]*\.?/gi, "");
    }
  }

  // Significant stretch citing Preferred-only DevOps/K8s/CI/CD.
  if (SIGNIFICANT_STRETCH_RE.test(t) || /\b(devops|kubernetes|ci\s*\/\s*cd|container[-\s]?orchestr)/i.test(t)) {
    const citesPreferredInfra =
      (/\bkubernetes\b|\bk8s\b|\bcontainer[-\s]?orchestr/i.test(t) && k8s === "PREFERRED") ||
      (/\bci\s*\/\s*cd\b/i.test(t) && (cicd === "PREFERRED" || hasCicd)) ||
      (/\bdevops\b/i.test(t) && (devops === "PREFERRED" || hasCicd));

    if (citesPreferredInfra && infraPreferredOnly) {
      // On-call alone with production-debug evidence is not a significant stretch.
      if (/\bon[-\s]?call\b/i.test(t) && (oncall === "REQUIRED" || oncall === "PREFERRED") && hasProdDebug) {
        return "";
      }
      if (k8s === "PREFERRED" && !hasCicd) {
        return cleanupFragments(
          "Preferred Kubernetes/container-orchestration experience is a nice-to-have, not a required screen bar.",
        );
      }
      if (k8s === "PREFERRED" && hasCicd) {
        return cleanupFragments(
          "Preferred Kubernetes/container-orchestration experience is a narrow nice-to-have gap (CI/CD tooling is already demonstrated).",
        );
      }
      // Preferred CI/CD/DevOps only, candidate has CI/CD → drop.
      if ((cicd === "PREFERRED" || devops === "PREFERRED") && hasCicd) {
        return "";
      }
      return cleanupFragments(
        "Preferred DevOps/CI/CD tooling is a nice-to-have, not a required screen bar.",
      );
    }

    // Mixed: strip Preferred-only tokens from a hard-stretch sentence; keep Required cites.
    if (/\b(significant|major|stretch)\b/i.test(t)) {
      if (k8s === "PREFERRED") {
        t = t.replace(/\bkubernetes\b/gi, "").replace(/\bk8s\b/gi, "");
        t = t.replace(/\bcontainer[-\s]?orchestration\b/gi, "");
      }
      if (cicd === "PREFERRED" || hasCicd) {
        t = t.replace(/\bci\s*\/\s*cd\b/gi, "");
        t = t.replace(/\bci-cd\b/gi, "");
      }
      if (devops === "PREFERRED" || (devops !== "REQUIRED" && hasCicd)) {
        t = t.replace(/\bdevops\b/gi, "");
      }
      t = t.replace(/\bon[-\s]?call\b/gi, (match) =>
        hasProdDebug && oncall !== "REQUIRED" ? "" : match,
      );
      t = cleanupFragments(
        t
          .replace(/\(\s*[,/]*\s*\)/g, "")
          .replace(/\bresponsibilities\s*\(\s*\)/gi, "responsibilities")
          .replace(/\band\s+and\b/gi, "and")
          .replace(/\s+\/\s+/g, " ")
          .replace(/\bSignificant\s+and\b/gi, "Significant")
          .replace(/\bSignificant\s+responsibilities\b/gi, "On-call responsibilities"),
      );
      // If Preferred stripping left a vacuous stretch claim, drop it.
      if (
        /\bcould be a stretch\b/i.test(t) &&
        !/\b(kubernetes|k8s|required|must)\b/i.test(t) &&
        (hasProdDebug || !/\bon[-\s]?call\b/i.test(t))
      ) {
        return "";
      }
    }
  }

  return cleanupFragments(t);
};
