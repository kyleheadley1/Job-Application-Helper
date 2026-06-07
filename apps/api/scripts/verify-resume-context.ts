import { randomUUID } from "node:crypto";
import { evaluateRules } from "../src/agents/jobAgent/rules.js";
import {
  mapRecommendationFromScore,
  resolveRecommendation,
  scoreJob,
} from "../src/agents/jobAgent/scoring.js";
import { selectResume } from "../src/agents/jobAgent/resumeSelector.js";
import { buildDeterministicGeneratedAssets } from "../src/agents/jobAgent/assetGeneration.js";
import { userProfile } from "../src/config/userProfile.js";
import { getTrackerColor, shouldShortlist } from "../src/config/scoringPolicy.js";
import { buildTrackerSpreadsheetFromJob } from "../src/tracker/canonicalSpreadsheet.js";
import { resumeContextService } from "../src/services/resume/resumeContext.js";
import type { ExtractedJobData, JobRecord } from "../src/types/job.js";
import type { ResumeSelection } from "../src/types/resume.js";
import type { ScoreBreakdown } from "../src/types/scoring.js";

const makeJob = (
  extracted: ExtractedJobData,
  scored: ScoreBreakdown,
  selectedResume: ResumeSelection,
  topMatch: string,
  mainRisk: string,
): JobRecord => {
  const now = new Date().toISOString();
  const recommendation = mapRecommendationFromScore(scored.total);
  const initial: JobRecord = {
    id: randomUUID(),
    extracted,
    rules: evaluateRules(extracted, userProfile),
    score: scored,
    recommendation,
    salaryAsk: {},
    recommendedResume: selectedResume.recommendedResume,
    resumeRationale: selectedResume.rationale,
    topMatch,
    mainRisk,
    rationale: [],
    risks: [],
    generated: {},
    tracker: {
      priority: scored.total >= 78 ? "high" : scored.total >= 70 ? "medium" : "low",
      recommendedAction:
        recommendation === "yes"
          ? "Apply with urgency"
          : recommendation === "selective_yes"
            ? "Apply selectively with caveats"
            : "Skip unless special reason",
      statusOutcome: recommendation,
      shortlist: shouldShortlist(scored.total, "to_review"),
      color: getTrackerColor("to_review", scored.total),
    },
    status: "to_review",
    createdAt: now,
    updatedAt: now,
    scoreHistory: [{ scoredAt: now, score: scored, recommendation }],
  };
  return { ...initial, trackerSpreadsheet: buildTrackerSpreadsheetFromJob(initial) };
};

const EXAMPLES: Array<{ label: string; extracted: ExtractedJobData }> = [
  {
    label: "Strong SWE role",
    extracted: {
      company: "Nimbus Product Labs",
      title: "Full-Stack Product Engineer",
      stack: ["TypeScript", "Node.js", "React"],
      requiredSkills: ["REST APIs", "internal tools", "product collaboration"],
      preferredSkills: ["LLM workflows"],
      domainTags: ["SaaS"],
      responsibilities: [
        "Ship customer-facing and internal product features end-to-end.",
        "Build and maintain API-first services used by operations workflows.",
        "Partner with product and design on pragmatic tradeoff decisions.",
      ],
      requirements: [
        "2+ years software engineering experience",
        "Strong TypeScript and Node.js skills",
        "Experience shipping full-stack product increments",
      ],
      rawText:
        "Full-Stack Product Engineer role focused on product feature shipping, API design, internal tools, and stakeholder collaboration.",
    },
  },
  {
    label: "SIE / implementation role",
    extracted: {
      company: "DeployBridge",
      title: "Forward Deployed Solutions Engineer",
      stack: ["TypeScript", "APIs"],
      requiredSkills: ["integrations", "implementation delivery", "stakeholder communication"],
      preferredSkills: ["customer onboarding"],
      domainTags: ["B2B"],
      responsibilities: [
        "Lead technical onboarding and customer implementation timelines.",
        "Own integration delivery with enterprise APIs and partner systems.",
        "Translate ambiguous business requirements into executable technical plans.",
      ],
      requirements: [
        "Strong implementation and integration experience",
        "Comfort with customer-facing technical delivery",
        "Ability to drive milestones across cross-functional teams",
      ],
      rawText:
        "Forward deployed solutions engineer role focused on implementation, integrations, onboarding, delivery, and stakeholder communication.",
    },
  },
  {
    label: "Early Career role (hard-rule constrained)",
    extracted: {
      company: "TraditionBank",
      title: "Associate Software Engineer - Rotational Program",
      stack: ["Java", "SQL"],
      requiredSkills: ["new grad rotational program", "onsite"],
      preferredSkills: ["enterprise systems"],
      domainTags: ["finance"],
      responsibilities: ["Support rotational engineering teams on enterprise software initiatives."],
      requirements: [
        "Bachelor's degree required",
        "US citizenship required",
        "No visa sponsorship",
        "Entry-level/new grad pipeline only",
      ],
      rawText:
        "Associate new grad rotational role. Bachelor's degree required. US citizenship required. No visa sponsorship.",
    },
  },
  {
    label: "Borderline SWE role (resume support expected)",
    extracted: {
      company: "OpsAtlas",
      title: "Software Engineer, Internal Applications",
      location: "Hybrid - Newark, NJ",
      stack: ["JavaScript", "Node.js"],
      requiredSkills: ["internal tools", "APIs", "workflow automation"],
      preferredSkills: ["TypeScript", "React"],
      domainTags: ["operations"],
      responsibilities: [
        "Build internal applications that streamline operations workflows.",
        "Implement API integrations and pragmatic feature iterations with product stakeholders.",
      ],
      requirements: [
        "1-3 years experience building practical software products",
        "Comfort working across backend and frontend boundaries",
      ],
      rawText:
        "Hybrid internal applications role with API integrations, practical workflow automation, and close product collaboration.",
    },
  },
];

