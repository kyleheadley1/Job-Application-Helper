import { randomBytes } from "node:crypto";
import { env } from "../../config/env.js";
import { getDb } from "../../config/mongo.js";
import { logger } from "../../lib/logger.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
/** Create new drafts only: cannot send, edit, or delete drafts. Sending stays in Gmail, by you. */
export const GMAIL_DRAFTS_CREATE_SCOPE = "https://www.googleapis.com/auth/gmail.drafts.create";
export const GMAIL_SCOPES = [GMAIL_READONLY_SCOPE, GMAIL_DRAFTS_CREATE_SCOPE] as const;

/** Granted scopes other than the two the app asks for (should always be empty). */
export const extraScopes = (granted: string[]): string[] =>
  granted.filter((s) => !(GMAIL_SCOPES as readonly string[]).includes(s));

const AUTH_DOC_ID = "default";
const STATE_TTL_MS = 10 * 60 * 1000;

export type GmailAuthDoc = {
  _id: string;
  refreshToken: string;
  email?: string;
  connectedAt: string;
  lastSyncAt?: string;
  needsReconnect?: boolean;
  /** Scopes Google reported on the last token exchange; absent on connections made before drafts. */
  grantedScopes?: string[];
};

export type GmailStatus = {
  configured: boolean;
  connected: boolean;
  email?: string;
  lastSyncAt?: string;
  needsReconnect?: boolean;
  canCreateDrafts: boolean;
  extraScopes?: string[];
};

/** Refresh token was revoked or expired (Testing-mode apps expire them after 7 days). */
export class GmailReconnectRequiredError extends Error {
  readonly code = "GMAIL_RECONNECT_REQUIRED" as const;
  constructor(message = "Gmail access expired or was revoked. Reconnect Gmail.") {
    super(message);
    this.name = "GmailReconnectRequiredError";
  }
}

export class GmailNotConnectedError extends Error {
  readonly code = "GMAIL_NOT_CONNECTED" as const;
  constructor() {
    super("Gmail is not connected.");
    this.name = "GmailNotConnectedError";
  }
}

export class GmailNotConfiguredError extends Error {
  readonly code = "GMAIL_NOT_CONFIGURED" as const;
  constructor() {
    super("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the root .env and restart the API.");
    this.name = "GmailNotConfiguredError";
  }
}

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  /** Space-separated scopes actually granted. */
  scope?: string;
  error?: string;
  error_description?: string;
};

export const parseScopes = (scope: string | undefined): string[] =>
  scope ? scope.split(/\s+/).filter(Boolean) : [];

export const isGmailConfigured = (): boolean =>
  Boolean(env.googleClientId && env.googleClientSecret);

class GmailAuthService {
  private readonly pendingStates = new Map<string, number>();
  private accessToken: { value: string; expiresAt: number } | null = null;

  private async collection() {
    const db = await getDb();
    return db.collection<GmailAuthDoc>("gmail_auth");
  }

  async getAuthDoc(): Promise<GmailAuthDoc | null> {
    const col = await this.collection();
    return col.findOne({ _id: AUTH_DOC_ID });
  }

  async getStatus(): Promise<GmailStatus> {
    const configured = isGmailConfigured();
    const doc = await this.getAuthDoc();
    const connected = Boolean(doc?.refreshToken) && !doc?.needsReconnect;
    const granted = doc?.grantedScopes ?? [];
    const extra = extraScopes(granted);
    return {
      configured,
      connected,
      email: doc?.email,
      lastSyncAt: doc?.lastSyncAt,
      needsReconnect: doc?.needsReconnect || undefined,
      canCreateDrafts: connected && granted.includes(GMAIL_DRAFTS_CREATE_SCOPE),
      ...(extra.length ? { extraScopes: extra } : {}),
    };
  }

