/**
 * Best-effort deterministic extraction from pasted job text.
 * Goal: surface obvious signals for rules + scoring when LLM extraction is unavailable.
 */
import type { ExtractedJobData } from "../types/job.js";
import { dedupeStrings, normalizeText } from "../lib/text.js";
import {
  extractJobPostingMetadata,
  isRejectedCompanyCandidate,
  isWeakJobTitle,
  isWeakOrPlaceholderCompany,
  logJobPostingMetadataDebug,
  validateExtractedCompany,
} from "./jobPostingMetadataExtract.js";
import { resolveCompanyFromText } from "./companyCandidateRules.js";
import {
  parseCitizenshipRequirementText,
  parseClearanceRequirement,
} from "../lib/clearanceCitizenship.js";
import {
  detectStrictFinanceEmployerContext,
  textImpliesNycMetroOrCommutableNj,
} from "../lib/employerLocationSignals.js";
import { parseSalaryFromText } from "../lib/salaryConversion.js";

export type DeterministicExtractResult = {
  partial: Partial<ExtractedJobData>;
  inferredFields: string[];
};

const NYCISH = /\b(nyc|new york|manhattan|brooklyn|queens|bronx|staten island|nj|new jersey|jersey city|hoboken)\b/i;
const US_REMOTE = /\b(remote|work from anywhere|wfh|distributed)\b/i;
const ONSITE = /\b(onsite|on-site|in office|in-office)\b/i;
const HYBRID = /\bhybrid\b/i;

const DEGREE_REQUIRED =
  /\b(bachelor'?s?\s+degree|bachelors\s+degree|bs\s+in|b\.s\.|ba\s+in|undergraduate\s+degree|four[\s-]year\s+degree)\b[^.\n]{0,160}\brequired\b|\b(required|mandatory)\b[^.\n]{0,120}\b(bachelor'?s?|bs\s+in|b\.s\.)\b|\bdegree\s+in\s+(computer science|cs|engineering)\s+required\b/i;
const DEGREE_PREFERRED = /\b(degree|bachelor|bs|ba)\b.*\b(preferred|a plus|nice to have)\b|\b(preferred|a plus)\b.*\b(degree|bachelor)\b/i;

const NEW_GRAD = /\b(new\s+grad|new\s+graduate|graduate\s+program|campus\s+hire|campus\s+recruiting|rotational\s+program|rotation\s+program|early\s+career\s+program|university\s+graduate\s+program)\b/i;
const ASSOCIATE_JUNIOR = /\b(associate\s+software|entry[\s-]level|intern\s+conversion|0\s*-\s*2\s+years)\b/i;

const CITIZENSHIP = /\b(us\s+)?citizenship\s+(is\s+)?required\b|\bcitizenship\s+required\b|\bonly\s+u\.?s\.?\s+citizens\b|\bmust\s+be\s+(?:a\s+)?u\.?s\.?\s+citizen\b/i;
const VISA_NO_SPONSOR = /\bno\s+(visa\s+)?sponsorship\b|\bunable\s+to\s+sponsor\b|\bmust\s+be\s+authorized\s+to\s+work\s+in\s+the\s+u\.?s\.?\b|\bauthorized\s+to\s+work\s+in\s+the\s+u\.?s\.?\s+without\s+sponsorship\b/i;
const CLEARANCE = /\b(security\s+clearance|ts\/sci|top\s+secret|clearance\s+required|dod\s+clearance)\b/i;

const SENIOR = /\b(senior|sr\.|staff|principal|lead\s+engineer|architect)\b/i;

/** Deterministic hints that a role is implementation / integration shaped (helps resume + rules when stack is thin). */
const SIE_IMPLEMENTATION_HINTS = [
  /\bcustomer-facing implementation\b/i,
  /\btechnical implementation\b/i,
  /\bcustomer deployment\b/i,
  /\btechnical onboarding\b/i,
  /\bsolution design\b/i,
  /\bdelivery timelines?\b/i,
  /\bintegration timelines?\b/i,
  /\bintegrations?\s+with\b/i,
  /\bpartner engineering\b/i,
  /\bpre[-\s]?sales\b[^.\n]{0,80}\btechnical\b/i,
  /\bpost[-\s]?sales\b[^.\n]{0,80}\btechnical\b/i,
  /\bapi integration\b/i,
  /\bworkflow implementation\b/i,
  /\bimplementation and integrations?\b/i,
];

