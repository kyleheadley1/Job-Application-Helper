/**
 * Phase 2.2 audit: triage (extraction + scoring) + asset generation for four canonical cases.
 * Run: cd apps/api && npx tsx scripts/audit-triage-assets.mts
 */
import "../src/config/env.js";
import request from "supertest";
import { app } from "../src/app.js";
import { jobsRepository } from "../src/services/jobs/jobs.repository.js";

const STARTUP_RAW = `
Nimbus Labs — Software Engineer — Product (Seed-stage startup)
Remote (US). NYC-friendly hybrid optional.

Build customer-facing features with TypeScript, Node.js, React, and REST APIs.
Ship internal tools and AI-enabled workflows for operations teams.
2+ years experience; we care about product sense and ambiguity.

Salary: 130000 USD - 160000 USD
`.trim();

const SIE_RAW = `
DeployCo — Solutions Engineer (Forward Deployed)
Hybrid NYC.

You will own customer-facing implementation, integrations with enterprise APIs, and technical onboarding workshops.

Requirements:
- Strong communication and stakeholder collaboration
- Experience with integrations and delivery timelines

Salary: $140k–$200k
`.trim();

const EARLY_CAREER_ROLE = `
CampusTech — Software Engineer I (Early Career)
Remote.

We are hiring for our early career rotational program for recent graduates.
Build features in JavaScript and React with mentorship.

Requirements:
- Entry level friendly; 0-2 years experience
`.trim();

const BAD_BANK_NEW_GRAD = `
Heritage Bank — Associate Software Engineer (New Graduate Program)
Location: Onsite, Dallas, TX (not commutable from NYC)

Requirements:
Bachelor's degree in Computer Science or related field required.
This is a new graduate rotational program targeting traditional campus hires.
5+ years of enterprise Java experience preferred.
US citizenship required.
No visa sponsorship.
`.trim();

type Body = Record<string, unknown>;

function sliceSummary(d?: { success?: boolean; fallbackUsed?: boolean; parseStage?: string }) {
  if (!d) return undefined;
  return { success: d.success, fallbackUsed: d.fallbackUsed, parseStage: d.parseStage };
}

function summarize(body: Body) {
  const g = (body.generated ?? {}) as Record<string, unknown>;
  const dbg = body.debugAssetGeneration as { slices?: Record<string, { success: boolean; fallbackUsed: boolean }> } | undefined;
  const tri = body.debugExtraction as
    | {
        fallbackUsed?: boolean;
        extraction?: { success?: boolean; fallbackUsed?: boolean; parseStage?: string };
        scoring?: { success?: boolean; fallbackUsed?: boolean; parseStage?: string };
      }
    | undefined;
  const slices = dbg?.slices ?? {};
  return {
    debugTriage: {
      legacyFallbackUsed: tri?.fallbackUsed,
      extraction: sliceSummary(tri?.extraction),
      scoring: sliceSummary(tri?.scoring),
    },
    score: body.score,
    recommendation: body.recommendation,
    selectedResume: body.recommendedResume,
    coverLetter: g.coverLetter,
    whyCompany: g.whyCompany,
    emphasize: g.emphasize,
    avoidClaiming: g.avoidClaiming,
    debugAssetGeneration: {
      slices: Object.fromEntries(
        Object.entries(slices).map(([k, v]) => [k, { success: v.success, fallbackUsed: v.fallbackUsed }]),
      ),
    },
  };
}

async function main() {
  await jobsRepository.clearForTests();

  const t1 = await request(app).post("/api/jobs/triage").send({
    rawText: STARTUP_RAW,
    companyHint: "Nimbus Labs",
    fullPrep: false,
  });
  const g1 = await request(app).post(`/api/jobs/${t1.body.id}/generate-assets`).send({});

  const t2 = await request(app).post("/api/jobs/triage").send({
    rawText: SIE_RAW,
    companyHint: "DeployCo",
    fullPrep: false,
  });
  const g2 = await request(app).post("/api/jobs/generate-assets").send({
    job: t2.body,
    persist: false,
  });

  const t3 = await request(app).post("/api/jobs/triage").send({
    rawText: EARLY_CAREER_ROLE,
    companyHint: "CampusTech",
    fullPrep: false,
  });
  const g3 = await request(app).post(`/api/jobs/${t3.body.id}/generate-assets`).send({});

  const t4 = await request(app).post("/api/jobs/triage").send({
    rawText: BAD_BANK_NEW_GRAD,
    companyHint: "Heritage Bank",
    fullPrep: false,
  });
  const blocked = await request(app).post(`/api/jobs/${t4.body.id}/generate-assets`).send({});
  const g4 = await request(app).post(`/api/jobs/${t4.body.id}/generate-assets`).send({ force: true });

  const out = {
    case1_strong_swe_startup: { http: g1.status, ...summarize(g1.body as Body) },
    case2_sie_integrations: { http: g2.status, ...summarize(g2.body as Body) },
    case3_early_career: { http: g3.status, ...summarize(g3.body as Body) },
    case4_no_recommendation_force_true: { http: g4.status, ...summarize(g4.body as Body) },
    blocked_no_without_force: {
      http: blocked.status,
      body: blocked.body,
      triageRecommendation: t4.body.recommendation,
      triageDebug: {
        extraction: sliceSummary(t4.body.debugExtraction?.extraction),
        scoring: sliceSummary(t4.body.debugExtraction?.scoring),
      },
    },
  };

  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
