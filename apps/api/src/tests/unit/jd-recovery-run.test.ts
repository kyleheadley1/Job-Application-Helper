import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GmailApplication } from "../../services/gmail/gmailApplications.js";
import type { ParsedEmail } from "../../services/gmail/gmailClient.js";
import type { ApplicationEvaluation } from "../../services/gmail/jdRecovery/evaluations.repository.js";
import type { FetchedPosting } from "../../services/gmail/jdRecovery/fetchPosting.js";

const LONG = "Build TypeScript services and React interfaces for our healthcare platform. ".repeat(12);

const state = vi.hoisted(() => ({
  apps: [] as GmailApplication[],
  inbox: new Map<string, ParsedEmail>(),
  postings: new Map<string, FetchedPosting>(),
  serperResults: new Map<string, Array<{ title: string; link: string }>>(),
  evaluations: new Map<string, ApplicationEvaluation>(),
  usage: { jobKeys: [] as string[], queries: 0 },
  cap: 10,
}));

vi.mock("../../services/gmail/gmailApplications.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/gmail/gmailApplications.js")>()),
  getGmailApplications: vi.fn(async () => state.apps),
}));

vi.mock("../../services/gmail/gmailClient.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/gmail/gmailClient.js")>()),
  gmailClient: {
    listMessageIds: vi.fn(),
    getMessage: vi.fn(async (id: string) => {
      const email = state.inbox.get(id);
      if (!email) throw new Error(`no email ${id}`);
      return email;
    }),
  },
}));

vi.mock("../../services/gmail/jdRecovery/fetchPosting.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/gmail/jdRecovery/fetchPosting.js")>();
  return {
    ...actual,
    fetchPosting: vi.fn(async (url: string) => {
      const p = state.postings.get(url);
      if (!p) throw new actual.PostingFetchError("not_found", `404 ${url}`);
      return p;
    }),
  };
});

vi.mock("../../services/gmail/jdRecovery/serperClient.js", () => ({
  serperClient: {
    isConfigured: vi.fn(() => true),
    search: vi.fn(async (q: string) => state.serperResults.get(q) ?? []),
  },
  serperUsageRepository: {
    get: vi.fn(async () => ({ jobKeys: [...state.usage.jobKeys], queries: state.usage.queries, cap: state.cap })),
    record: vi.fn(async (key: string, queries: number) => {
      if (!state.usage.jobKeys.includes(key)) state.usage.jobKeys.push(key);
      state.usage.queries += queries;
    }),
  },
}));

vi.mock("../../services/gmail/jdRecovery/evaluations.repository.js", () => ({
  evaluationsRepository: {
    findByKeys: vi.fn(async (keys: string[]) => {
      const out = new Map<string, ApplicationEvaluation>();
      for (const k of keys) {
        const e = state.evaluations.get(k);
        if (e) out.set(k, structuredClone(e));
      }
      return out;
    }),
    upsert: vi.fn(async (e: ApplicationEvaluation) => {
      state.evaluations.set(e.key, structuredClone(e));
    }),
    updateOutcome: vi.fn(async (key: string, outcome: ApplicationEvaluation["outcome"]) => {
      const e = state.evaluations.get(key);
      if (e) e.outcome = outcome;
    }),
    listSince: vi.fn(async () => [...state.evaluations.values()]),
  },
}));

vi.mock("../../agents/jobAgent/orchestrator.js", () => ({
  triageJob: vi.fn(async () => ({
    score: { total: 78 },
    recommendation: "selective_yes",
    recommendedResume: "BASE",
  })),
}));

import { triageJob } from "../../agents/jobAgent/orchestrator.js";
import { serperClient, serperUsageRepository } from "../../services/gmail/jdRecovery/serperClient.js";
import { evaluationsRepository } from "../../services/gmail/jdRecovery/evaluations.repository.js";
import {
  buildSerperQueries,
  rankSerperResults,
  recoverApplication,
  runRecovery,
} from "../../services/gmail/jdRecovery/runRecovery.js";
import { buildRubricSummary } from "../../services/gmail/jdRecovery/summary.js";

const day = (n: number) => new Date(Date.UTC(2026, 8, n)).toISOString();

const addApp = (opts: {
  key: string;
  company: string;
  role: string | null;
  appliedDay: number;
  status?: GmailApplication["status"];
  subject?: string;
  body?: string;
  links?: string[];
}): GmailApplication => {
  const emailId = `e-${opts.key}`;
  state.inbox.set(emailId, {
    id: emailId,
    threadId: `t-${opts.key}`,
    date: day(opts.appliedDay),
    from: `jobs@${opts.company.toLowerCase().replace(/\W/g, "")}.com`,
    subject: opts.subject ?? `Thanks for applying to ${opts.company}`,
    snippet: "",
    body: opts.body ?? "We received your application.",
    links: opts.links ?? [],
  });
  const app: GmailApplication = {
    key: opts.key,
    company: opts.company,
    role: opts.role,
    appliedAt: day(opts.appliedDay),
    status: opts.status ?? "applied",
    lastUpdateAt: day(opts.appliedDay),
    emails: [
      {
        id: emailId,
        subject: opts.subject ?? "",
        from: "",
        date: day(opts.appliedDay),
        eventType: opts.status === "rejected" ? "rejected" : "applied",
        gmailUrl: "",
      },
    ],
  };
  state.apps.push(app);
  return app;
};