const run = async () => {
  const resumeContexts = await resumeContextService.getAvailableContexts();
  const report: unknown[] = [];

  for (const ex of EXAMPLES) {
    const rules = evaluateRules(ex.extracted, userProfile);
    const baseRun = await scoreJob({ extracted: ex.extracted, rules, userProfile });
    const scoreBefore = baseRun.scoring.score;
    const scoreAfter = scoreBefore;
    const selectedResume = await selectResume({
      extracted: ex.extracted,
      score: scoreAfter,
      topMatch: baseRun.scoring.topMatch,
      mainRisk: baseRun.scoring.mainRisk,
      userProfile,
      resumeContexts,
    });
    const selectedCtx = await resumeContextService.getContext(selectedResume.recommendedResume);
    const job = makeJob(ex.extracted, scoreAfter, selectedResume, baseRun.scoring.topMatch, baseRun.scoring.mainRisk);
    job.recommendation = resolveRecommendation(scoreAfter.total, rules, scoreAfter.careerValue);
    job.tracker.statusOutcome = job.recommendation;
    job.tracker.shortlist = shouldShortlist(scoreAfter.total, "to_review");

    const withCtx = buildDeterministicGeneratedAssets(job, userProfile, selectedCtx ?? undefined);
    const withoutCtx = buildDeterministicGeneratedAssets(job, userProfile, undefined);

    report.push({
      example: ex.label,
      selectedResume: selectedResume.recommendedResume,
      resumeContextLoaded: Boolean(selectedCtx),
      hardRuleBlockers: {
        explicitDegreeRisk: rules.explicitDegreeRisk,
        citizenshipMismatch: rules.citizenshipMismatch,
        clearanceMismatch: rules.clearanceMismatch,
        strictNewGradPipeline: rules.strictNewGradPipeline,
        seniorityOverreach: rules.seniorityOverreach,
        domainMismatch: rules.domainMismatch,
      },
      scoreBefore,
      scoreAfter,
      adjustments: {
        resumeStoryClarity: scoreAfter.resumeStoryClarity - scoreBefore.resumeStoryClarity,
        functionalOverlap: scoreAfter.functionalOverlap - scoreBefore.functionalOverlap,
        total: scoreAfter.total - scoreBefore.total,
        recommendationBefore: mapRecommendationFromScore(scoreBefore.total),
        recommendationAfter: mapRecommendationFromScore(scoreAfter.total),
      },
      generationWithSelectedResume: {
        coverLetter: withCtx.coverLetter ?? "",
        whyCompany: withCtx.whyCompany ?? "",
        bulletCandidates: withCtx.tailoredBulletCandidates ?? [],
      },
      generationWithoutResumeContextSample: {
        coverLetterFirstSentence:
          (withoutCtx.coverLetter ?? "")
            .split(/\\n|\\./)
            .map((s) => s.trim())
            .filter(Boolean)[0] ?? "",
        whyCompanyFirstSentence:
          (withoutCtx.whyCompany ?? "")
            .split(/\\n|\\./)
            .map((s) => s.trim())
            .filter(Boolean)[0] ?? "",
        firstBullet: withoutCtx.tailoredBulletCandidates?.[0] ?? "",
      },
    });
  }

  console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), examples: report }, null, 2));
};

void run();
