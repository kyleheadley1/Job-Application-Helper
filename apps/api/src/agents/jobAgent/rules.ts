import { scoringPolicy } from '../../config/scoringPolicy.js';
import type { ExtractedJobData } from '../../types/job.js';
import type { RuleEvaluation } from '../../types/scoring.js';
import type { UserProfile } from '../../types/userProfile.js';
import type { ResumeContextSet } from '../../types/resumeContext.js';
import type { ResumeType } from '../../types/resume.js';
import { normalizeText } from '../../lib/text.js';
import { claimableStackFromContexts } from '../../lib/claimableStack.js';
import { analyzeStackMismatch } from '../../lib/stackMismatchAnalysis.js';
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
import { evaluateDisjunctiveLanguageRequirement, filterGapsAfterDisjunctiveMatch } from '../../lib/disjunctiveLanguageRequirement.js';
import { isFdeBuilderSoftwarePrimaryShape } from '../../lib/fdeBuilderRole.js';
import { detectRoleSeniorityOverreach } from '../../lib/seniorityGate.js';
import {
  jdHasAppliedAiSystemsOverlap,
  jdIsStructurallyVague,
  profileHasGoDataInfraProductionEvidence,
} from '../../lib/scoringOutputPolish.js';
import { filterLanguagesToJdPresence } from '../../lib/jdLanguagePresence.js';
import { evaluateGeoEligibility } from '../../lib/geoEligibility.js';
import { evaluateClearanceCitizenship } from '../../lib/clearanceCitizenship.js';
import {
  detectCompetitivePoolSignals,
  isVentureFundedStartupShape,
} from '../../lib/poolCompetitiveness.js';

