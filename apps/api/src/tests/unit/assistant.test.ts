import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantProposal } from "../../services/assistant/assistant.repository.js";

const proposals = new Map<string, AssistantProposal>();
const executeTrackerStatus = vi.fn(async () => {});
const executeEmailDraft = vi.fn(async (input: { to: string }) => ({ to: input.to, draftId: "d1", threadId: "t1" }));
const scoreListingNow = vi.fn(async () => ({ status: "stored" as const, topJobId: "tj1" }));

vi.mock("../../services/assistant/assistant.repository.js", () => ({
  assistantRepository: {
    getProposal: async (id: string) => proposals.get(id) ?? null,
    resolveProposal: async (id: string, status: AssistantProposal["status"]) => {
      const p = proposals.get(id);
      if (p?.status === "open") proposals.set(id, { ...p, status });
    },
  },
}));
vi.mock("../../services/proposals/execute.js", () => ({
  executeTrackerStatus,
  executeEmailDraft,
  replyTargetFor: vi.fn(),
  ProposalTargetError: class extends Error {},
  DraftsNotAllowedError: class extends Error {},
}));
vi.mock("../../services/topJobs/topJobsSync.js", () => ({
  scoreListingNow,
  listingWindowStart: () => "",
  prioritizePending: (x: unknown) => x,
}));

const { env } = await import("../../config/env.js");
const { runWithTools, MAX_TOOL_OUTPUT_CHARS } = await import("../../services/llm/responsesClient.js");
const { approveProposal, dismissProposal, sendAssistantMessage, ProposalNotFoundError } = await import(
  "../../services/assistant/assistant.js"
);
const { buildAssistantTools } = await import("../../services/assistant/tools.js");
import type { AssistantDeps } from "../../services/assistant/assistant.js";
import type { AssistantToolDeps } from "../../services/assistant/tools.js";
import type { JobRecord } from "../../types/job.js";

(env as { openAiApiKey: string }).openAiApiKey = "test-key";

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const toolCall = (name: string, args: unknown, id = "c1") =>
  jsonResponse({ output: [{ type: "function_call", name, arguments: JSON.stringify(args), call_id: id }] });
const answer = (text: string) =>
  jsonResponse({ output: [{ type: "message", content: [{ type: "output_text", text }] }] });

const job = (over: Partial<JobRecord> = {}) =>
  ({
    id: "j1",
    status: "applied",
    extracted: { company: "Acme", title: "Engineer" },
    score: { total: 80 },
    tracker: {},
    updatedAt: "2026-10-01T00:00:00Z",
    ...over,
  }) as unknown as JobRecord;

const toolDeps = (over: Partial<AssistantToolDeps> = {}): AssistantToolDeps => ({
  loadApps: async () => [],
  getEvaluation: async () => null,
  listTracker: async () => [job()],
  getJob: async (id) => (id === "j1" ? job() : null),
  listTopJobs: async () => [],
  listQueue: async () => [],
  getListing: async () => null,
  listNextSteps: async () => [],
  monthSpend: async () => ({ total: 0, byFeature: {} as never, budgets: {} }),
  saveProposal: async (p) => {
    proposals.set(p.id, p);
  },
  ...over,
});

const budget = (allowedUnits: number, exhausted = false) => ({
  monthlyUsd: 1.5,
  spentThisMonthUsd: exhausted ? 1.5 : 0.1,
  todayAllowanceUsd: allowedUnits * 0.01,
  allowedUnits,
  exhausted,
});

beforeEach(() => {
  proposals.clear();
  vi.clearAllMocks();
});

describe("runWithTools", () => {
  it("runs requested tools, feeds results back, and returns the final answer", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(toolCall("list_tracker", { status: "applied" }))
      .mockResolvedValueOnce(answer("You have 1 applied role."));
    const run = vi.fn(async () => ({ rows: 1 }));
    const result = await runWithTools(
      { systemPrompt: "s", messages: [{ role: "user", content: "hi" }], tools: [{ name: "list_tracker", description: "", parameters: {}, run }] },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toMatchObject({ success: true, text: "You have 1 applied role.", steps: 2 });
    expect(run).toHaveBeenCalledWith({ status: "applied" });
    const second = JSON.parse(fetchImpl.mock.calls[1]![1].body);
    expect(second.input.at(-1)).toEqual({ type: "function_call_output", call_id: "c1", output: '{"rows":1}' });
  });

  it("stops at the step cap and forbids tools on the last step", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: { body: string }) => toolCall("loop", {}));
    const result = await runWithTools(
      {
        systemPrompt: "s",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "loop", description: "", parameters: {}, run: async () => ({}) }],
        maxSteps: 3,
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchImpl.mock.calls[2]![1].body).tool_choice).toBe("none");
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body).tool_choice).toBe("auto");
    expect(result.success).toBe(false);
  });

  it("clips large tool results and reports tool errors to the model instead of throwing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          output: [
            { type: "function_call", name: "big", arguments: "{}", call_id: "a" },
            { type: "function_call", name: "boom", arguments: "{}", call_id: "b" },
          ],
        }),
      )
      .mockResolvedValueOnce(answer("ok"));
    await runWithTools(
      {
        systemPrompt: "s",
        messages: [{ role: "user", content: "hi" }],
        tools: [
          { name: "big", description: "", parameters: {}, run: async () => "x".repeat(MAX_TOOL_OUTPUT_CHARS * 2) },
          { name: "boom", description: "", parameters: {}, run: async () => { throw new Error("nope"); } },
        ],
      },
      fetchImpl as unknown as typeof fetch,
    );
    const input = JSON.parse(fetchImpl.mock.calls[1]![1].body).input as Array<{ call_id?: string; output?: string }>;
    expect(input.find((i) => i.call_id === "a" && i.output)!.output!.length).toBeLessThan(MAX_TOOL_OUTPUT_CHARS + 20);
    expect(input.find((i) => i.call_id === "b" && i.output)!.output).toContain("nope");
  });
});

