import { normalizeText } from "../lib/text.js";
import {
  extractCompanyFromPostedHeader,
  isValidCompanyCandidate,
  resolveCompanyFromText,
} from "./companyCandidateRules.js";

export type CompanyConfidence = "direct_or_unclear" | "agency_only" | "explicit_employer";

export type CompanyPresentation = {
  listingCompanyName: string | null;
  employerCompanyName: string | null;
  agencyCompanyName: string | null;
  companyDisplayName: string;
  companyConfidence: CompanyConfidence;
  companyExtractionNotes: string[];
};

const AGENCY_NAME_RE =
  /\b(talent acquisition|recruiting|recruitment|recruiter|staffing|search firm|search group|talent partners|talent solutions|executive search)\b/i;

const AGENCY_JD_RE =
  /\b(working with|work with|our client|we are partnering with|we're partnering with|we are representing|we're representing|on behalf of|confidential client|undisclosed client|client company)\b/i;

const VAGUE_EMPLOYER_RE =
  /\b(?:a|an|the)\s+(?:fast[-\s]?growing|profitable|leading|innovative|well[-\s]?funded|stealth|technology|tech|software|ai|startup|early[-\s]?stage)\s+(?:company|organization|firm|team|employer|client)\b/i;

const SELF_EMPLOYER_RE = (company: string): RegExp =>
  new RegExp(
    `\\b${escapeRegExp(company)}\\s+is\\s+(?:a|an|the)\\s+(?:fast[-\\s]?growing|profitable|leading|innovative|technology|tech|software|ai|startup|early[-\\s]?stage|global)?\\s*(?:company|organization|firm|team|employer)`,
    "i",
  );

