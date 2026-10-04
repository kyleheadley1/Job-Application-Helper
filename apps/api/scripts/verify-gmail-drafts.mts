#!/usr/bin/env tsx
/**
 * Live check of the Gmail permissions (read-only + drafts.create), after reconnecting Gmail.
 * 1. Creates a plain draft to yourself.
 * 2. Creates a reply draft, addressed to yourself, inside one of your recent sent threads.
 * 3. Tries to send that draft. This MUST fail with 403, proving the app cannot send.
 * Prints only ids and pass/fail, never email content. Delete the two "[Job App Helper test]" drafts afterwards.
 */
import { gmailAuth, GMAIL_DRAFTS_CREATE_SCOPE } from "../src/services/gmail/gmailAuth.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

const call = async (path: string, init?: RequestInit) => {
  const token = await gmailAuth.getAccessToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
};

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

const rawMessage = (headers: Record<string, string>, body: string) =>
  b64url(
    [
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      body,
    ].join("\r\n"),
  );

const main = async () => {
  const status = await gmailAuth.getStatus();
  console.log("granted drafts.create:", status.canCreateDrafts, "| extra scopes:", status.extraScopes ?? "none");
  if (!status.canCreateDrafts) {
    console.log(`Reconnect Gmail first so the app holds ${GMAIL_DRAFTS_CREATE_SCOPE}.`);
    process.exit(1);
  }
  const me = status.email!;

  const plain = await call("/drafts", {
    method: "POST",
    body: JSON.stringify({
      message: { raw: rawMessage({ To: me, Subject: "[Job App Helper test] plain draft" }, "Permission check. Safe to delete.") },
    }),
  });
  console.log("1. plain draft:", plain.status === 200 ? `PASS (draft ${String(plain.body.id)})` : `FAIL ${plain.status} ${JSON.stringify(plain.body.error ?? {})}`);

  const sent = await call("/messages?q=in:sent%20newer_than:60d&maxResults=1");
  const sentId = (sent.body.messages as Array<{ id: string; threadId: string }> | undefined)?.[0];
  let threadedDraftId: string | undefined;
  if (!sentId) {
    console.log("2. threaded reply draft: SKIPPED (no sent mail in the last 60 days)");
  } else {
    const msg = await call(`/messages/${sentId.id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject`);
    const headers = ((msg.body.payload as { headers?: Array<{ name: string; value: string }> })?.headers ?? []);
    const messageId = headers.find((h) => h.name.toLowerCase() === "message-id")?.value;
    const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
    const threaded = await call("/drafts", {
      method: "POST",
      body: JSON.stringify({
        message: {
          threadId: sentId.threadId,
          raw: rawMessage(
            {
              To: me,
              Subject: `[Job App Helper test] ${/^re:/i.test(subject) ? subject : `Re: ${subject}`}`,
              ...(messageId ? { "In-Reply-To": messageId, References: messageId } : {}),
            },
            "Threaded permission check. Safe to delete.",
          ),
        },
      }),
    });
    const draftThread = (threaded.body.message as { threadId?: string } | undefined)?.threadId;
    threadedDraftId = threaded.status === 200 ? String(threaded.body.id) : undefined;
    console.log(
      "2. threaded reply draft:",
      threaded.status !== 200
        ? `FAIL ${threaded.status} ${JSON.stringify(threaded.body.error ?? {})}`
        : draftThread === sentId.threadId
          ? `PASS (draft ${threadedDraftId} is in the original thread)`
          : `PARTIAL (draft created but Gmail put it in a new thread)`,
    );
  }

  const target = threadedDraftId ?? (plain.status === 200 ? String(plain.body.id) : undefined);
  if (!target) {
    console.log("3. send attempt: SKIPPED (no draft to try)");
  } else {
    const send = await call("/drafts/send", { method: "POST", body: JSON.stringify({ id: target }) });
    console.log(
      "3. send attempt:",
      send.status === 403 ? "PASS (Google refused: the app cannot send)" : `UNEXPECTED ${send.status} — tell me before using drafts`,
    );
  }
  console.log('Now delete the "[Job App Helper test]" drafts in Gmail.');
  process.exit(0);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