  buildConsentUrl(): string {
    if (!isGmailConfigured()) throw new GmailNotConfiguredError();
    const now = Date.now();
    for (const [s, exp] of this.pendingStates) if (exp < now) this.pendingStates.delete(s);
    const state = randomBytes(16).toString("hex");
    this.pendingStates.set(state, now + STATE_TTL_MS);
    const params = new URLSearchParams({
      client_id: env.googleClientId!,
      redirect_uri: env.googleRedirectUri,
      response_type: "code",
      scope: GMAIL_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      // Incremental auth would carry forward any broader scope granted in the past.
      include_granted_scopes: "false",
      state,
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  consumeState(state: string | undefined): boolean {
    if (!state) return false;
    const exp = this.pendingStates.get(state);
    this.pendingStates.delete(state);
    return exp != null && exp >= Date.now();
  }

  private async postToken(params: Record<string, string>): Promise<TokenResponse> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.googleClientId!,
        client_secret: env.googleClientSecret!,
        ...params,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || body.error) {
      if (body.error === "invalid_grant") throw new GmailReconnectRequiredError();
      throw new Error(
        `Google token request failed (${response.status}): ${body.error_description ?? body.error ?? "unknown error"}`,
      );
    }
    return body;
  }

  /** Exchange the OAuth callback code, store the refresh token, and record the account email. */
  async handleCallback(code: string): Promise<GmailAuthDoc> {
    if (!isGmailConfigured()) throw new GmailNotConfiguredError();
    const tokens = await this.postToken({
      code,
      grant_type: "authorization_code",
      redirect_uri: env.googleRedirectUri,
    });
    const existing = await this.getAuthDoc();
    const refreshToken = tokens.refresh_token ?? existing?.refreshToken;
    if (!refreshToken || !tokens.access_token) {
      throw new Error("Google did not return a refresh token. Remove the app's access in your Google account and reconnect.");
    }
    this.accessToken = {
      value: tokens.access_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    };
    const email = await this.fetchProfileEmail(tokens.access_token).catch(() => undefined);
    const doc: GmailAuthDoc = {
      _id: AUTH_DOC_ID,
      refreshToken,
      email,
      connectedAt: new Date().toISOString(),
      lastSyncAt: existing?.lastSyncAt,
      grantedScopes: parseScopes(tokens.scope),
    };
    const col = await this.collection();
    await col.replaceOne({ _id: AUTH_DOC_ID }, doc, { upsert: true });
    logger.info("Gmail connected", { email, grantedScopes: doc.grantedScopes });
    return doc;
  }

  private async fetchProfileEmail(accessToken: string): Promise<string | undefined> {
    const response = await fetch(GMAIL_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { emailAddress?: string };
    return body.emailAddress;
  }

  /** Valid access token, refreshing when it is missing or about to expire. */
  async getAccessToken(): Promise<string> {
    if (!isGmailConfigured()) throw new GmailNotConfiguredError();
    if (this.accessToken && this.accessToken.expiresAt - 60_000 > Date.now()) {
      return this.accessToken.value;
    }
    const doc = await this.getAuthDoc();
    if (!doc?.refreshToken) throw new GmailNotConnectedError();
    if (doc.needsReconnect) throw new GmailReconnectRequiredError();
    try {
      const tokens = await this.postToken({
        refresh_token: doc.refreshToken,
        grant_type: "refresh_token",
      });
      this.accessToken = {
        value: tokens.access_token!,
        expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      };
      const granted = parseScopes(tokens.scope);
      if (granted.length && granted.sort().join(" ") !== [...(doc.grantedScopes ?? [])].sort().join(" ")) {
        const col = await this.collection();
        await col.updateOne({ _id: AUTH_DOC_ID }, { $set: { grantedScopes: granted } });
      }
      return this.accessToken.value;
    } catch (error) {
      if (error instanceof GmailReconnectRequiredError) await this.markNeedsReconnect();
      throw error;
    }
  }

  async markNeedsReconnect(): Promise<void> {
    this.accessToken = null;
    const col = await this.collection();
    await col.updateOne({ _id: AUTH_DOC_ID }, { $set: { needsReconnect: true } });
  }

  async recordSync(at: string): Promise<void> {
    const col = await this.collection();
    await col.updateOne({ _id: AUTH_DOC_ID }, { $set: { lastSyncAt: at } });
  }

  async disconnect(): Promise<void> {
    const doc = await this.getAuthDoc();
    this.accessToken = null;
    if (doc?.refreshToken) {
      await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(doc.refreshToken)}`, {
        method: "POST",
      }).catch((error: unknown) =>
        logger.warn("Gmail token revoke failed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    const col = await this.collection();
    await col.deleteOne({ _id: AUTH_DOC_ID });
  }
}

export const gmailAuth = new GmailAuthService();
