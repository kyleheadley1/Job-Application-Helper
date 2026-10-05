import { describe, expect, it, vi } from "vitest";
import { analyzeInsights, comparePatterns } from "../../services/insights/analyze.js";
import { applyHistoryPoints, historyPoints, matchAdjustments } from "../../services/insights/applyAdjustments.js";
import { buildInsightRows, classifyOutcome, trackerAppliedAt, type InsightRow } from "../../services/insights/dataset.js";
import { mapSpreadsheetStatusToJobStatus } from "../../tracker/canonicalSpreadsheet.js";
import type { Feature } from "../../services/insights/features.js";
import type { ScoringAdjustment } from "../../services/insights/insights.repository.js";
import { runInsights, syncAdjustments, type InsightsDeps } from "../../services/insights/insights.js";
import { auc, aucPermutationP, benjaminiHochberg, fisherExact, wilson } from "../../services/insights/stats.js";
import { recomputeStoredJobScore } from "../../lib/recomputeStoredJobScore.js";
import type { GmailApplication } from "../../services/gmail/gmailApplications.js";
import type { ExtractedJobData, JobRecord } from "../../types/job.js";

const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe("insights stats", () => {
  it("wilson interval matches known values", () => {
    const half = wilson(5, 10);
    expect(half.lo).toBeCloseTo(0.2366, 3);
    expect(half.hi).toBeCloseTo(0.7634, 3);
    const none = wilson(0, 10);
    expect(none.lo).toBe(0);
    expect(none.hi).toBeCloseTo(0.2775, 3);
    expect(wilson(0, 0)).toEqual({ rate: 0, lo: 0, hi: 0 });
  });

  it("fisher exact matches the tea-tasting and perfect-split tables", () => {
    expect(fisherExact(3, 1, 1, 3)).toBeCloseTo(0.4857, 3);
    expect(fisherExact(10, 0, 0, 10)).toBeCloseTo(1.0825e-5, 8);
    expect(fisherExact(0, 0, 0, 0)).toBe(1);
  });

  it("benjamini-hochberg keeps input order and is monotone", () => {
    const q = benjaminiHochberg([0.01, 0.04, 0.03, 0.2]);
    expect(q[0]).toBeCloseTo(0.04, 6);
    expect(q[1]).toBeCloseTo(0.0533, 3);
    expect(q[2]).toBeCloseTo(0.0533, 3);
    expect(q[3]).toBeCloseTo(0.2, 6);
  });

  it("auc and its permutation p-value", () => {
    expect(auc([3, 4, 1, 2], [true, true, false, false])).toBe(1);
    expect(auc([1, 2, 3, 4], [true, true, false, false])).toBe(0);
    expect(auc([5, 5], [true, false])).toBe(0.5);
    const scores = Array.from({ length: 20 }, (_, i) => i);
    const labels = scores.map((s) => s >= 10);
    const p = aucPermutationP(scores, labels, 500);
    expect(p).toBeLessThan(0.01);
    expect(aucPermutationP(scores, labels, 500)).toBe(p);
  });
});