const STACK_KEYS: Array<{ re: RegExp; label: string }> = [
  { re: /\btypescript\b/i, label: "TypeScript" },
  { re: /\bjavascript\b|\bjs\b/i, label: "JavaScript" },
  { re: /\bnode\.?js\b|\bnode\b/i, label: "Node.js" },
  { re: /\breact\b/i, label: "React" },
  { re: /\bgraphql\b/i, label: "GraphQL" },
  { re: /\bpostgres(ql)?\b/i, label: "PostgreSQL" },
  { re: /\bmongodb\b|\bmongo\b/i, label: "MongoDB" },
  { re: /\bkubernetes\b|\bk8s\b/i, label: "Kubernetes" },
  { re: /\baws\b|\bamazon web services\b/i, label: "AWS" },
  { re: /\bpython\b/i, label: "Python" },
  { re: /\bgo(lang)?\b/i, label: "Go" },
  { re: /\bjava\b/i, label: "Java" },
  { re: /\brest\s+api|restful|api\s+development\b/i, label: "REST APIs" },
  { re: /\bllm\b|\bgenerative\s+ai\b|\bopenai\b|\brag\b/i, label: "LLM / AI applications" },
];

export { parseSalaryFromText } from "../lib/salaryConversion.js";

const parseTitleFromEmDashHeader = (lines: string[]): string | undefined => {
  if (!lines.length) return undefined;
  const first = lines[0].trim();
  const emDash = first.split(/\s*[—–-]\s*/);
  if (emDash.length >= 2) {
    const left = emDash[0].trim();
    const right = emDash.slice(1).join(" - ").trim();
    if (/engineer|developer|scientist|architect/i.test(left)) {
      return right.length ? `${left} — ${right}` : left;
    }
    if (right.length > 3) return right;
  }
  return undefined;
};

const workModelToRemoteType = (workModel: string | null): ExtractedJobData["remoteType"] | undefined => {
  if (!workModel) return undefined;
  const low = workModel.toLowerCase();
  if (low === "hybrid") return "hybrid";
  if (low === "remote") return "remote";
  if (low === "in person" || low === "in-person" || low === "onsite" || low === "on-site") return "onsite";
  return undefined;
};

const parseLocationLine = (text: string): { location?: string; remoteType?: ExtractedJobData["remoteType"] } => {
  const locMatch = text.match(/\b(?:location|based in|office)\s*:\s*([^\n]+)/i);
  if (locMatch) {
    const chunk = locMatch[1].trim();
    const low = chunk.toLowerCase();
    let remoteType: ExtractedJobData["remoteType"] = "unknown";
    if (HYBRID.test(low)) remoteType = "hybrid";
    else if (ONSITE.test(low) || /^onsite\b/i.test(chunk)) remoteType = "onsite";
    else if (US_REMOTE.test(low) || /^remote\b/i.test(chunk)) remoteType = "remote";
    return { location: chunk, remoteType: remoteType === "unknown" ? undefined : remoteType };
  }

  const remoteFirst = text.match(/\b(remote|hybrid|on-?site)\b[^.\n]{0,160}/i);
  if (remoteFirst) {
    const chunk = remoteFirst[0];
    const low = chunk.toLowerCase();
    let remoteType: ExtractedJobData["remoteType"] = "unknown";
    if (HYBRID.test(low)) remoteType = "hybrid";
    else if (ONSITE.test(low)) remoteType = "onsite";
    else if (US_REMOTE.test(low)) remoteType = "remote";
    return { location: chunk.trim(), remoteType: remoteType === "unknown" ? undefined : remoteType };
  }
  return {};
};

const inferRemoteType = (text: string): ExtractedJobData["remoteType"] => {
  const n = text.toLowerCase();
  if (HYBRID.test(n)) return "hybrid";
  if (ONSITE.test(n) && !US_REMOTE.test(n)) return "onsite";
  if (US_REMOTE.test(n)) return "remote";
  return "unknown";
};

