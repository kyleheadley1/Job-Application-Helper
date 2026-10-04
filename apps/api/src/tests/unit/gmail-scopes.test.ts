import { describe, expect, it, vi } from "vitest";

vi.mock("../../config/env.js", async (orig) => {
  const actual = (await orig()) as { env: Record<string, unknown> };
  return { env: { ...actual.env, googleClientId: "client", googleClientSecret: "secret" } };
});

const { gmailAuth, extraScopes, parseScopes, GMAIL_DRAFTS_CREATE_SCOPE, GMAIL_READONLY_SCOPE } = await import(
  "../../services/gmail/gmailAuth.js"
);

describe("Gmail permissions", () => {
  it("asks for exactly read-only + drafts.create, without carrying forward older grants", () => {
    const url = new URL(gmailAuth.buildConsentUrl());
    expect(url.searchParams.get("scope")!.split(" ").sort()).toEqual(
      [GMAIL_READONLY_SCOPE, GMAIL_DRAFTS_CREATE_SCOPE].sort(),
    );
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("scope")).not.toMatch(/gmail\.(send|compose|modify)|mail\.google\.com/);
  });

  it("flags any granted scope beyond the two the app needs", () => {
    const granted = parseScopes(`${GMAIL_READONLY_SCOPE} ${GMAIL_DRAFTS_CREATE_SCOPE}`);
    expect(extraScopes(granted)).toEqual([]);
    expect(extraScopes([...granted, "https://www.googleapis.com/auth/gmail.modify"])).toEqual([
      "https://www.googleapis.com/auth/gmail.modify",
    ]);
  });

  it("only reports drafts as available when Google granted drafts.create", async () => {
    vi.spyOn(gmailAuth, "getAuthDoc").mockResolvedValueOnce({
      _id: "default",
      refreshToken: "r",
      connectedAt: "2026-10-04T00:00:00Z",
      grantedScopes: [GMAIL_READONLY_SCOPE],
    });
    expect((await gmailAuth.getStatus()).canCreateDrafts).toBe(false);
    vi.spyOn(gmailAuth, "getAuthDoc").mockResolvedValueOnce({
      _id: "default",
      refreshToken: "r",
      connectedAt: "2026-10-04T00:00:00Z",
      grantedScopes: [GMAIL_READONLY_SCOPE, GMAIL_DRAFTS_CREATE_SCOPE],
    });
    expect((await gmailAuth.getStatus()).canCreateDrafts).toBe(true);
  });
});