describe("classifyOutcome", () => {
  const gmail = (over: Partial<GmailApplication>) =>
    ({ company: "Acme", furthestStage: "applied", status: "applied", interviewRounds: [], emails: [], ...over }) as GmailApplication;
  const email = (from: string, subject: string, eventType: "interview" | "applied" = "interview") =>
    ({ id: subject, subject, from, date: daysAgo(5), eventType, gmailUrl: "" }) as GmailApplication["emails"][number];
  const booked = [{ number: 1, scheduledAt: daysAgo(4), cancelled: false }] as GmailApplication["interviewRounds"];

  it("counts any human contact as positive", () => {
    expect(
      classifyOutcome(
        { gmail: gmail({ furthestStage: "interviewing", emails: [email("Jane <jane@acme.com>", "Interview availability")] }), appliedAt: daysAgo(5) },
        NOW,
      ).outcome,
    ).toBe("positive");
    expect(
      classifyOutcome({ trackerStatus: "rejected", trackerHistory: ["applied", "interviewing", "rejected"], appliedAt: daysAgo(60) }, NOW)
        .outcome,
    ).toBe("positive");
  });

  it("assessments alone, rejections, lapses and 30+ days of silence are negative", () => {
    expect(classifyOutcome({ trackerStatus: "assessment", appliedAt: daysAgo(40) }, NOW).outcome).toBe("negative");
    expect(classifyOutcome({ gmail: gmail({ status: "rejected" }), appliedAt: daysAgo(3) }, NOW).outcome).toBe("negative");
    expect(classifyOutcome({ trackerStatus: "lapsed", appliedAt: daysAgo(10) }, NOW).outcome).toBe("negative");
    expect(classifyOutcome({ trackerStatus: "applied", appliedAt: daysAgo(31) }, NOW).outcome).toBe("negative");
  });

  it("your 'heard back' marker counts as human contact", () => {
    expect(classifyOutcome({ trackerStatus: "rejected", reachedHuman: true, appliedAt: daysAgo(90) }, NOW).outcome).toBe(
      "positive",
    );
  });

  it("your 'no call' marker overrides Gmail", () => {
    const interviewed = gmail({ furthestStage: "interviewing", interviewRounds: booked });
    expect(classifyOutcome({ gmail: interviewed, reachedHuman: false, appliedAt: daysAgo(90) }, NOW).outcome).toBe("negative");
  });

  it("an automated email labeled as an interview is not human contact", () => {
    const noto = gmail({
      furthestStage: "interviewing",
      emails: [email("Ashby <no-reply@ashbyhq.com>", "Thanks for applying to Noto")],
      interviewRounds: [{ number: 1, scheduledAt: null, cancelled: false }] as GmailApplication["interviewRounds"],
    });
    expect(classifyOutcome({ gmail: noto, appliedAt: daysAgo(60) }, NOW).outcome).toBe("negative");
  });

  it("a staffing agency only counts once it books an interview with the employer", () => {
    const outreach = gmail({
      company: "Morgan Pinnacle Group",
      furthestStage: "interviewing",
      emails: [email("Aldo <aldo.r@mpgstaff.com>", "Next Steps for Your Software Engineer Application")],
    });
    expect(classifyOutcome({ gmail: outreach, appliedAt: daysAgo(60) }, NOW).outcome).toBe("negative");
    const jobot = gmail({ company: "Jobot", furthestStage: "interviewing", emails: [email("Jeni <jeni@connect.jobot.com>", "Quick Call")] });
    expect(classifyOutcome({ gmail: jobot, appliedAt: daysAgo(60) }, NOW).outcome).toBe("negative");
    const screening = gmail({
      company: "MPGStaff",
      furthestStage: "interviewing",
      emails: [email("Aldo <aldo.r@mpgstaff.com>", "Invitation: Initial Screening @ Fri Jul 24, 2026 3:30pm")],
      interviewRounds: [{ ...booked[0]!, kind: "recruiter_screen" }],
    });
    expect(classifyOutcome({ gmail: screening, appliedAt: daysAgo(60) }, NOW).outcome).toBe("negative");
    const withEmployer = gmail({ ...screening, interviewRounds: [{ ...booked[0]!, kind: "hiring_manager" }] });
    expect(classifyOutcome({ gmail: withEmployer, appliedAt: daysAgo(60) }, NOW).outcome).toBe("positive");
  });

  it("recent silence is too early", () => {
    expect(classifyOutcome({ trackerStatus: "applied", appliedAt: daysAgo(10) }, NOW).outcome).toBe("too_early");
  });
});

const job = (id: string, over: Partial<JobRecord> = {}): JobRecord =>
  ({
    id,
    extracted: { company: `Co ${id}`, title: "Software Engineer", remoteType: "remote" },
    rules: {},
    score: { total: 70 },
    status: "applied",
    statusHistory: [{ toStatus: "applied", createdAt: daysAgo(45) }],
    createdAt: daysAgo(50),
    updatedAt: daysAgo(45),
    ...over,
  }) as unknown as JobRecord;

const app = (key: string, over: Partial<GmailApplication> = {}): GmailApplication =>
  ({
    key,
    company: `Co ${key}`,
    role: "Software Engineer",
    appliedAt: daysAgo(40),
    status: "applied",
    furthestStage: "applied",
    interviewRounds: [],
    emails: [],
    ...over,
  }) as GmailApplication;

describe("spreadsheet outcome mapping", () => {
  it("treats panel and screen outcomes as interviewing, and rejection after a screen as rejected", () => {
    expect(mapSpreadsheetStatusToJobStatus("Final panel completed / awaiting decision")).toBe("interviewing");
    expect(mapSpreadsheetStatusToJobStatus("Recruiter screen scheduled")).toBe("interviewing");
    expect(mapSpreadsheetStatusToJobStatus("Rejected after recruiter screen")).toBe("rejected");
    expect(mapSpreadsheetStatusToJobStatus("Applied/Discussed")).toBe("applied");
  });
});