const inferLocationCommutable = (text: string, remoteType: ExtractedJobData["remoteType"]): boolean | undefined => {
  if (remoteType === "remote") return true;
  const n = text
    .toLowerCase()
    .replace(/\([^)]*not\s+commutable\s+from\s+(nyc|new\s+york(\s+city)?)[^)]*\)/gi, " ");
  if (remoteType === "onsite" || remoteType === "hybrid") {
    // NYC / commutable NJ beats other metros mentioned (e.g. multi-office listings).
    if (NYCISH.test(n)) return true;
    if (/\b(dallas|austin|seattle|sf|san francisco|los angeles|chicago|denver|atlanta|boston|miami|philadelphia|phoenix|detroit)\b/i.test(n)) {
      return false;
    }
  }
  return undefined;
};

const sectionLines = (text: string, header: RegExp): string[] => {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const idx = lines.findIndex((l) => header.test(l));
  if (idx === -1) return [];
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^(requirements|responsibilities|qualifications|what you|benefits|about us)/i.test(lines[i])) break;
    if (/^[-•*]\s+/.test(lines[i]) || lines[i].length > 10) out.push(lines[i].replace(/^[-•*]\s+/, "").trim());
    if (out.length >= 12) break;
  }
  return out.filter(Boolean);
};

const bulletLines = (text: string): string[] => {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => /^[-•*]\s+/.test(l))
    .map((l) => l.replace(/^[-•*]\s+/, "").trim())
    .filter((l) => l.length > 5)
    .slice(0, 20);
};

/**
 * Parse normalized multi-line job posting text.
 */
