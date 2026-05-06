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
import {
  analyzeCoreLanguageRequirement,
  explicitCoreLanguageRiskSummary,
  isMatureStructuredEmployer,
  jdPythonFlexibleWithJsOrTs,
} from '../../lib/coreLanguageRequirements.js';
import { isFdeBuilderSoftwarePrimaryShape } from '../../lib/fdeBuilderRole.js';
import {
  jdHasAppliedAiSystemsOverlap,
  jdIsStructurallyVague,
} from '../../lib/scoringOutputPolish.js';

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
  profile: UserProfile,
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
  const traditionalSignal = detectTraditionalEmployerContextStrict(combinedText, companyNorm);
  const startupSmallTeam =
    /\b(1[-\s]?10|11[-\s]?50|51[-\s]?200)\s*(employees|employee|people|person|team)\b/i.test(combinedText) ||
    /\b(seed|series\s+[ab]|pre-seed|founding team|startup|early[-\s]?stage)\b/i.test(combinedText);
  const isTraditionalCompany = traditionalSignal && !startupSmallTeam;

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

  const explicitSeniorStaffInJd =
    /\b(senior|staff|principal|sr\.)\b/i.test(combinedText) ||
    /\b(lead\s+engineer|engineering\s+manager|director\s+of\s+engineering)\b/i.test(combinedText);
  const fivePlusYearsSoftPreferred =
    /\b(5\+|6\+|7\+|8\+|10\+)\s*years?\b[^.\n]{0,160}\b(preferred|nice to have|a plus|bonus|plus)\b/i.test(
      combinedText,
    ) || /\b(preferred|nice to have)[^.\n]{0,160}\b(5\+|6\+|7\+)\s*years?\b/i.test(combinedText);
  const yearsFivePlusHardRequired =
    ((job.yearsExperience?.min ?? 0) >= 5 && !fivePlusYearsSoftPreferred) ||
    /\b(5\+|6\+|7\+|8\+|10\+)\s*years?[^.\n]{0,40}\b(required|must)\b/i.test(combinedText) ||
    /\b(at\s+least|minimum)[^.\n]{0,24}(5|6|7|8|10)\s*\+?\s*years?[^.\n]{0,30}\b(required|must)\b/i.test(
      combinedText,
    );
  const leadingTeamsHard =
    /\b(people\s+manager|manage\s+engineers|managing\s+engineers|leading\s+a\s+team\s+of\s+engineers)\b/i.test(
      combinedText,
    );
  const contradictorySeniorSignals =
    explicitSeniorStaffInJd || yearsFivePlusHardRequired || leadingTeamsHard;
  // Associate/entry roles should not get "overreach" unless the JD also carries explicit senior markers.
  const seniorityOverreach =
    contradictorySeniorSignals && !earlyCareerFriendlyRole;

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

  const backendProductApiRole =
    /\b(backend|api|full[-\s]?stack|product engineer|product engineering|customer problems?|feature development|features|reliable systems?|testing|debugging|production systems?)\b/i.test(
      combinedText,
    ) &&
    !/\b(sre|site reliability|platform engineering|devops|terraform|iac|infrastructure tooling|airgapped|linux internals|container runtime|supply chain security|security hardening)\b/i.test(
      combinedText,
    );
  const infraCoreRole =
    /\b(sre|site reliability|platform engineering|devops|infrastructure tooling|kubernetes platform|container runtime|linux internals|terraform|iac|airgapped|supply chain|security hardening)\b/i.test(
      combinedText,
    ) &&
    !/\b(product features?|pm|design|customer problems?|full[-\s]?stack|backend api)\b/i.test(combinedText);
  const stackMismatch =
    !backendProductApiRole &&
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

  const healthcareProductEngineering =
    /\b(healthcare|health\s+care|behavioral\s+health|clinical|patient|hospital|therapy|ehr|hipaa)\b/i.test(
      combinedText,
    ) &&
    /\b(product\s+engineer|full[-\s]?stack|software\s+engineer|typescript|javascript|react|api|revenue|billing|growth|internal\s+tools|crm)\b/i.test(
      combinedText,
    );
  const domainMismatch =
    !healthcareProductEngineering &&
    includesAny(combinedText, [
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
  const foundingSignals =
    /\b(founding engineer|founding full[-\s]?stack engineer|founding team|1st engineer|2nd engineer|3rd engineer|4th engineer)\b/i.test(
      combinedText,
    ) ||
    /\b(shape engineering culture|own major technical decisions|build from scratch|limited mentorship|low mentorship)\b/i.test(
      combinedText,
    );
  const healthcareOpsComplexity =
    /\b(healthcare|clinical|patient|care operations|compliance|hipaa)\b/i.test(combinedText);
  const foundingEngineerStretch = foundingSignals;
  const fintechPaymentsRole =
    /\b(fintech|payments?|credit card|co[-\s]?branded|issuing|cardholder|banking api|financial infrastructure|underwriting)\b/i.test(
      combinedText,
    );
  const goPrimaryBackend =
    /\b(go|golang)\s+is\s+our\s+primary\s+backend\s+language\b/i.test(combinedText) ||
    /\bprimary\s+backend\s+language\b[^.\n]{0,60}\b(go|golang)\b/i.test(combinedText) ||
    /\bstrong\s+proficiency\s+in\s+(go|golang)\b/i.test(combinedText) ||
    /\b(go|golang)\b[^.\n]{0,60}\bprimary\b[^.\n]{0,40}\bbackend\b/i.test(combinedText);
  const microservicesHeavy =
    /\b(microservices?|service[-\s]?oriented|distributed systems?|on[-\s]?call|production troubleshooting|incident response)\b/i.test(
      combinedText,
    );
  const fintechGoPrimaryStretch =
    fintechPaymentsRole && backendProductApiRole && (goPrimaryBackend || microservicesHeavy);
  const researchHeavyAiRole =
    /\b(applied ai researcher|research scientist|ai researcher|research engineer)\b/i.test(combinedText) &&
    /\b(research track record|publications?|meta[-\s]?learning|program synthesis|evolutionary computation|self[-\s]?constructing systems?|recursive systems?|self[-\s]?architecting|frontier research|model experiments?|data analysis)\b/i.test(
      combinedText,
    );
  const associateEntryRole =
    /\b(associate|entry[-\s]?level|early[-\s]?career|junior|new grad|new graduate)\b/i.test(combinedText);
  const preferredPlatformStackGap =
    /\b(preferred|nice to have|plus)\b[^.\n]{0,180}\b(go|golang|graphql|docker|kubernetes|cloud)\b/i.test(combinedText) ||
    /\b(go|golang|graphql|docker|kubernetes|cloud)\b[^.\n]{0,120}\b(preferred|nice to have|plus)\b/i.test(combinedText);

  if (explicitDegreeRisk) {
    penaltyVector.degree =
      isTraditionalCompany || strictNewGradPipeline
        ? scoringPolicy.hardPenalties.degreeRequiredTraditional
        : scoringPolicy.hardPenalties.degreeRequiredGeneral;
  }
  if (isTraditionalCompany) {
    penaltyVector.traditional = 4;
    notes.push(
      'Traditional employer signal suggests stricter screening behavior.',
    );
  }
  if (isFinance && !fintechGoPrimaryStretch) {
    penaltyVector.finance = 5;
    notes.push('Finance/banking role context typically screens more strictly.');
  } else if (fintechGoPrimaryStretch) {
    penaltyVector.finance = 5;
    notes.push(
      'No prior fintech/payments or co-branded card experience may create a steeper ramp and stricter screening.',
    );
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
  } else if (associateEntryRole && preferredPlatformStackGap) {
    notes.push(
      "Preferred Go/GraphQL/platform stack is not the candidate's strongest lane, but baseline backend expectations appear accessible.",
    );
  } else if (backendProductApiRole && !infraCoreRole) {
    const companyLabel = job.company?.trim() || 'This company';
    const matureFintechApi =
      /\b(plaid|stripe|fintech|payments|banking[-\s]?api|financial infrastructure)\b/i.test(combinedText);
    notes.push(
      matureFintechApi
        ? `${companyLabel} operates payment- or API-heavy product infrastructure; hiring rubrics often emphasize production reliability, backend fundamentals, and operational maturity.`
        : `${companyLabel} lists backend/API product work with infra tooling context — screeners may still probe scale and fundamentals without treating this as pure platform engineering.`,
    );
  } else if (infraCoreRole) {
    notes.push(
      'Role appears platform/infra-core; deeper production infra background may be screened more strictly.',
    );
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
  if (foundingEngineerStretch) {
    penaltyVector.foundingStretch = Math.max(penaltyVector.foundingStretch ?? 0, 10);
    notes.push(
      'Founding engineer role may require more independent production ownership and architectural judgment than the profile clearly demonstrates.',
    );
    if (healthcareOpsComplexity) {
      notes.push(
        'Healthcare AI workflows may involve clinical, compliance, and operational complexity that could create a steeper ramp.',
      );
    }
    notes.push('Early-stage team may offer limited mentorship or structure.');
  }
  if (researchHeavyAiRole) {
    penaltyVector.research = 15;
    notes.push(
      'Role is research-heavy and asks for self-constructing systems, meta-learning, program synthesis, and agent architecture research not clearly demonstrated in the current profile.',
    );
    notes.push(
      'Proven track record of research results is a major recruiter-screen gap.',
    );
  }
  if (fintechGoPrimaryStretch && goPrimaryBackend) {
    notes.push(
      'Go-primary backend expectations are outside the strongest TypeScript/Node lane and are a major stack caveat.',
    );
  }

  const pythonStackFlexibleWithJsTs = jdPythonFlexibleWithJsOrTs(combinedText);

  const fdeBuilderSoftwarePrimary = isFdeBuilderSoftwarePrimaryShape(job);
  if (fdeBuilderSoftwarePrimary) {
    notes.push(
      'Forward-deployed / growth title without strong external customer-implementation JD — default builder-first SWE screen story (SIE only as secondary angle).',
    );
  }

  const coreLang = analyzeCoreLanguageRequirement(job, profile);
  const matureStructuredEmployer =
    isMatureStructuredEmployer(job.company ?? '', combinedText) || harshEmployerContext;
  const explicitCoreLanguageMismatch =
    matureStructuredEmployer &&
    coreLang.explicitHardRequirement &&
    !coreLang.candidateHasProductionLanguage;
  const knownStrongEmployer =
    /\b(google|alphabet|meta|facebook|amazon|aws|microsoft|apple|netflix|uber|spotify|salesforce|oracle|ibm|stripe|airbnb|databricks|palantir|openai|anthropic|goldman|jpmorgan|jp\s*morgan|bloomberg)\b/i.test(
      companyNorm,
    );
  const startupOrWeakEmployerShape =
    /\b(seed|series\s+[ab]|pre-seed|stealth|early-stage|early stage|startup|founding team|y\s*combinator|yc\s*backed)\b/i.test(
      combinedText,
    );
  const unknownWeakEmployer =
    !knownStrongEmployer && (startupOrWeakEmployerShape || companyNorm.length < 36);
  const entryLevelAiSignals =
    earlyCareerFriendlyRole ||
    (job.yearsExperience?.min ?? 99) <= 2 ||
    /\b(intern|internship|associate\s+engineer|junior|entry[-\s]?level)\b/i.test(combinedText);
  const vagueEarlyStageAiCalibration =
    !harshEmployerContext &&
    jdHasAppliedAiSystemsOverlap(combinedText) &&
    jdIsStructurallyVague(job) &&
    unknownWeakEmployer &&
    entryLevelAiSignals;
  if (vagueEarlyStageAiCalibration) {
    notes.push(
      'Vague or thin JD for an entry-level AI posting at a non-name employer — scores calibrated down for generic-posting inflation.',
    );
  }

  const hardRuleNotes: string[] = [];
  if (locationMismatch) {
    hardRuleNotes.push('Onsite/hybrid requirement appears non-commutable.');
  }
  if (explicitDegreeRisk) {
    hardRuleNotes.push('Explicit degree requirement may be a first-pass recruiter filter.');
  }
  if (explicitCoreLanguageMismatch && coreLang.language) {
    hardRuleNotes.push(explicitCoreLanguageRiskSummary(coreLang.language));
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
    matureStructuredEmployer,
    explicitCoreLanguageMismatch,
    explicitCoreLanguage: explicitCoreLanguageMismatch ? coreLang.language : null,
    fdeBuilderSoftwarePrimary,
    pythonStackFlexibleWithJsTs,
    healthcareProductEngineering,
    backendProductApiRole,
    infraCoreRole,
    vagueEarlyStageAiCalibration,
    researchHeavyAiRole,
    fintechGoPrimaryStretch,
    foundingEngineerStretch,
    hardRuleNotes,
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
