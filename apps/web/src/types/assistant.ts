import type { JobStatus } from "./job";

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  proposalIds?: string[];
  tools?: string[];
};

export type ProposalPayload =
  | { kind: "tracker_status"; jobId: string; company: string; title: string; fromStatus: JobStatus; status: JobStatus; note: string }
  | { kind: "email_draft"; appKey: string; company: string; role: string | null; emailKind: string; body: string }
  | { kind: "score_listing"; listingKey: string; company: string; title: string };

export type AssistantProposal = {
  id: string;
  title: string;
  payload: ProposalPayload;
  status: "open" | "approved" | "dismissed" | "failed";
  createdAt: string;
  resolvedAt?: string;
  result?: string;
};

export type AssistantThread = {
  messages: AssistantMessage[];
  proposals: AssistantProposal[];
  canCreateDrafts?: boolean;
  budget: { monthlyUsd: number; spentThisMonthUsd: number };
};

export type AssistantReply = { messages: AssistantMessage[]; proposals: AssistantProposal[] };
