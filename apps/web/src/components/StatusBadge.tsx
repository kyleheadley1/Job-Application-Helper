import type { JobStatus } from "../types/job";

const toneByStatus: Record<JobStatus, string> = {
  to_review: "neutral",
  applied: "neutral",
  skip: "bad",
  rejected: "bad",
  interviewing: "info",
  assessment: "info",
  closed: "bad",
  offer: "good",
};

export const StatusBadge = ({ status }: { status: JobStatus }) => (
  <span className={`pill ${toneByStatus[status]}`}>{status}</span>
);