describe("buildInsightRows", () => {
  it("counts a Gmail application linked to a tracker job once, and skips roles never applied to", () => {
    const rows = buildInsightRows(
      {
        jobs: [job("a"), job("b"), job("never", { status: "to_review", statusHistory: [] })],
        apps: [app("x", { trackerJobId: "a" }), app("y", { trackerJobId: "a" }), app("z")],
        evaluations: new Map(),
      },
      NOW,
    );
    expect(rows.map((r) => `${r.id}:${r.source}`).sort()).toEqual(["a:tracker+gmail", "b:tracker", "z:gmail"]);
  });

  it("imported rows use the spreadsheet's applied date, not the import time", () => {
    expect(trackerAppliedAt(job("n", { tracker: { notes: "Applied on 2026-01-07. Screen later." } } as Partial<JobRecord>))).toBe(
      "2026-01-07T12:00:00.000Z",
    );
    expect(
      trackerAppliedAt(job("d", { tracker: {}, trackerSpreadsheet: { discussed: "2026-03-25" } } as Partial<JobRecord>)),
    ).toBe("2026-03-25T12:00:00.000Z");
    expect(trackerAppliedAt(job("h", { tracker: {} } as Partial<JobRecord>))).toBe(daysAgo(45));
  });

  it("skips role-less leftover mail from a company that already has an application", () => {
    const rows = buildInsightRows(
      {
        jobs: [job("pub", { extracted: { company: "The New York Times", title: "Software Engineer, Publishing" } } as Partial<JobRecord>)],
        apps: [
          app("nyt::", { company: "The New York Times", role: null }),
          app("solo::", { company: "CM Search", role: null }),
        ],
        evaluations: new Map(),
      },
      NOW,
    );
    expect(rows.map((r) => r.id).sort()).toEqual(["pub", "solo::"]);
  });

  it("uses the tracker job's score when linked", () => {
    const [row] = buildInsightRows({ jobs: [job("a")], apps: [app("x", { trackerJobId: "a" })], evaluations: new Map() }, NOW);
    expect(row!.fit).toBe(70);
  });
});

const flag: Feature = {
  key: "flag",
  label: "Flag",
  scorable: true,
  values: (s) => [(s as InsightRow & { flag?: boolean }).flag ? "Yes" : "No"],
};

const row = (i: number, positive: boolean, flagged: boolean, fit = 70): InsightRow =>
  ({
    id: `r${i}`,
    company: `Co ${i}`,
    role: null,
    appliedAt: daysAgo(60),
    outcome: positive ? "positive" : "negative",
    outcomeReason: "",
    source: "tracker",
    fit,
    addedFromGmail: false,
    flag: flagged,
  }) as InsightRow;

describe("comparePatterns", () => {
  it("calls a strong, well-sampled difference conclusive", () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => row(i, i < 15, true)),
      ...Array.from({ length: 30 }, (_, i) => row(100 + i, i < 1, false)),
    ];
    const yes = comparePatterns(rows, [flag]).find((p) => p.bucket === "Yes")!;
    expect(yes.verdict).toBe("conclusive");
    expect(yes.diffPp).toBeGreaterThan(40);
  });

  it("finds no signal when rates are equal", () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => row(i, i < 3, true)),
      ...Array.from({ length: 30 }, (_, i) => row(100 + i, i < 3, false)),
    ];
    expect(comparePatterns(rows, [flag]).every((p) => p.verdict === "no_signal")).toBe(true);
  });

  it("needs enough positives before calling a pattern", () => {
    const rows = [
      ...Array.from({ length: 15 }, (_, i) => row(i, i < 3, true)),
      ...Array.from({ length: 200 }, (_, i) => row(100 + i, false, false)),
    ];
    expect(comparePatterns(rows, [flag]).every((p) => p.verdict === "no_signal")).toBe(true);
  });

  it("leads with the score when the score separates callbacks", () => {
    const rows = [
      ...Array.from({ length: 60 }, (_, i) => row(i, i < 12, i % 2 === 0, 85)),
      ...Array.from({ length: 60 }, (_, i) => row(100 + i, false, i % 2 === 0, 40)),
    ];
    const result = analyzeInsights(rows, new Date(NOW));
    expect(result.scorePredicts.verdict).toBe("conclusive");
    expect(result.conclusion).toBe("conclusive");
    expect(result.headline).toMatch(/fit score does predict callbacks/);
  });

  it("says it looks like chance when nothing is conclusive", () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(i, i % 50 === 0, i % 2 === 0));
    const result = analyzeInsights(rows, new Date(NOW));
    expect(result.conclusion).toBe("no_signal");
    expect(result.headline).toMatch(/chance/);
    expect(result.proposals).toEqual([]);
  });
});

const adj = (over: Partial<ScoringAdjustment>): ScoringAdjustment => ({
  id: "location=Remote",
  feature: "location",
  featureLabel: "Location / work model",
  bucket: "Remote",
  points: 3,
  evidence: { k: 10, n: 40, rate: 0.25, restRate: 0.05, diffPp: 20, q: 0.01 },
  status: "approved",
  createdAt: daysAgo(5),
  updatedAt: daysAgo(5),
  ...over,
});