export const extractFromRawText = (normalizedText: string, companyHint?: string): DeterministicExtractResult => {
  const inferredFields: string[] = [];
  const partial: Partial<ExtractedJobData> = {};
  const text = normalizedText;
  const lower = text.toLowerCase();

  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const meta = extractJobPostingMetadata(text);
  logJobPostingMetadataDebug(text, meta);

  const emDashTitle = parseTitleFromEmDashHeader(lines);
  const title = emDashTitle ?? meta.jobTitle ?? undefined;
  if (title) {
    partial.title = title;
    inferredFields.push("title");
  }

  const hintedCompany = companyHint?.trim();
  const company =
    resolveCompanyFromText(text, { companyHint: hintedCompany, preScoringCompany: meta.companyName }) ??
    validateExtractedCompany(hintedCompany || meta.companyName, text, hintedCompany) ??
    hintedCompany ??
    undefined;
  if (company) {
    partial.company = company;
    inferredFields.push("company");
  }

  if (meta.employmentType) {
    partial.employmentType = meta.employmentType;
    inferredFields.push("employmentType");
  }
  if (meta.seniority && !partial.seniority) {
    partial.seniority = meta.seniority.toLowerCase();
    inferredFields.push("seniority");
  }
  const metaRemote = workModelToRemoteType(meta.workModel);
  if (metaRemote) {
    partial.remoteType = metaRemote;
    inferredFields.push("remoteType");
  }
  if (meta.location) {
    partial.location = meta.location;
    inferredFields.push("location");
  }

  const { location, remoteType: locRemote } = parseLocationLine(text);
  if (!meta.location && location) {
    partial.location = location;
    inferredFields.push("location");
  }
  const inferredRt = locRemote ?? inferRemoteType(lower);
  if (inferredRt && inferredRt !== "unknown") {
    partial.remoteType = inferredRt;
    inferredFields.push("remoteType");
  }

  const commutable = inferLocationCommutable(lower, partial.remoteType ?? "unknown");
  if (typeof commutable === "boolean") {
    partial.locationIsCommutable = commutable;
    inferredFields.push("locationIsCommutable");
  }

  const salary = parseSalaryFromText(text);
  if (salary?.min && salary.max) {
    partial.salary = salary;
    inferredFields.push("salary");
  }

  let yMin: number | undefined;
  let yMax: number | undefined;
  let rawYears: string | undefined;
  const mPlus = lower.match(/\b(\d+)\s*\+\s*years?\b/);
  if (mPlus) {
    yMin = Number.parseInt(mPlus[1], 10);
    rawYears = mPlus[0];
  }
  const mRange = lower.match(/\b(\d+)\s*-\s*(\d+)\s+years?\s+of\s+experience\b/);
  if (mRange) {
    yMin = Number.parseInt(mRange[1], 10);
    yMax = Number.parseInt(mRange[2], 10);
    rawYears = mRange[0];
  }
  if (yMin !== undefined) {
    partial.yearsExperience = { raw: rawYears, min: yMin, max: yMax };
    inferredFields.push("yearsExperience");
  }

  if (SENIOR.test(text) || (yMin !== undefined && yMin >= 4)) {
    partial.seniority = "senior";
    inferredFields.push("seniority");
  } else if (NEW_GRAD.test(lower) || ASSOCIATE_JUNIOR.test(lower)) {
    partial.seniority = "junior";
    inferredFields.push("seniority");
  }

  if (DEGREE_REQUIRED.test(text)) {
    const raw = text.match(DEGREE_REQUIRED)?.[0] ?? "Degree required";
    partial.degreeRequirement = { raw, level: "required" };
    inferredFields.push("degreeRequirement");
  } else if (DEGREE_PREFERRED.test(text)) {
    partial.degreeRequirement = { raw: "Degree preferred", level: "preferred" };
    inferredFields.push("degreeRequirement");
  }

  if (VISA_NO_SPONSOR.test(text)) {
    const m = text.match(VISA_NO_SPONSOR);
    partial.visaRequirement = m?.[0] ?? "Visa / work authorization constraint";
    inferredFields.push("visaRequirement");
  }
  if (CITIZENSHIP.test(text)) {
    partial.citizenshipRequirement = parseCitizenshipRequirementText(text) ?? "Citizenship required";
    inferredFields.push("citizenshipRequirement");
  }
  if (CLEARANCE.test(text)) {
    partial.clearanceRequirement =
      parseClearanceRequirement(text, partial.citizenshipRequirement) ?? {
        required: true,
        timing: "unspecified",
        raw: "Clearance required",
      };
    inferredFields.push("clearanceRequirement");
  }

  const stack: string[] = [];
  for (const { re, label } of STACK_KEYS) {
    if (re.test(text)) stack.push(label);
  }
  if (stack.length) {
    partial.stack = dedupeStrings(stack);
    inferredFields.push("stack");
  }

  const reqSection = sectionLines(text, /^requirements?:?$/i);
  const respSection = sectionLines(text, /^responsibilities?:?$/i);
  const quals = sectionLines(text, /^qualifications?:?$/i);

  const bullets = bulletLines(text);
  const keywordReqLines = lines.filter(
    (l) =>
      /\b(bachelor|degree|citizenship|sponsorship|clearance|authorized to work|visa)\b/i.test(l) && l.length < 400,
  );
  const requirements = dedupeStrings([
    ...reqSection,
    ...quals,
    ...bullets.filter((b) => /required|must have|minimum/i.test(b)),
    ...keywordReqLines,
  ]);
  let responsibilities = dedupeStrings([...respSection, ...bullets.filter((b) => /build|ship|design|implement|collaborate/i.test(b))]);

  if (SIE_IMPLEMENTATION_HINTS.some((re) => re.test(text))) {
    responsibilities = dedupeStrings([
      ...responsibilities,
      "Posting highlights customer-side implementation, onboarding, or integration delivery work.",
    ]);
    inferredFields.push("sieImplementationHints");
  }

  if (requirements.length) {
    partial.requirements = requirements.slice(0, 15);
    inferredFields.push("requirements");
  }
  if (responsibilities.length) {
    partial.responsibilities = responsibilities.slice(0, 15);
    inferredFields.push("responsibilities");
  }

  const domainTags: string[] = [];
  const coForDomain = normalizeText(partial.company ?? companyHint ?? "");
  if (detectStrictFinanceEmployerContext(normalizeText(text), coForDomain)) domainTags.push("finance");
  if (/\b(fintech|payments|trading firm|hedge fund)\b/i.test(text)) domainTags.push("fintech");
  if (domainTags.length) {
    partial.domainTags = dedupeStrings(domainTags);
    inferredFields.push("domainTags");
  }

  // Preferred skills: lightweight line detection
  const preferred: string[] = [];
  if (/\bpreferred\b[^.\n]{0,200}/i.test(text)) {
    const seg = text.match(/\bpreferred\b[^.\n]{0,200}/i)?.[0] ?? "";
    for (const { re, label } of STACK_KEYS) {
      if (re.test(seg)) preferred.push(label);
    }
  }
  if (preferred.length) {
    partial.preferredSkills = dedupeStrings(preferred);
    inferredFields.push("preferredSkills");
  }

  if (partial.stack?.length) {
    partial.requiredSkills = dedupeStrings([...partial.stack]);
    inferredFields.push("requiredSkills");
  }

  return { partial, inferredFields: dedupeStrings(inferredFields) };
};

