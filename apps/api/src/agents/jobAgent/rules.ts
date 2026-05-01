import { scoringPolicy } from '../../config/scoringPolicy.js';
import type { ExtractedJobData } from '../../types/job.js';
import type { RuleEvaluation } from '../../types/scoring.js';
import type { UserProfile } from '../../types/userProfile.js';
import { normalizeText } from '../../lib/text.js';
import {
  detectStrictFinanceEmployerContext,
  detectTraditionalEmployerContextStrict,
  textImpliesNycMetroOrCommutableNj,
} from '../../lib/employerLocationSignals.js';

const includesAny = (haystack: string, needles: string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

const RAW_CITIZENSHIP =
  /\b(us\s+)?citizenship\s+(is\s+)?required\b|\bcitizenship\s+required\b|\bonly\s+u\.?s\.?\s+citizens\b/i;
const RAW_VISA =
  /\bno\s+(visa\s+)?sponsorship\b|\bunable\s+to\s+sponsor\b|\bmust\s+be\s+authorized\s+to\s+work\s+in\s+the\s+u\.?s\.?\b|\bauthorized\s+to\s+work\s+in\s+the\s+u\.?s\.?\b/i;
const RAW_CLEARANCE =
  /\b(security\s+clearance|ts\/sci|top\s+secret|clearance\s+required|dod\s+clearance)\b/i;
const RAW_DEGREE =
  /\b(bachelor'?s?\s+degree|bachelors\s+degree|bs\s+in|b\.s\.|ba\s+in)[^.\n]{0,160}\brequired\b|\bdegree\s+in\s+(computer science|cs|engineering)\s+required\b/i;

const NEW_GRAD_WORD = /\b(new\s+graduate|new\s+grad)\b/i;

/** Language that usually indicates a formal campus / graduate / rotation hiring track. */
const hasStrongPipelineMarkers = (combinedText: string): boolean =>
  NEW_GRAD_WORD.test(combinedText) ||
  includesAny(combinedText, [
    'graduate program',
    'campus hire',
    'campus recruiting',
    'rotational program',
    'rotation program',
    'university graduate',
    'early career program',
  ]);

export const evaluateRules = (
  job: ExtractedJobData,
  _profile: UserProfile,
): RuleEvaluation => {
  const notes: string[] = [];
  const penaltyVector: Record<string, number> = {};

  const raw = normalizeText(job.rawText ?? '');
  const companyNorm = normalizeText(job.company ?? '');

  const structuredParts = [
    job.title,
    job.seniority,
    job.location,
    job.visaRequirement,
    job.citizenshipRequirement,
    job.clearanceRequirement,
    ...(job.domainTags ?? []),
    ...(job.stack ?? []),
    ...(job.requirements ?? []),
    ...(job.responsibilities ?? []),
  ]
    .filter(Boolean)
    .join(' ');

  const combinedText = normalizeText(
    [companyNorm, structuredParts, raw].filter(Boolean).join(' '),
  );

  const isFinance = detectStrictFinanceEmployerContext(combinedText, companyNorm);
  const isTraditionalCompany = detectTraditionalEmployerContextStrict(combinedText, companyNorm);

  const harshEmployerContext = isTraditionalCompany || isFinance;

  const degreeLevel = job.degreeRequirement?.level ?? 'unknown';
  const degreeRaw = normalizeText(job.degreeRequirement?.raw ?? '');
  const explicitDegreeRisk =
    degreeLevel === 'required' ||
    degreeRaw.includes('bachelor') ||
    degreeRaw.includes('bs in computer science') ||
    RAW_DEGREE.test(job.rawText ?? '');

  const strictNewGradPipeline =
    hasStrongPipelineMarkers(combinedText) &&
    (harshEmployerContext || explicitDegreeRisk);

  const earlyCareerShape =
    includesAny(combinedText, [
      'early career',
      'entry level',
      'entry-level',
      'software engineer i',
      'engineer i',
      'swe i',
      'associate engineer',
      'associate software',
    ]) ||
    (hasStrongPipelineMarkers(combinedText) &&
      !harshEmployerContext &&
      !explicitDegreeRisk);

  const earlyCareerFriendlyRole = earlyCareerShape && !strictNewGradPipeline;

  const seniorityOverreach =
    includesAny(combinedText, ['senior', 'staff', 'principal']) ||
    (job.yearsExperience?.min ?? 0) >= 4;

  const primaryNonNycMetroInLocationLine =
    /\b(location|based|office)\s*:\s*[^.\n]{0,100}\b(dallas|austin|seattle|san francisco|sf\b|los angeles|chicago|denver|atlanta|boston|miami|philadelphia|phoenix|detroit|houston|portland)\b/i.test(
      combinedText,
    );
  const nycOrNjViableInText =
    textImpliesNycMetroOrCommutableNj(combinedText) && !primaryNonNycMetroInLocationLine;
  const locationMismatch =
    (job.remoteType === 'onsite' || job.remoteType === 'hybrid') &&
    job.locationIsCommutable === false &&
    !nycOrNjViableInText;

  const visaMismatch =
    includesAny(normalizeText(job.visaRequirement ?? ''), [
      'no sponsorship',
      'must be authorized',
      'unable to sponsor',
    ]) || RAW_VISA.test(job.rawText ?? '');

  const citizenshipMismatch =
    Boolean(job.citizenshipRequirement) ||
    RAW_CITIZENSHIP.test(job.rawText ?? '');

  const clearanceMismatch =
    Boolean(job.clearanceRequirement) || RAW_CLEARANCE.test(job.rawText ?? '');

  const stackMismatch =
    !includesAny(combinedText, [
      'typescript',
      'javascript',
      'node',
      'react',
      'api',
      'full-stack',
    ]) &&
    includesAny(combinedText, [
      'sre',
      'infrastructure',
      'devops',
      'observability',
      'platform',
    ]);

  const domainMismatch = includesAny(combinedText, [
    'medical billing',
    'quantitative research',
    'actuarial',
    'embedded firmware',
  ]);

  const startupFounderMismatch = includesAny(combinedText, [
    'founding engineer',
    'first engineer',
    'build from scratch with no support',
  ]);

  if (explicitDegreeRisk) {
    penaltyVector.degree =
      isTraditionalCompany || strictNewGradPipeline
        ? scoringPolicy.hardPenalties.degreeRequiredTraditional
        : scoringPolicy.hardPenalties.degreeRequiredGeneral;
    notes.push(
      'Explicit degree requirement may be a first-pass recruiter filter.',
    );
  }
  if (isTraditionalCompany) {
    penaltyVector.traditional = 4;
    notes.push(
      'Traditional employer signal suggests stricter screening behavior.',
    );
  }
  if (isFinance) {
    penaltyVector.finance = 5;
    notes.push('Finance/banking role context typically screens more strictly.');
  }
  if (strictNewGradPipeline) {
    penaltyVector.newGrad = scoringPolicy.hardPenalties.newGradPipelineMismatch;
    notes.push(
      'Traditional new-grad / campus pipeline language appears mismatched to target profile.',
    );
  } else if (earlyCareerFriendlyRole) {
    penaltyVector.earlyCareerSoft =
      scoringPolicy.hardPenalties.earlyCareerSoftMismatch;
    notes.push(
      'Early-career framing adds junior-screen realism without a harsh pipeline gate.',
    );
  }
  if (seniorityOverreach) {
    penaltyVector.seniority = scoringPolicy.hardPenalties.seniorityOverreach;
    notes.push('Role may overreach current level story for recruiter screen.');
  }
  if (locationMismatch) {
    penaltyVector.location = scoringPolicy.hardPenalties.locationMismatch;
    notes.push('Onsite/hybrid requirement appears non-commutable.');
  }
  if (visaMismatch) {
    penaltyVector.visa = scoringPolicy.hardPenalties.sponsorshipMismatch;
    notes.push(
      'Visa/sponsorship language indicates risk for first-pass progression.',
    );
  }
  if (citizenshipMismatch) {
    penaltyVector.citizenship = scoringPolicy.hardPenalties.citizenshipMismatch;
    notes.push('Citizenship requirement is a likely hard gate.');
  }
  if (clearanceMismatch) {
    penaltyVector.clearance = scoringPolicy.hardPenalties.clearanceMismatch;
    notes.push('Security clearance requirement is a likely hard gate.');
  }
  if (stackMismatch) {
    penaltyVector.stack = scoringPolicy.hardPenalties.stackMismatch;
    notes.push('Core technical story does not align with role stack shape.');
  }
  if (domainMismatch) {
    penaltyVector.domain = scoringPolicy.hardPenalties.domainMismatch;
    notes.push('Specialized domain requirements look materially mismatched.');
  }
  if (startupFounderMismatch) {
    penaltyVector.founding = scoringPolicy.hardPenalties.startupFounderMismatch;
    notes.push(
      'Founding-style expectations do not match strongest current story.',
    );
  }

  return {
    explicitDegreeRisk,
    traditionalCompanyPenalty: isTraditionalCompany,
    financePenalty: isFinance,
    strictNewGradPipeline,
    earlyCareerFriendlyRole,
    newGradPenalty: strictNewGradPipeline,
    seniorityOverreach,
    locationMismatch,
    visaMismatch,
    citizenshipMismatch,
    clearanceMismatch,
    stackMismatch,
    domainMismatch,
    startupFounderMismatch,
    notes: [...new Set(notes)],
    penaltyVector,
  };
};

export const isLikelyTraditionalEmployer = (job: ExtractedJobData): boolean => {
  const blob = normalizeText(
    `${job.company} ${job.title} ${(job.domainTags ?? []).join(' ')} ${job.rawText ?? ''}`,
  );
  return detectTraditionalEmployerContextStrict(blob, normalizeText(job.company ?? ''));
};