describe("scoring adjustments", () => {
  const remote = { fit: 70, extracted: { remoteType: "remote" } } as Parameters<typeof matchAdjustments>[0];

  it("applies only approved, scorable, matching adjustments, each capped at ±4", () => {
    const matched = matchAdjustments(remote, [
      adj({ points: 9 }),
      adj({ id: "location=NYC onsite", bucket: "NYC onsite" }),
      adj({ id: "p", status: "proposed" }),
      adj({ id: "weekday=Friday", feature: "weekday", bucket: "Friday" }),
    ]);
    expect(matched).toEqual([{ id: "location=Remote", label: "Location / work model: Remote", points: 4 }]);
  });

  it("caps the total at ±8 and keeps the score within 0-100", () => {
    const many = [1, 2, 3].map((i) => ({ id: `${i}`, label: "", points: 4 }));
    expect(historyPoints(many)).toBe(8);
    expect(historyPoints(many.map((a) => ({ ...a, points: -4 })))).toBe(-8);
    expect(applyHistoryPoints(97, many)).toBe(100);
    expect(applyHistoryPoints(70, [])).toBe(70);
  });

  it("sync keeps your decisions: dismissed stays dismissed, approved keeps its points, unsupported proposals withdraw", () => {
    const now = daysAgo(0);
    const existing = [
      adj({ id: "a", status: "dismissed" }),
      adj({ id: "b", status: "approved", points: 2 }),
      adj({ id: "c", status: "proposed" }),
    ];
    const proposals = [
      { ...adj({ id: "a" }), points: 4 },
      { ...adj({ id: "b" }), points: 4 },
      { ...adj({ id: "d" }), points: -2 },
    ].map(({ status: _s, createdAt: _c, updatedAt: _u, ...p }) => p);
    const out = new Map(syncAdjustments(existing, proposals, now).map((a) => [a.id, a]));
    expect(out.get("a")!.status).toBe("dismissed");
    expect(out.get("b")).toMatchObject({ status: "approved", points: 2 });
    expect(out.get("c")!.status).toBe("withdrawn");
    expect(out.get("d")).toMatchObject({ status: "proposed", points: -2 });
  });

  it("recomputing a stored job re-applies its own frozen adjustments, never new ones", () => {
    const extracted: ExtractedJobData = {
      company: "Acme",
      title: "Software Engineer",
      location: "Remote",
      remoteType: "remote",
      stack: ["TypeScript", "Node.js"],
      requiredSkills: ["TypeScript"],
      preferredSkills: [],
      domainTags: ["saas"],
      rawText: "Acme — Software Engineer\nRemote\n2+ years of TypeScript.",
    };
    const base = job("s", {
      extracted,
      rules: { notes: [], hardRuleNotes: [] } as unknown as JobRecord["rules"],
      score: {
        stackFit: 16,
        levelFit: 14,
        domainFit: 7,
        resumeStoryClarity: 8,
        functionalOverlap: 12,
        recruiterFriendliness: 10,
        careerValue: 6,
        total: 70,
      },
      recommendedResume: "BASE",
    });
    const plain = recomputeStoredJobScore({ job: base });
    const frozen = [{ id: "location=Remote", label: "Location / work model: Remote", points: 3 }];
    const withFrozen = recomputeStoredJobScore({ job: { ...base, score: { ...base.score, historyAdjustments: frozen } } });
    expect(plain.score.scoreDisplay?.hardGates ?? []).toEqual([]);
    expect(withFrozen.score.total).toBeCloseTo(Math.min(100, plain.score.total + 3), 5);
    expect(withFrozen.score.historyAdjustments).toEqual(frozen);
    expect(plain.score.historyAdjustments).toBeUndefined();
  });
});

describe("runInsights", () => {
  const deps = (allowedUnits: number): InsightsDeps & { saved: ScoringAdjustment[] } => {
    const saved: ScoringAdjustment[] = [];
    return {
      saved,
      compute: async () => ({ ...analyzeInsights([], new Date(NOW)), quietGoodFits: [] }),
      loadBudget: async () => ({
        monthlyUsd: 0.3,
        spentThisMonthUsd: 0,
        todayAllowanceUsd: allowedUnits * 0.01,
        allowedUnits,
        exhausted: false,
      }),
      summarize: vi.fn(async () => "Plain summary"),
      latestRun: async () => null,
      saveRun: vi.fn(async () => {}),
      listAdjustments: async () => [],
      saveAdjustment: async (a) => {
        saved.push(a);
      },
    };
  };

  it("skips the paid summary when the budget is spent", async () => {
    const d = deps(0);
    const run = await runInsights("manual", d, new Date(NOW));
    expect(d.summarize).not.toHaveBeenCalled();
    expect(run.summary).toBeUndefined();
    expect(d.saveRun).toHaveBeenCalledOnce();
  });

  it("adds the summary when the budget allows", async () => {
    const run = await runInsights("weekly", deps(1), new Date(NOW));
    expect(run.summary).toBe("Plain summary");
    expect(run.trigger).toBe("weekly");
  });
});