const EXPLICIT_EMPLOYER_PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    re: /\bour client[,:\s]+([A-Z][A-Za-z0-9&.'\-\s]{1,48}?)(?:\s+is|\s+are|\s+has|\s+seeks|,|\.|\s+hiring|\s+looking)/i,
    label: "our client",
  },
  {
    re: /(?:^|\n)\s*Client:\s*([A-Z][A-Za-z0-9&.'\- ]{1,48})\b/,
    label: "Client:",
  },
  {
    re: /\b(?:representing|partnering with|on behalf of)\s+([A-Z][A-Za-z0-9&.'\-\s]{1,48}?)(?:[,.\s]|$)/i,
    label: "representing/partnering",
  },
  {
    re: /\b(?:join|work (?:at|for)|hiring (?:at|for))\s+([A-Z][A-Za-z0-9&.'\-\s]{1,48}?)(?:[,.\s]|$)/i,
    label: "join/work at",
  },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanEmployerCandidate(raw: string): string | null {
  let t = raw.trim().replace(/\s+/g, " ");
  t = t.replace(/[,.;:]+$/, "").trim();
  if (!t || t.length < 2 || t.length > 48) return null;
  if (VAGUE_EMPLOYER_RE.test(t)) return null;
  if (/^(the|a|an|our|their|this|that)\b/i.test(t)) return null;
  if (AGENCY_NAME_RE.test(t) && !/\b(ai|labs|tech)\b/i.test(t)) return null;
  if (/^(company|client|employer|organization|firm|team)$/i.test(t)) return null;
  if (!isValidCompanyCandidate(t)) return null;
  return t;
}

export function looksLikeAgencyCompanyName(name: string): boolean {
  return AGENCY_NAME_RE.test(name.trim());
}

export function extractExplicitEmployerFromJd(
  rawText: string,
  listingCompanyName: string | null,
): { employer: string | null; note: string | null } {
  const blob = rawText.slice(0, 8000);
  for (const { re, label } of EXPLICIT_EMPLOYER_PATTERNS) {
    const m = blob.match(re);
    if (!m?.[1]) continue;
    const candidate = cleanEmployerCandidate(m[1]);
    if (!candidate) continue;
    if (listingCompanyName && normalizeText(candidate) === normalizeText(listingCompanyName)) continue;
    return { employer: candidate, note: `Explicit employer from JD (${label}).` };
  }
  return { employer: null, note: null };
}

function jdSignalsAgencyRepresentation(rawText: string): boolean {
  return AGENCY_JD_RE.test(rawText) || VAGUE_EMPLOYER_RE.test(rawText);
}

function listingSelfDescribesAsEmployer(listingCompanyName: string, rawText: string): boolean {
  const company = listingCompanyName.trim();
  if (!company) return false;
  if (SELF_EMPLOYER_RE(company).test(rawText)) return true;
  const intro = rawText.slice(0, Math.min(rawText.length, 1200));
  return new RegExp(`\\b${escapeRegExp(company)}\\b`, "i").test(intro) && !AGENCY_JD_RE.test(intro.slice(0, 400));
}

export function resolveCompanyPresentation(params: {
  listingCompanyName: string | null | undefined;
  rawText?: string;
  companyHint?: string;
}): CompanyPresentation {
  const notes: string[] = [];
  let listing =
    params.listingCompanyName?.trim() ||
    params.companyHint?.trim() ||
    null;
  if (listing && !isValidCompanyCandidate(listing)) {
    notes.push(`Rejected prose-like listing company "${listing}".`);
    listing = null;
  }
  const rawText = params.rawText ?? "";

  if (!listing && rawText.trim()) {
    listing =
      resolveCompanyFromText(rawText, { companyHint: params.companyHint }) ??
      (params.companyHint?.trim() && isValidCompanyCandidate(params.companyHint)
        ? params.companyHint.trim()
        : null);
  }

  if (!listing && !rawText.trim()) {
    return {
      listingCompanyName: null,
      employerCompanyName: null,
      agencyCompanyName: null,
      companyDisplayName: "Unknown Company",
      companyConfidence: "direct_or_unclear",
      companyExtractionNotes: ["No listing company or JD text available."],
    };
  }

  const { employer, note: employerNote } = extractExplicitEmployerFromJd(rawText, listing);
  if (employerNote) notes.push(employerNote);

  const directListing =
    listing &&
    listingSelfDescribesAsEmployer(listing, rawText) &&
    !looksLikeAgencyCompanyName(listing);

  if (employer && directListing && normalizeText(employer) !== normalizeText(listing)) {
    notes.push(`Ignored prose false-positive employer "${employer}"; listing self-describes as direct employer.`);
  } else if (employer) {
    const agency =
      listing && (looksLikeAgencyCompanyName(listing) || jdSignalsAgencyRepresentation(rawText))
        ? listing
        : null;
    if (agency) notes.push(`Listing source "${listing}" treated as agency/recruiter.`);
    return {
      listingCompanyName: listing,
      employerCompanyName: employer,
      agencyCompanyName: agency,
      companyDisplayName: employer,
      companyConfidence: "explicit_employer",
      companyExtractionNotes: notes,
    };
  }

  if (directListing && listing) {
    return {
      listingCompanyName: listing,
      employerCompanyName: null,
      agencyCompanyName: null,
      companyDisplayName: listing,
      companyConfidence: "direct_or_unclear",
      companyExtractionNotes: notes,
    };
  }

  const nameLooksAgency = listing ? looksLikeAgencyCompanyName(listing) : false;
  const jdAgency = jdSignalsAgencyRepresentation(rawText);
  const selfEmployer = listing ? listingSelfDescribesAsEmployer(listing, rawText) : false;

  if (listing && (nameLooksAgency || jdAgency) && !selfEmployer) {
    if (nameLooksAgency) notes.push(`Listing company name matches agency/recruiter heuristics.`);
    if (jdAgency) notes.push("JD language indicates third-party representation or undisclosed employer.");
    const display = listing ? `${listing} client` : "Undisclosed client";
    return {
      listingCompanyName: listing,
      employerCompanyName: null,
      agencyCompanyName: listing,
      companyDisplayName: display,
      companyConfidence: "agency_only",
      companyExtractionNotes: notes,
    };
  }

  if (listing) {
    if (nameLooksAgency && selfEmployer) {
      notes.push("Agency-like listing name, but JD describes the listing company as the direct employer.");
    }
    return {
      listingCompanyName: listing,
      employerCompanyName: null,
      agencyCompanyName: null,
      companyDisplayName: listing,
      companyConfidence: "direct_or_unclear",
      companyExtractionNotes: notes,
    };
  }

  return {
    listingCompanyName: null,
    employerCompanyName: null,
    agencyCompanyName: null,
    companyDisplayName: "Unknown Company",
    companyConfidence: "direct_or_unclear",
    companyExtractionNotes: notes.length ? notes : ["Employer not identified from JD."],
  };
}

/** Apply company presentation fields onto extracted job data (mutates shape). */
export function applyCompanyPresentation<T extends {
  company: string;
  rawText?: string;
  listingCompanyName?: string;
  employerCompanyName?: string | null;
  agencyCompanyName?: string | null;
  companyDisplayName?: string;
  companyConfidence?: CompanyConfidence;
  companyExtractionNotes?: string[];
}>(
  extracted: T,
  companyHint?: string,
): T {
  const sanitizedCompany =
    extracted.company && isValidCompanyCandidate(extracted.company)
      ? extracted.company
      : undefined;
  const resolvedListing =
    sanitizedCompany ??
    resolveCompanyFromText(extracted.rawText ?? "", { companyHint, llmCompany: extracted.company });
  const presentation = resolveCompanyPresentation({
    listingCompanyName: extracted.listingCompanyName ?? resolvedListing ?? undefined,
    rawText: extracted.rawText,
    companyHint,
  });
  return {
    ...extracted,
    company: presentation.listingCompanyName ?? extracted.company,
    listingCompanyName: presentation.listingCompanyName ?? extracted.company,
    employerCompanyName: presentation.employerCompanyName,
    agencyCompanyName: presentation.agencyCompanyName,
    companyDisplayName: presentation.companyDisplayName,
    companyConfidence: presentation.companyConfidence,
    companyExtractionNotes: presentation.companyExtractionNotes,
  };
}
