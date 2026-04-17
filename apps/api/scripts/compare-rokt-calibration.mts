import "../src/config/env.js";
import request from "supertest";
import { app } from "../src/app.js";
import { normalizeText } from "../src/lib/text.js";
import { mapRecommendationFromScore, scoreJobDeterministicPreview } from "../src/agents/jobAgent/scoring.js";
import type { ExtractedJobData, JobRecord } from "../src/types/job.js";
import type { RuleEvaluation, ScoreBreakdown } from "../src/types/scoring.js";
import type { ResumeType } from "../src/types/resume.js";

const ROKT_RAW = `
Rokt is a global leader in ecommerce, unlocking real-time relevance in the moment that matters most. Rokt's AI Brain and ecommerce Network powers 10 billion+ transactions per year for hundreds of millions of customers, and is trusted to do this by the world's leading companies.

We are a team of builders helping smart businesses find innovative ways to meet customer needs and generate incremental revenue. Leading companies drive 10-50% of additional revenue—and often all their profits—from the extra products or services they sell. This economic edge unleashes a world of possibilities for growth and innovation.

We are looking for Junior Software Engineers
At Rokt, we practice transparency in career paths and compensation. We have a well-defined career ladder with transparent compensation and clear career paths based on competency and ability.

Target total compensation of $90,000 - $170,000, including a fixed annual salary of $85,000 - $150,000, an employee equity plan grant, and world-class benefits.

Equity grants are issued in good faith, subject to company policies, board approval, and individual eligibility.

About the role:

This is an entry-level/early career role designed to help you grow as a Builder (engineer) while contributing to meaningful work. You will learn from experienced colleagues and gain hands-on experience building a diversity of services, from internal tools through to Rokt’s internet scale production systems.

You will build broad knowledge and experience across systems, software, data, and data science, with regular opportunities to work across different domains and teams as you grow as a Builder at Rokt.

What You’ll Do
Design & Build Innovative Products: Develop and iterate on next-generation ecommerce features and services, leveraging your computer science fundamentals and AI tooling to create & improve intelligent, personalized ecommerce experiences.
Accelerate Development with AI: Leverage AI tools and automation to speed up coding, testing, and deployment, so you and other builders can focus on creative problem-solving and quality.
Full-Stack Product Ownership: Work across the entire product lifecycle - from ideation and prototyping to implementation and continuous improvement - ensuring each feature delivers real value.
Collaborate & Innovate: Partner with product managers, designers, and other engineers to conceptualize and implement AI-driven solutions that enhance user experience and drive business outcomes.
Optimize & Scale: Identify performance bottlenecks and opportunities for improvement in our systems. Use data insights to refine user interfaces, optimize algorithms, and ensure our platform can scale to billions of transactions.
Drive Revenue Growth: Spearhead the development and deployment of innovative features and capabilities that directly drive growth of the business, with the potential to generate millions of dollars in additional revenue.
Who You Are
AI-Enthusiast & Quick Learner: You embrace new technologies on the forefront of AI development and learn rapidly, adapting to innovative tools and workflows to stay ahead of the curve.
Problem Solver: You excel at breaking down complex problems using first principles and creativity. Challenges are puzzles you’re excited to solve.
Entrepreneurial Mindset: You take ownership of outcomes, move fast with confidence, and aren’t afraid to navigate ambiguity—figuring things out independently when needed.
Collaborative Team Player: You communicate clearly and work well with cross-functional teams. You value feedback, share ideas openly, and help others succeed.
Driven & Results-Oriented: You set high standards for your work, take pride in delivering quality, and continually seek to improve. You care about the impact of your code on the business and customers.
About The Benefits:

We leverage best-in-class technology and market-leading innovation in AI and ML, with all of that being underlined by building and maintaining a fantastic and inclusive culture where people can be their authentic selves, and offering a great list of perks and benefits to go with it:

Become a shareholder. Every Rokt'star gets equity in the company
Enjoy catered lunch every day and healthy snacks in the office. Plus join the gym on us!
Extra leave (bonus annual leave, sabbatical leave etc.)
Work with the greatest talent in town
See the world! We have offices in New York, Seattle, Sydney, Tokyo and London.
We believe we’re better together. We love spending time together and are in the office most days (teams are in the office minimum 4 days per week).

We at Rokt choose to create a company that is as diverse and inclusive as the world we live in by attracting, growing & keeping the best talent. Equal employment opportunities are available to all applicants without regard to race, religion, color, national origin, gender, sexual orientation, age, marital status, veteran status, or disability status.

If this sounds like a role you’d enjoy, apply here, and you’ll hear from our recruiting team.

Note on Recruitment Process: The first stage of the recruitment process for this role is to complete a 15-minute online aptitude test as well as an employee personality profile assessment, which will be sent out to your application email. Successful candidates will be contacted to discuss the next steps.
`.trim();