describe("assistant budget", () => {
  const deps = (over: Partial<AssistantDeps> = {}): AssistantDeps => ({
    tools: toolDeps(),
    loadBudget: async () => budget(5),
    getMessages: async () => [],
    appendMessages: vi.fn(async () => {}),
    runLoop: vi.fn(async () => ({ success: true, text: "Hello", steps: 1, toolCalls: [] })),
    ...over,
  });

  it("refuses without calling the model when today's budget is used up", async () => {
    const d = deps({ loadBudget: async () => budget(0) });
    const reply = await sendAssistantMessage("status?", d);
    expect(d.runLoop).not.toHaveBeenCalled();
    expect(reply.messages[1]!.content).toMatch(/budget/);
  });

  it("sends only the recent history and stores both turns", async () => {
    const old = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      content: `m${i}`,
      at: "",
    }));
    const d = deps({ getMessages: async () => old });
    await sendAssistantMessage("next?", d);
    const sent = vi.mocked(d.runLoop).mock.calls[0]![0].messages;
    expect(sent).toHaveLength(13);
    expect(sent[0]!.content).toBe("m18");
    expect(d.appendMessages).toHaveBeenCalledWith([
      expect.objectContaining({ role: "user", content: "next?" }),
      expect.objectContaining({ role: "assistant", content: "Hello" }),
    ]);
  });
});

describe("assistant approvals", () => {
  it("propose tools only store a card; nothing runs until approve", async () => {
    const created: AssistantProposal[] = [];
    const tools = buildAssistantTools(toolDeps(), created);
    const propose = tools.find((t) => t.name === "propose_tracker_status")!;
    const out = (await propose.run({ jobId: "j1", status: "lapsed", note: "No reply in 30 days" })) as { proposalId: string };
    expect(executeTrackerStatus).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(proposals.get(out.proposalId)?.status).toBe("open");

    await approveProposal(out.proposalId);
    expect(executeTrackerStatus).toHaveBeenCalledWith("j1", "lapsed", "No reply in 30 days");
    expect(proposals.get(out.proposalId)?.status).toBe("approved");
    await expect(approveProposal(out.proposalId)).rejects.toBeInstanceOf(ProposalNotFoundError);
    expect(executeTrackerStatus).toHaveBeenCalledTimes(1);
  });

  it("rejects proposals for unknown jobs or unchanged status", async () => {
    const tools = buildAssistantTools(toolDeps(), []);
    const propose = tools.find((t) => t.name === "propose_tracker_status")!;
    expect(await propose.run({ jobId: "nope", status: "lapsed" })).toHaveProperty("error");
    expect(await propose.run({ jobId: "j1", status: "applied" })).toHaveProperty("error");
    expect(proposals.size).toBe(0);
  });

  it("email approval needs the confirmed recipient and text and only creates a draft", async () => {
    const app = { key: "acme|eng", company: "Acme", role: "Engineer", actionNeeded: { emailId: "m9" } } as never;
    const tools = buildAssistantTools(toolDeps({ loadApps: async () => [app] }), []);
    const out = (await tools.find((t) => t.name === "propose_email")!.run({
      appKey: "acme|eng",
      kind: "follow_up",
      body: "Hi there, checking in. Best,",
    })) as { proposalId: string };
    await expect(approveProposal(out.proposalId)).rejects.toThrow(/required/);
    await approveProposal(out.proposalId, { to: "jane@acme.com", body: "Edited text" });
    expect(executeEmailDraft).toHaveBeenCalledWith(
      expect.objectContaining({ appKey: "acme|eng", preferEmailId: "m9", to: "jane@acme.com", body: "Edited text", source: "assistant" }),
    );
  });

  it("dismissed proposals can't be approved later", async () => {
    const listing = { _id: "l1", company: "Beta", title: "Dev", status: "pending" } as never;
    const tools = buildAssistantTools(toolDeps({ getListing: async () => listing }), []);
    const out = (await tools.find((t) => t.name === "propose_score_listing")!.run({ listingKey: "l1" })) as { proposalId: string };
    await dismissProposal(out.proposalId);
    await expect(approveProposal(out.proposalId)).rejects.toBeInstanceOf(ProposalNotFoundError);
    expect(scoreListingNow).not.toHaveBeenCalled();
  });
});