export const mergeExtractedWithHeuristics = (
  base: ExtractedJobData,
  heur: DeterministicExtractResult,
): ExtractedJobData => {
  const h = heur.partial;
  const locationBlob = normalizeText(
    [base.rawText ?? "", base.location ?? "", h.location ?? "", base.title ?? ""].join("\n"),
  );
  const primaryNonNycInLoc =
    /\b(location|based|office)\s*:\s*[^.\n]{0,100}\b(dallas|austin|seattle|san francisco|sf\b|los angeles|chicago|denver|atlanta|boston|miami|philadelphia|phoenix|detroit|houston|portland)\b/i.test(
      locationBlob,
    );
  const mergedCommutable =
    textImpliesNycMetroOrCommutableNj(locationBlob) && !primaryNonNycInLoc
      ? true
      : (h.locationIsCommutable ?? base.locationIsCommutable);
  const merged: ExtractedJobData = {
    ...base,
    company: (() => {
      const raw = base.rawText ?? "";
      return (
        resolveCompanyFromText(raw, {
          llmCompany: base.company,
          preScoringCompany: h.company,
        }) ??
        validateExtractedCompany(h.company ?? base.company, raw) ??
        h.company ??
        base.company ??
        "Unknown Company"
      );
    })(),
    title:
      h.title && isWeakJobTitle(base.title)
        ? h.title
        : base.title && !isWeakJobTitle(base.title)
          ? base.title
          : h.title || base.title || "Unknown Title",
    employmentType: h.employmentType ?? base.employmentType,
    location: h.location ?? base.location,
    remoteType:
      h.remoteType && (base.remoteType === "unknown" || base.remoteType === undefined)
        ? h.remoteType
        : (base.remoteType ?? h.remoteType ?? "unknown"),
    locationIsCommutable: mergedCommutable,
    salary: h.salary?.min && h.salary?.max ? h.salary : base.salary,
    seniority: h.seniority ?? base.seniority,
    yearsExperience: h.yearsExperience ?? base.yearsExperience,
    degreeRequirement: h.degreeRequirement ?? base.degreeRequirement,
    visaRequirement: h.visaRequirement ?? base.visaRequirement,
    citizenshipRequirement: h.citizenshipRequirement ?? base.citizenshipRequirement,
    clearanceRequirement: h.clearanceRequirement ?? base.clearanceRequirement,
    relocationRequired: base.relocationRequired ?? h.relocationRequired,
    stack: dedupeStrings([...(base.stack ?? []), ...(h.stack ?? [])]),
    requiredSkills: dedupeStrings([...(base.requiredSkills ?? []), ...(h.requiredSkills ?? [])]),
    preferredSkills: dedupeStrings([...(base.preferredSkills ?? []), ...(h.preferredSkills ?? [])]),
    domainTags: dedupeStrings([...(base.domainTags ?? []), ...(h.domainTags ?? [])]),
    responsibilities: dedupeStrings([...(base.responsibilities ?? []), ...(h.responsibilities ?? [])]).slice(0, 20),
    requirements: dedupeStrings([...(base.requirements ?? []), ...(h.requirements ?? [])]).slice(0, 20),
    rawText: base.rawText,
    url: base.url,
  };
  return merged;
};

export const listMissingCriticalFields = (e: ExtractedJobData): string[] => {
  const missing: string[] = [];
  if (!e.title || e.title === "Unknown Title") missing.push("title");
  if (!e.company || e.company === "Unknown Company") missing.push("company");
  if (!e.stack?.length && !e.requiredSkills?.length) missing.push("stackOrSkills");
  if (e.remoteType === "unknown") missing.push("remoteType");
  return missing;
};