const beforeDeterministicScore = (job: ExtractedJobData, rules: RuleEvaluation): ScoreBreakdown => {
  const stackHits = [job.stack, job.requiredSkills, job.preferredSkills].flat().join(" ").toLowerCase();
  const fitBlob = normalizeText(
    [
      job.title,
      job.company,
      job.seniority,
      job.location,
      job.rawText,
      ...(job.stack ?? []),
      ...(job.requiredSkills ?? []),
      ...(job.preferredSkills ?? []),
      ...(job.requirements ?? []),
      ...(job.responsibilities ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
  let stackFit = stackHits.includes("typescript") || stackHits.includes("javascript") ? 18 : 10;
  if (/\btypescript\b/i.test(fitBlob)) stackFit = Math.min(25, stackFit + 2);
  if (/\bnode\.?js\b|\bnode\b/i.test(fitBlob)) stackFit = Math.min(25, stackFit + 1);
  if (/\breact\b/i.test(fitBlob)) stackFit = Math.min(25, stackFit + 1);
  if (/\brest(ful)?\s+apis?\b|\brest\s+api\b/i.test(fitBlob)) stackFit = Math.min(25, stackFit + 1);

  const levelFit = rules.seniorityOverreach ? 5 : 11;
  const domainFit = rules.domainMismatch ? 4 : 7;
  const resumeStoryClarity = rules.stackMismatch ? 6 : 11;
  let functionalOverlap = rules.stackMismatch ? 4 : 7;
  if (/\binternal\s+tools\b/i.test(fitBlob)) functionalOverlap = Math.min(10, functionalOverlap + 1);
  if (/\bai[-\s]?enabled\b|\bllm\b|\bworkflow\b/i.test(fitBlob))
    functionalOverlap = Math.min(10, functionalOverlap + 1);

  let recruiterFriendliness = Math.max(0, 12 - Object.keys(rules.penaltyVector ?? {}).length * 2);
  if (/\bremote\b|\bdistributed\b|\bwfh\b/i.test(fitBlob))
    recruiterFriendliness = Math.min(15, recruiterFriendliness + 1);
  if (/\b(nyc|new york|manhattan|brooklyn|hybrid\s+nyc|nyc[-\s]friendly)\b/i.test(fitBlob))
    recruiterFriendliness = Math.min(15, recruiterFriendliness + 1);

  let careerValue = 7;
  if (/\bstartup\b|\bseed[-\s]?stage\b/i.test(fitBlob)) careerValue = Math.min(10, careerValue + 1);
  if (/\bproduct\s+engineer\b/i.test(fitBlob)) careerValue = Math.min(10, careerValue + 1);

  const subtotal =
    stackFit +
    levelFit +
    domainFit +
    resumeStoryClarity +
    functionalOverlap +
    recruiterFriendliness +
    careerValue;
  const penalty = Object.values(rules.penaltyVector ?? {}).reduce((sum, value) => sum + value, 0);
  const total = Math.max(0, Math.min(100, subtotal - Math.round(penalty / 3)));
  return {
    stackFit,
    levelFit,
    domainFit,
    resumeStoryClarity,
    functionalOverlap,
    recruiterFriendliness,
    careerValue,
    total,
  };
};

const beforeDeterministicResume = (job: ExtractedJobData): ResumeType => {
  const text = normalizeText(
    [job.title, job.rawText ?? "", (job.requirements ?? []).join(" "), (job.responsibilities ?? []).join(" ")].join(" "),
  );
  const sieSignals = [
    "forward deployed",
    "solutions engineer",
    "customer-facing implementation",
    "implementation",
    "integrations",
    "customer deployment",
    "technical onboarding",
    "solution design",
    "delivery timelines",
    "integration timelines",
    "partner engineering",
    "pre-sales",
    "post-sales",
    "api integration",
    "workflow implementation",
    "technical implementation",
  ];
  const earlySignals = ["new grad", "entry level", "early career", "rotational", "associate"];
  const sweSignals = ["software engineer", "full-stack", "backend", "api", "product engineer"];
  const sieHits = sieSignals.filter((needle) => text.includes(needle)).length;
  const earlyHits = earlySignals.filter((needle) => text.includes(needle)).length;
  const sweHits = sweSignals.filter((needle) => text.includes(needle)).length;
  const combined: Record<ResumeType, number> = {
    SWE: sweHits,
    SIE: sieHits,
    EARLY_CAREER: earlyHits,
  };
  return (Object.entries(combined).sort((a, b) => b[1] - a[1])[0]?.[0] as ResumeType) ?? "SWE";
};

function topUnique(items: string[], n: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
    if (out.length >= n) break;
  }
  return out;
}

const summarizeDecisionPanel = (job: JobRecord) => ({
  whyConsider: topUnique([job.topMatch, ...job.rationale], 2),
  keyRisks: topUnique([job.mainRisk, ...job.risks], 2),
});

async function run() {
  const triage = await request(app).post("/api/jobs/triage").send({
    rawText: ROKT_RAW,
    companyHint: "Rokt",
    fullPrep: false,
  });
  if (triage.status !== 200) {
    throw new Error(`Triage failed (${triage.status}): ${JSON.stringify(triage.body)}`);
  }

  const current = triage.body as JobRecord;
  const generatedRes = await request(app).post(`/api/jobs/${current.id}/generate-assets`).send({ force: false });
  if (generatedRes.status !== 200) {
    throw new Error(`Asset generation failed (${generatedRes.status}): ${JSON.stringify(generatedRes.body)}`);
  }
  const withAssets = generatedRes.body as JobRecord;

  const beforeScore = beforeDeterministicScore(withAssets.extracted, withAssets.rules);
  const beforeRecommendation = mapRecommendationFromScore(beforeScore.total);
  const beforeResume = beforeDeterministicResume(withAssets.extracted);

  const afterDeterministic = scoreJobDeterministicPreview({
    extracted: withAssets.extracted,
    rules: withAssets.rules,
  }).score;

  const output = {
    calibrationInput: {
      company: withAssets.extracted.company,
      title: withAssets.extracted.title,
      usedExactRawText: true,
    },
    before: {
      score: beforeScore,
      recommendation: beforeRecommendation,
      recommendedResume: beforeResume,
    },
    after: {
      score: withAssets.score,
      recommendation: withAssets.recommendation,
      recommendedResume: withAssets.recommendedResume,
    },
    deterministicScoreDeltaOnly: {
      before: beforeScore,
      after: afterDeterministic,
    },
    updatedDecisionPanel: summarizeDecisionPanel(withAssets),
    updatedCoverLetter: withAssets.generated.coverLetter ?? "",
    debug: {
      triageExtraction: withAssets.debugExtraction?.extraction,
      triageScoring: withAssets.debugExtraction?.scoring,
      assetSlices: withAssets.debugAssetGeneration?.slices,
    },
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