const addPosting = (url: string, over: Partial<FetchedPosting> = {}) =>
  state.postings.set(url, { url, source: "greenhouse", text: LONG, ...over });

beforeEach(() => {
  state.apps = [];
  state.inbox.clear();
  state.postings.clear();
  state.serperResults.clear();
  state.evaluations.clear();
  state.usage = { jobKeys: [], queries: 0 };
  state.cap = 10;
  vi.mocked(triageJob).mockClear();
  vi.mocked(serperClient.search).mockClear();
  vi.mocked(serperClient.isConfigured).mockReturnValue(true);
  vi.mocked(serperUsageRepository.record).mockClear();
  vi.mocked(evaluationsRepository.updateOutcome).mockClear();
});

describe("JD recovery runner", () => {
  it("scores from a verified email link without calling Serper, blind to email and outcome", async () => {
    const url = "https://boards.greenhouse.io/acme/jobs/4567890";
    addApp({ key: "acme::se", company: "Acme", role: "Software Engineer", appliedDay: 20, status: "rejected", links: [url] });
    addPosting(url, { company: "Acme", title: "Software Engineer" });

    await runRecovery(30, 5);

    expect(serperClient.search).not.toHaveBeenCalled();
    expect(triageJob).toHaveBeenCalledTimes(1);
    const input = vi.mocked(triageJob).mock.calls[0]![0];
    expect(Object.keys(input).sort()).toEqual(["companyHint", "fullPrep", "rawText"]);
    expect(input.rawText).toBe(LONG);
    expect(JSON.stringify(input)).not.toMatch(/rejected|Thanks for applying|received your application/i);

    const e = state.evaluations.get("acme::se")!;
    expect(e.recovery).toMatchObject({ status: "scored", source: "email_link", url, match: { level: "high" } });
    expect(e.fit).toMatchObject({ total: 78, recommendedResume: "BASE" });
    expect(e.outcomeAtScoring).toBe("rejected");
    expect(e.jd?.textHash).toBeTruthy();
  });

  it("falls back to Serper with the req ID and scores only an exact match", async () => {
    addApp({
      key: "uhg::ase",
      company: "UnitedHealth Group",
      role: "Associate Software Engineer",
      appliedDay: 21,
      subject: "Associate Software Engineer (2389186)",
    });
    const hit = "https://uhg.wd1.myworkdayjobs.com/External/job/MN/Associate-Software-Engineer_2389186";
    state.serperResults.set('"UnitedHealth Group" "2389186"', [
      { title: "Indeed", link: "https://www.indeed.com/viewjob?jk=1" },
      { title: "UHG", link: hit },
    ]);
    addPosting(hit, { source: "workday", company: "UnitedHealth Group", title: "Associate Software Engineer", requisitionId: "2389186" });

    await runRecovery(30, 5);

    expect(serperClient.search).toHaveBeenCalledTimes(1);
    const e = state.evaluations.get("uhg::ase")!;
    expect(e.requisitionId).toBe("2389186");
    expect(e.recovery).toMatchObject({ status: "scored", source: "serper", match: { level: "exact" } });
    expect(state.usage.jobKeys).toEqual(["uhg::ase"]);
  });

  it("stores a low-confidence Serper result as unverified with no fit", async () => {
    addApp({ key: "acme::be", company: "Acme", role: "Backend Engineer", appliedDay: 22 });
    const hit = "https://jobs.lever.co/acme/xyz-1";
    state.serperResults.set('"Acme" "Backend Engineer" job', [{ title: "Acme", link: hit }]);
    addPosting(hit, { source: "lever", company: "Acme", title: "Backend Engineer" });

    await runRecovery(30, 5);

    const e = state.evaluations.get("acme::be")!;
    expect(e.recovery.status).toBe("unverified");
    expect(e.recovery.url).toBe(hit);
    expect(e.fit).toBeUndefined();
    expect(triageJob).not.toHaveBeenCalled();
    expect(vi.mocked(serperClient.search).mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("caps Serper at the 10 most recent jobs that need it, across runs, without double-counting", async () => {
    for (let i = 1; i <= 12; i += 1) {
      addApp({ key: `co${i}::se`, company: `Company${i}`, role: "Software Engineer", appliedDay: i });
    }

    await runRecovery(30, 50);

    const capped = [...state.evaluations.values()].filter((e) => e.recovery.reason === "serper_cap_reached");
    expect(capped.map((e) => e.key).sort()).toEqual(["co1::se", "co2::se"]);
    expect(state.usage.jobKeys).toHaveLength(10);
    expect(state.usage.jobKeys).not.toContain("co1::se");

    const usage = await serperUsageRepository.get();
    await recoverApplication(state.apps.find((a) => a.key === "co12::se")!, usage);
    expect(state.usage.jobKeys).toHaveLength(10);

    const blocked = await recoverApplication(state.apps.find((a) => a.key === "co1::se")!, await serperUsageRepository.get());
    expect(blocked.evaluation.recovery).toMatchObject({ status: "not_found", reason: "serper_cap_reached" });
  });

  it("records not_found without Serper when no key is configured", async () => {
    vi.mocked(serperClient.isConfigured).mockReturnValue(false);
    addApp({ key: "acme::se", company: "Acme", role: "Software Engineer", appliedDay: 10 });
    await runRecovery(30, 5);
    expect(state.evaluations.get("acme::se")!.recovery).toMatchObject({
      status: "not_found",
      reason: "serper_not_configured",
    });
    expect(serperClient.search).not.toHaveBeenCalled();
  });

  it("refreshes the outcome without re-scoring", async () => {
    const url = "https://boards.greenhouse.io/acme/jobs/1";
    const app = addApp({ key: "acme::se", company: "Acme", role: "Software Engineer", appliedDay: 10, links: [url] });
    addPosting(url, { company: "Acme", title: "Software Engineer" });
    await runRecovery(30, 5);
    expect(triageJob).toHaveBeenCalledTimes(1);

    app.status = "rejected";
    app.lastUpdateAt = day(15);
    app.emails.unshift({ id: "r", subject: "", from: "", date: day(15), eventType: "rejected", gmailUrl: "" });
    await runRecovery(30, 5);

    expect(triageJob).toHaveBeenCalledTimes(1);
    expect(evaluationsRepository.updateOutcome).toHaveBeenCalledTimes(1);
    const e = state.evaluations.get("acme::se")!;
    expect(e.outcome.status).toBe("rejected");
    expect(e.outcome.history.map((h) => h.status)).toEqual(["applied", "rejected"]);
    expect(e.outcomeAtScoring).toBe("applied");
    expect(e.fit?.total).toBe(78);
  });

  it("processes newest applications first and respects the per-run triage cap", async () => {
    for (const d of [5, 25, 15]) {
      const url = `https://boards.greenhouse.io/co${d}/jobs/${d}000`;
      addApp({ key: `co${d}::se`, company: `Company${d}`, role: "Software Engineer", appliedDay: d, links: [url] });
      addPosting(url, { company: `Company${d}`, title: "Software Engineer" });
    }

    const r = await runRecovery(30, 2);

    expect(r).toEqual({ processed: 2, scored: 2 });
    expect([...state.evaluations.keys()].sort()).toEqual(["co15::se", "co25::se"]);
  });

  it("summarizes mean fit by outcome from scored rows only", () => {
    const base = { recovery: { attempts: [], serperQueries: 0 } } as unknown as ApplicationEvaluation;
    const mk = (status: "scored" | "unverified", outcome: "rejected" | "interviewing", total?: number) =>
      ({
        ...base,
        recovery: { ...base.recovery, status },
        fit: total === undefined ? undefined : { total },
        outcome: { status: outcome, updatedAt: "", history: [] },
      }) as unknown as ApplicationEvaluation;
    const s = buildRubricSummary([mk("scored", "rejected", 60), mk("scored", "rejected", 70), mk("scored", "interviewing", 85), mk("unverified", "rejected")]);
    expect(s.rows.find((r) => r.outcome === "rejected")).toEqual({ outcome: "rejected", count: 2, meanFit: 65 });
    expect(s.rows.find((r) => r.outcome === "interviewing")?.meanFit).toBe(85);
    expect(s.byRecoveryStatus).toMatchObject({ scored: 3, unverified: 1 });
  });
});

describe("Serper helpers", () => {
  it("builds at most two queries, req ID first", () => {
    expect(buildSerperQueries("UnitedHealth Group", "Associate Software Engineer", "2389186")).toEqual([
      '"UnitedHealth Group" "2389186"',
      '"UnitedHealth Group" "Associate Software Engineer" 2389186',
    ]);
    expect(buildSerperQueries("Acme", null)).toEqual([]);
  });

  it("ranks ATS links first and drops aggregators", () => {
    expect(
      rankSerperResults([
        { title: "", link: "https://www.glassdoor.com/job/123" },
        { title: "", link: "https://acme.com/about" },
        { title: "", link: "https://jobs.lever.co/acme/1" },
      ]),
    ).toEqual(["https://jobs.lever.co/acme/1", "https://acme.com/about"]);
  });
});