const includesAny = (haystack: string, needles: string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

const RAW_VISA =
  /\bno\s+(visa\s+)?sponsorship\b|\bunable\s+to\s+sponsor\b|\bmust\s+be\s+authorized\s+to\s+work\s+in\s+the\s+u\.?s\.?\b|\bauthorized\s+to\s+work\s+in\s+the\s+u\.?s\.?\b/i;
const RAW_DEGREE =
  /\b(bachelor'?s?\s+degree|bachelors\s+degree|bs\s+in|b\.s\.|ba\s+in)[^.\n]{0,160}\brequired\b|\bdegree\s+in\s+(computer science|cs|engineering)\s+required\b/i;

const NEW_GRAD_WORD = /\b(new\s+graduate|new\s+grad)\b/i;

function profileHasCsDegreeCred(profile: UserProfile): boolean {
  if (!profile.degreeStatus.hasBachelors) return false;
  const blob = normalizeText(
    [profile.degreeStatus.note, profile.training?.program ?? '', profile.headline].join(' '),
  );
  return /\b(computer science|comp sci|cs degree|b\.?s\.?\s*(in\s*)?cs|bachelor[^.\n]{0,60}computer science)\b/i.test(
    blob,
  );
}

function jdDegreeEquivalenceSoftened(
  combinedText: string,
  degreeLevel: string | undefined,
): boolean {
  return (
    degreeLevel === 'equivalent_allowed' ||
    degreeLevel === 'preferred' ||
    /\bor related experience\b/i.test(combinedText) ||
    /\bor equivalent experience\b/i.test(combinedText) ||
    /\bor equivalent practical experience\b/i.test(combinedText) ||
    /\bor comparable experience\b/i.test(combinedText) ||
    /\brelevant experience may substitute\b/i.test(combinedText) ||
    /\bexperience in lieu of a degree\b/i.test(combinedText) ||
    /\b(bachelor'?s?|degree)\s+or\s+equivalent\b/i.test(combinedText) ||
    /\bdegree preferred but not required\b/i.test(combinedText) ||
    /\bdegree is a plus\b/i.test(combinedText) ||
    /\b(preferred|nice to have|a plus)\b[^.\n]{0,80}\b(degree|bachelor)\b/i.test(combinedText) ||
    /\b(bootcamp|open[-\s]?source|project experience)\b[^.\n]{0,100}\b(accepted|considered|welcome|qualify)\b/i.test(
      combinedText,
    ) ||
    /\b(bachelor|degree)[^.\n]{0,120}\bor equivalent\b/i.test(combinedText) ||
    /\bor equivalent[^.\n]{0,80}\b(bachelor|degree)\b/i.test(combinedText)
  );
}

function jdExplicitCsDegreeHard(
  combinedText: string,
  degreeRaw: string,
  degreeLevel: string | undefined,
): boolean {
  if (jdDegreeEquivalenceSoftened(combinedText, degreeLevel)) return false;
  const dr = normalizeText(degreeRaw);
  const csInStructured =
    (dr.includes('computer science') || /\bcs degree\b/i.test(dr)) &&
    /\b(bachelor|bs|b\.s\.|degree|ms|m\.s\.)\b/i.test(dr);
  const csInBlob =
    /\b(bachelor'?s?|bs|b\.s\.|ms|m\.s\.)\b[^.\n]{0,100}\b(computer science|comp sci|cs)\b/i.test(
      combinedText,
    ) ||
    /\b(computer science|comp sci)\b[^.\n]{0,80}\b(bachelor|bs|b\.s\.|degree|ms)\b/i.test(combinedText) ||
    /\b(bs\/ms|bs|ms)\s+in\s+(computer science|cs)\b/i.test(combinedText) ||
    csInStructured;
  if (!csInBlob) return false;
  return (
    degreeLevel === 'required' ||
    /\b(must have|required)\b[^.\n]{0,160}\b(bachelor|bs|computer science|cs degree|bs\/ms)\b/i.test(
      combinedText,
    ) ||
    /\b(bachelor|bs)[^.\n]{0,100}\b(computer science|cs)\b[^.\n]{0,40}\brequired\b/i.test(combinedText)
  );
}

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
  options?: {
    resumeContexts?: ResumeContextSet;
    activeResumeType?: ResumeType;
  },
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
  const jdFinanceAccountingHard =
    /\b(gaap|asc\s*606|asc606|generally accepted accounting|revenue recognition|accounting principles)\b/i.test(
      combinedText,
    ) ||
    (/\b(financial workflow|finance workflow|accounting workflow)\b/i.test(combinedText) &&
      /\b(build|building|software|application|engineer|saas)\b/i.test(combinedText));
  const jdAlgorithmPublicationHard =
    /\bdemonstrated algorithm expertise\b/i.test(combinedText) ||
    /\bacademic or industry publications\b/i.test(combinedText) ||
    (/\bpublications?\b/i.test(combinedText) &&
      /\b(algorithm|big data algorithms|distributed systems|high[-\s]?performance computing|\bhpc\b)\b/i.test(
        combinedText,
      ));
  const jdJavaCppOopHard =
    /\b(java|c\+\+)\b[^.\n]{0,120}\b(object[-\s]oriented|oop)\b/i.test(combinedText) ||
    /\bjava\s*\/\s*c\+\+\s*style\b/i.test(combinedText) ||
    (/\bobject[-\s]oriented programming\b/i.test(combinedText) &&
      /\b(java|c\+\+)\b/i.test(combinedText));
  const jdB2bSaasExperienceHard =
    /\bb2b\b/i.test(combinedText) &&
    /\bsaas\b/i.test(combinedText) &&
    /\b(\d\+\s*years?|years?\s+of|must have|required)\b/i.test(combinedText);
  const credentialHardSignalCount = [
    jdFinanceAccountingHard,
    jdAlgorithmPublicationHard,
    jdJavaCppOopHard,
    jdB2bSaasExperienceHard,
  ].filter(Boolean).length;
  const explicitCsDegreeHard = jdExplicitCsDegreeHard(combinedText, degreeRaw, degreeLevel);
  const credentialHeavyFintechAlgorithm =
    explicitCsDegreeHard &&
    !profileHasCsDegreeCred(profile) &&
    credentialHardSignalCount >= 2;

  const degreeRequiredSignal =
    degreeLevel === 'required' ||
    degreeRaw.includes('bachelor') ||
    degreeRaw.includes('bs in computer science') ||
    RAW_DEGREE.test(job.rawText ?? '');

  const degreeEquivalenceEscape = jdDegreeEquivalenceSoftened(combinedText, degreeLevel);
  const degreeHasEquivalencyClause = degreeEquivalenceEscape;
  const explicitDegreeRisk = degreeRequiredSignal && !degreeEquivalenceEscape;

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

  const seniorityOverreach = detectRoleSeniorityOverreach(job);

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

  const jdSignalsVisaSponsorshipConstraint =
    includesAny(normalizeText(job.visaRequirement ?? ''), [
      'no sponsorship',
      'must be authorized',
      'unable to sponsor',
    ]) || RAW_VISA.test(job.rawText ?? '');

  const visaMismatch = profile.requiresSponsorship && jdSignalsVisaSponsorshipConstraint;

  const clearanceCitizenship = evaluateClearanceCitizenship(job, profile);
  const citizenshipMismatch = clearanceCitizenship.citizenshipMismatch;
  const clearanceMismatch = clearanceCitizenship.clearanceMismatch;

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
  const infraStackShapeMismatch =
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

  const claimable = claimableStackFromContexts(options?.resumeContexts, options?.activeResumeType ?? 'SWE');
  const stackAnalysis = analyzeStackMismatch(job, claimable);
  const disjunctiveLanguage = evaluateDisjunctiveLanguageRequirement(job, claimable);
  let stackMismatch = stackAnalysis.stackMismatch;
  let coreLanguageGap = filterGapsAfterDisjunctiveMatch(
    stackAnalysis.coreLanguageGap,
    disjunctiveLanguage,
  );
  coreLanguageGap = filterLanguagesToJdPresence(coreLanguageGap, job);
  if (coreLanguageGap.length === 0) stackMismatch = false;
  const adjacentFrameworkGap = stackAnalysis.adjacentFrameworkGap;

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
  const dataInfraStreaming =
    /\b(kafka|kinesis|amazon\s*kinesis|amazon\s*sqs|\bsqs\b|managed streaming|event stream|stream processing|streaming pipeline)\b/i.test(
      combinedText,
    );
  const dataWarehouseAnalytics =
    /\b(redshift|snowflake|clickhouse|trino|apache iceberg|iceberg tables|\biceberg\b|data warehouse|analytics database|olap)\b/i.test(
      combinedText,
    );
  const specializedDataStores =
    /\b(elasticsearch|opensearch|scylladb|scylla|aerospike|tidb)\b/i.test(combinedText);
  const largeDataPerf =
    /\b(large datasets?|big data|petabyte|terabyte|billions?\s+of rows|high throughput|low latency|memory optimization|performance optimization)\b/i.test(
      combinedText,
    );
  const dataInfraCoreContext =
    infraCoreRole ||
    /\b(data infrastructure|analytics infrastructure|data platform|stats?\s*(and|&)\s*analytics|metrics platform|analytics engine)\b/i.test(
      combinedText,
    );
  const hasGoMention = /\b(go|golang)\b/i.test(combinedText);
  const goDistributedDataInfraRole =
    hasGoMention &&
    (goPrimaryBackend || dataInfraCoreContext) &&
    (dataInfraStreaming || dataWarehouseAnalytics || specializedDataStores) &&
    (microservicesHeavy || largeDataPerf || dataInfraStreaming || dataWarehouseAnalytics) &&
    !researchHeavyAiRole &&
    !credentialHeavyFintechAlgorithm;
  const apprenticeshipDataInfraOk =
    /\b(apprenticeship|apprentice\s+program|new\s+grad\s+program|graduate\s+program|training\s+program|rotational\s+program|engineering\s+residency|intern\s+to\s+full)\b/i.test(
      combinedText,
    );
  const goDistributedDataInfraCandidateGap =
    goDistributedDataInfraRole &&
    !profileHasGoDataInfraProductionEvidence(profile) &&
    !apprenticeshipDataInfraOk;
  const associateEntryRole =
    /\b(associate|entry[-\s]?level|early[-\s]?career|junior|new grad|new graduate)\b/i.test(combinedText);
  const preferredPlatformStackGap =
    /\b(preferred|nice to have|plus)\b[^.\n]{0,180}\b(go|golang|graphql|docker|kubernetes|cloud)\b/i.test(combinedText) ||
    /\b(go|golang|graphql|docker|kubernetes|cloud)\b[^.\n]{0,120}\b(preferred|nice to have|plus)\b/i.test(combinedText);

  const productionOwnershipJd =
    /\b(production ownership|meaningful scope|on[-\s]?call|end[-\s]?to[-\s]?end|own(s|\s+the)?\s+(the\s+)?(features?|roadmap|slice|technical|service|area|product)|technical ownership|operate in production|production systems?|ship(ped|ping)?[^.\n]{0,60}production)\b/i.test(
      combinedText,
    );
  const twoPlusProfessionalBar =
    (job.yearsExperience?.min ?? 0) >= 2 ||
    (/\b(2\+|3\+|4\+|at\s+least\s+2|minimum\s+of\s+2|2\s*[-–]\s*6|2\s+to\s+6)\s*years?\b/i.test(combinedText) &&
      /\b(professional|commercial|software engineering|engineering experience|years of experience)\b/i.test(
        combinedText,
      ));
  const competitiveHiringContext =
    /\b(charlie\s+health|liveperson)\b/i.test(companyNorm) ||
    /\b(liveperson|charlie\s+health)\b/i.test(combinedText) ||
    /\b(series\s+[bcd]|unicorn|post[-\s]?ipo|public(?:ly)?\s+traded)\b/i.test(combinedText) ||
    /\b(competitive\s+(applicant|candidate|talent|pool|salary)|high\s+bar|best[-\s]?in[-\s]?class|top\s+engineers?)\b/i.test(
      combinedText,
    ) ||
    (healthcareProductEngineering &&
      /\b(series\s+[ab]|well[-\s]?funded|growth|scaling|mature)\b/i.test(combinedText)) ||
    isTraditionalCompany ||
    isFinance ||
    /\b(fortune\b|enterprise\s+saas|global\s+scale)\b/i.test(combinedText);
  const competitivePoolSignals = detectCompetitivePoolSignals(job, combinedText);
  const productionBarCompetitivePool =
    (!earlyCareerFriendlyRole &&
      !associateEntryRole &&
      !researchHeavyAiRole &&
      !credentialHeavyFintechAlgorithm &&
      !foundingEngineerStretch &&
      !goDistributedDataInfraCandidateGap &&
      productionOwnershipJd &&
      twoPlusProfessionalBar &&
      competitiveHiringContext) ||
    competitivePoolSignals.signalCount >= 3;

  if (degreeRequiredSignal && degreeEquivalenceEscape) {
    notes.push(
      'Degree mentioned but JD allows equivalent, project, or bootcamp experience — treat as a soft screen note, not a hard gate.',
    );
  }
  if (credentialHeavyFintechAlgorithm) {
    penaltyVector.credentialHeavy = 30;
    notes.push(
      'Explicit CS degree requirement is a major screen risk.',
      'Role requires finance/accounting workflow experience, including GAAP and ASC 606, which is not demonstrated.',
      'JD asks for Java/C++ style OOP and algorithm-publication evidence, which do not match the current profile.',
    );
  }
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
    notes.push(
      `Required core language gap: ${coreLanguageGap.join(', ')} — not in claimable stack.`,
    );
  } else if (adjacentFrameworkGap.length > 0) {
    notes.push(
      `Adjacent framework gap (${adjacentFrameworkGap.join(', ')}) — same language family, learnable stretch.`,
    );
  } else if (infraStackShapeMismatch) {
    penaltyVector.stack = scoringPolicy.hardPenalties.stackMismatch;
    notes.push('Core technical story does not align with role stack shape (infra/SRE).');
  } else if (associateEntryRole && preferredPlatformStackGap) {
    const jdLangs = filterLanguagesToJdPresence(["Go"], job);
    const goNote = jdLangs.includes("Go")
      ? "Preferred Go/GraphQL/platform stack is not the candidate's strongest lane, but baseline backend expectations appear accessible."
      : "Preferred GraphQL/platform stack is not the candidate's strongest lane, but baseline backend expectations appear accessible.";
    notes.push(goNote);
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
  if (productionBarCompetitivePool) {
    notes.push(
      'Mature production-ownership bar with competitive hiring context — keep recruiter-screen realism conservative unless the profile matches JD stack details and production depth.',
    );
  }
  if (goDistributedDataInfraCandidateGap) {
    penaltyVector.dataInfraGo = 20;
    notes.push(
      'Go-first distributed data infrastructure role with streaming and analytics databases outside strongest TypeScript/Node lane.',
      'Requires production-scale backend/data systems experience, including Kafka/Kinesis and warehouse/analytics technologies not demonstrated.',
    );
    if (
      /\b(adtech|advertising\s+technology|programmatic|dsp|ssp|real[-\s]?time bidding|rtb|bidder)\b/i.test(
        combinedText,
      )
    ) {
      notes.push('Adtech analytics domain and optimization-heavy technical screen may be a poor fit.');
    }
  }

  const pythonStackFlexibleWithJsTs = jdPythonFlexibleWithJsOrTs(combinedText);

  const fdeBuilderSoftwarePrimary = isFdeBuilderSoftwarePrimaryShape(job);
  if (fdeBuilderSoftwarePrimary) {
    notes.push(
      'Forward-deployed / growth title without strong external customer-implementation JD — default builder-first SWE screen story (SIE only as secondary angle).',
    );
  }

  const coreLang = analyzeCoreLanguageRequirement(job, profile, claimable);
  const ventureFundedStartup = isVentureFundedStartupShape(combinedText);
  const matureStructuredEmployer =
    !ventureFundedStartup &&
    (isMatureStructuredEmployer(job.company ?? '', combinedText) || harshEmployerContext);
  const explicitCoreLanguageMismatch =
    matureStructuredEmployer &&
    coreLang.explicitHardRequirement &&
    !coreLang.candidateHasProductionLanguage &&
    !disjunctiveLanguage.satisfied;
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
  if (credentialHeavyFintechAlgorithm) {
    hardRuleNotes.push(
      'Credentialed fintech/accounting-systems gates (CS degree, GAAP/ASC 606, publication-style depth) are likely hard screens.',
    );
  } else if (explicitDegreeRisk) {
    hardRuleNotes.push('Explicit degree requirement may be a first-pass recruiter filter.');
  }
  if (explicitCoreLanguageMismatch && coreLang.language) {
    hardRuleNotes.push(explicitCoreLanguageRiskSummary(coreLang.language));
  } else if (stackMismatch && coreLanguageGap.length > 0) {
    hardRuleNotes.push(
      `Required core stack gap (${coreLanguageGap.join(', ')}) — major recruiter-screen risk.`,
    );
  }

  const geoEligibility = evaluateGeoEligibility(job, profile);
  if (geoEligibility.eligibilityFlag) {
    notes.push(geoEligibility.eligibilityFlag.reason);
  }
  if (clearanceCitizenship.clearanceEligibilityFlag) {
    notes.push(clearanceCitizenship.clearanceEligibilityFlag.reason);
  }

  return {
    explicitDegreeRisk,
    degreeHasEquivalencyClause,
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
    coreLanguageGap,
    adjacentFrameworkGap,
    infraStackShapeMismatch,
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
    credentialHeavyFintechAlgorithm,
    productionBarCompetitivePool,
    goDistributedDataInfraRole,
    goDistributedDataInfraCandidateGap,
    disjunctiveLanguageRequirementSatisfied: disjunctiveLanguage.satisfied,
    disjunctiveAcceptedLanguages: disjunctiveLanguage.acceptedLabels,
    eligibilityFlag: geoEligibility.eligibilityFlag,
    clearanceEligibilityFlag: clearanceCitizenship.clearanceEligibilityFlag,
    geoExclusionHardGate: geoEligibility.geoExclusionHardGate,
    geoExclusionReason: geoEligibility.geoExclusionReason,
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
