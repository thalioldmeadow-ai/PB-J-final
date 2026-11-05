/**
 * Server-side Supabase Auth adapter.
 *
 * The browser never receives Supabase access or refresh tokens. They live in an
 * AES-GCM encrypted, HttpOnly, SameSite=Strict cookie. The encryption key is
 * derived from the server-only service-role key, so a stolen cookie file or a
 * copied cookie cannot be turned into a session without the server secret.
 *
 * Supabase is the identity provider. `public.profiles`, `public.wallets` and
 * `public.subscriptions` are created by the existing database trigger/RPC; the
 * server calls the idempotent RPC as a safety net after registration, login and
 * email verification. The browser never supplies a user id, plan, balance or
 * period.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { Request, Response as ExpressResponse } from "express";

const SESSION_COOKIE = "serene_session";
const RESET_COOKIE = "serene_reset";
const SESSION_DAYS = 30;
const RESET_SECONDS = 15 * 60;
const REVOCATION_FILE = path.join(process.cwd(), "data", "supabase-sessions.json");
const REFRESH_WINDOW_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SupabaseAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "SupabaseAuthError";
  }
}

export interface SupabaseAccountWallet {
  plan: string;
  balance: number;
  allocated: number;
  periodCreditsUsed: number;
  periodStart: string;
  periodEnd: string;
  subscriptionStatus: string;
}

export interface SupabaseAccountSubscription {
  plan: string;
  status: string;
  environment: string;
  purchasedAt: string | null;
  expiresAt: string | null;
}

export interface SupabaseAccount {
  profile: {
    id: string;
    displayName: string;
    createdAt: string;
    updatedAt: string;
  };
  subscription: SupabaseAccountSubscription | null;
  wallet: SupabaseAccountWallet | null;
}

export interface SupabaseUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  emailVerified: boolean;
  account?: SupabaseAccount;
}

export interface SupabaseTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface SupabaseSession {
  tokens: SupabaseTokens;
  user: SupabaseUser;
}

interface SupabaseRawUser {
  id?: unknown;
  email?: unknown;
  email_confirmed_at?: unknown;
  confirmed_at?: unknown;
  created_at?: unknown;
  user_metadata?: unknown;
}

interface SupabaseRawSession {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  user?: unknown;
  session?: unknown;
}

interface SessionCookiePayload {
  v: 1;
  kind: "session";
  sessionId: string;
  issuedAt: number;
  userId: string;
  email: string;
  name: string;
  createdAt: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

interface RevocationStore {
  version: 1;
  sessions: Record<string, number>;
  users: Record<string, number>;
}

interface ResetCookiePayload {
  v: 1;
  kind: "reset";
  userId: string;
  email: string;
  accessToken: string;
  expiresAt: string;
}

type SealedPayload = SessionCookiePayload | ResetCookiePayload;

const env = (name: string): string => (process.env[name] || "").trim();

const validConfiguredValue = (value: string): boolean =>
  Boolean(value) && !value.includes("YOUR_") && !value.includes("YOUR-");

export const supabaseAuthConfigured = (): boolean =>
  env("SUPABASE_AUTH_ENABLED").toLowerCase() === "true" &&
  validConfiguredValue(env("SUPABASE_URL")) &&
  validConfiguredValue(env("SUPABASE_ANON_KEY")) &&
  validConfiguredValue(env("SUPABASE_SERVICE_ROLE_KEY"));

const baseUrl = (): string => env("SUPABASE_URL").replace(/\/+$/, "");

const appOrigin = (req?: Request): string => {
  const configured = env("APP_ORIGIN").replace(/\/+$/, "");
  if (/^https?:\/\/[^/]+$/i.test(configured)) return configured;
  if (!req) return "";
  const forwarded = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwarded || req.protocol || "http";
  const host = req.get("host") || "localhost";
  return `${proto}://${host}`.replace(/\/+$/, "");
};

export const supabaseCallbackUrl = (req: Request): string =>
  `${appOrigin(req)}/api/auth/callback`;

const requestHeaders = (service: boolean): Record<string, string> => ({
  apikey: service ? env("SUPABASE_SERVICE_ROLE_KEY") : env("SUPABASE_ANON_KEY"),
  Authorization: `Bearer ${service ? env("SUPABASE_SERVICE_ROLE_KEY") : env("SUPABASE_ANON_KEY")}`,
  "Content-Type": "application/json",
});

const safeCode = (body: any, fallback: string): string => {
  const value = body?.error_code || body?.code || body?.error || body?.msg;
  return typeof value === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(value) ? value : fallback;
};

const upstreamMessage = (body: any): string =>
  String(body?.error_description || body?.message || body?.msg || body?.error || "");

const call = async (
  path: string,
  init: RequestInit,
  service = false,
): Promise<{ status: number; body: any }> => {
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { ...requestHeaders(service), ...(init.headers || {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SupabaseAuthError(
      "The account service is not available right now. Try again shortly.",
      503,
      "auth_service_unavailable",
    );
  }

  const text = await response.text();
  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, body };
};

const authError = (status: number, body: any, fallback: string, code: string): SupabaseAuthError => {
  const message = upstreamMessage(body).toLowerCase();
  if (status === 429) {
    return new SupabaseAuthError("Too many attempts. Try again later.", 429, "rate_limited");
  }
  if (message.includes("email not confirmed") || message.includes("email_not_confirmed")) {
    return new SupabaseAuthError(
      "Verify your email before signing in. Check your inbox for the confirmation link.",
      403,
      "email_verification_required",
    );
  }
  if (message.includes("already confirmed") || message.includes("already been confirmed")) {
    return new SupabaseAuthError(
      "This email is already verified. Sign in with your account password.",
      409,
      "already_verified",
    );
  }
  if (message.includes("invalid login") || message.includes("invalid credentials")) {
    return new SupabaseAuthError("Email or password is incorrect.", 401, "invalid_credentials");
  }
  if (message.includes("already registered") || message.includes("already been registered")) {
    return new SupabaseAuthError(
      "If this email can be used, check your inbox for a verification link.",
      409,
      "email_in_use",
    );
  }
  if (message.includes("password") && (status === 400 || status === 422)) {
    return new SupabaseAuthError(
      "Use a password of at least 8 characters.",
      400,
      "weak_password",
    );
  }
  if (message.includes("expired") || message.includes("invalid") || status === 401 || status === 410) {
    return new SupabaseAuthError(
      "That link is invalid or has expired. Request a new one.",
      401,
      "link_invalid_or_expired",
    );
  }
  return new SupabaseAuthError(fallback, status >= 500 ? 503 : 400, code);
};

const rawUser = (value: unknown): SupabaseRawUser | null =>
  value && typeof value === "object" ? (value as SupabaseRawUser) : null;

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

const emailOf = (user: SupabaseRawUser): string =>
  typeof user.email === "string" ? user.email.trim().toLowerCase() : "";

const metadataOf = (user: SupabaseRawUser): Record<string, unknown> =>
  user.user_metadata && typeof user.user_metadata === "object"
    ? (user.user_metadata as Record<string, unknown>)
    : {};

const isVerified = (user: SupabaseRawUser): boolean =>
  Boolean(user.email_confirmed_at || user.confirmed_at);

const displayNameOf = (user: SupabaseRawUser): string => {
  const value = metadataOf(user).display_name;
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 80);
  const email = emailOf(user);
  return (email.split("@")[0] || "Member").slice(0, 80);
};

const createdAtOf = (user: SupabaseRawUser): string => {
  if (typeof user.created_at === "string" && user.created_at) return user.created_at;
  return new Date().toISOString();
};

const sessionFromRaw = (raw: SupabaseRawSession): { tokens: SupabaseTokens; rawUser: SupabaseRawUser } | null => {
  const nested = raw.session && typeof raw.session === "object" ? (raw.session as SupabaseRawSession) : raw;
  const accessToken = nested.access_token;
  const refreshToken = nested.refresh_token;
  const user = rawUser(nested.user || raw.user);
  if (typeof accessToken !== "string" || !accessToken || typeof refreshToken !== "string" || !refreshToken) {
    return null;
  }
  let expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const expiresIn = Number(nested.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  } else {
    try {
      const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] || "", "base64url").toString("utf8"));
      if (Number.isFinite(Number(payload?.exp))) {
        expiresAt = new Date(Number(payload.exp) * 1000).toISOString();
      }
    } catch {
      // Keep the one-hour fallback.
    }
  }
  return {
    tokens: { accessToken, refreshToken, expiresAt },
    rawUser: user || {},
  };
};

const userFromRaw = async (
  raw: SupabaseRawUser,
  account?: SupabaseAccount,
): Promise<SupabaseUser> => {
  if (!isUuid(raw.id)) {
    throw new SupabaseAuthError("The account service returned an invalid user.", 502, "auth_bad_response");
  }
  const email = emailOf(raw);
  if (!EMAIL_PATTERN.test(email)) {
    throw new SupabaseAuthError("The account service returned an invalid user.", 502, "auth_bad_response");
  }
  return {
    id: raw.id,
    email,
    name: account?.profile.displayName || displayNameOf(raw),
    createdAt: account?.profile.createdAt || createdAtOf(raw),
    emailVerified: isVerified(raw),
    ...(account ? { account } : {}),
  };
};

const serviceRequest = async (path: string, init: RequestInit = {}) =>
  call(path, init, true);

const rpc = async (name: string, body: Record<string, unknown>): Promise<void> => {
  const response = await serviceRequest(`/rest/v1/rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { Prefer: "return=representation" },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new SupabaseAuthError(
      "Your account could not be prepared. Try again shortly.",
      503,
      "account_setup_unavailable",
    );
  }
};

const select = async (path: string): Promise<any[]> => {
  const response = await serviceRequest(path);
  if (response.status < 200 || response.status >= 300 || !Array.isArray(response.body)) {
    throw new SupabaseAuthError(
      "Your account could not be loaded. Try again shortly.",
      503,
      "account_unavailable",
    );
  }
  return response.body;
};

const numberValue = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const ensureSupabaseAccount = async (user: SupabaseRawUser): Promise<SupabaseAccount> => {
  if (!isUuid(user.id)) {
    throw new SupabaseAuthError("The account service returned an invalid user.", 502, "auth_bad_response");
  }
  const name = displayNameOf(user);
  await rpc("create_profile_and_wallet", {
    p_user_id: user.id,
    p_display_name: name,
    p_age_band: null,
  });

  const id = encodeURIComponent(user.id);
  const [profiles, subscriptions, wallets] = await Promise.all([
    select(`/rest/v1/profiles?id=eq.${id}&select=id,display_name,created_at,updated_at`),
    select(
      `/rest/v1/subscriptions?user_id=eq.${id}&select=plan,status,environment,purchased_at,expires_at`,
    ),
    select(
      `/rest/v1/wallets?user_id=eq.${id}&select=plan,balance,allocated,period_credits_used,period_start,period_end,subscription_status`,
    ),
  ]);

  const profile = profiles[0];
  if (!profile || !isUuid(profile.id)) {
    throw new SupabaseAuthError(
      "Your profile could not be created. Try again shortly.",
      503,
      "profile_creation_failed",
    );
  }

  const wallet = wallets[0];
  const subscription = subscriptions[0];
  return {
    profile: {
      id: profile.id,
      displayName: String(profile.display_name || name).slice(0, 80),
      createdAt: String(profile.created_at || new Date().toISOString()),
      updatedAt: String(profile.updated_at || new Date().toISOString()),
    },
    subscription: subscription
      ? {
          plan: String(subscription.plan || "free"),
          status: String(subscription.status || "active"),
          environment: String(subscription.environment || "SANDBOX"),
          purchasedAt: subscription.purchased_at ? String(subscription.purchased_at) : null,
          expiresAt: subscription.expires_at ? String(subscription.expires_at) : null,
        }
      : null,
    wallet: wallet
      ? {
          plan: String(wallet.plan || "free"),
          balance: numberValue(wallet.balance),
          allocated: numberValue(wallet.allocated),
          periodCreditsUsed: numberValue(wallet.period_credits_used),
          periodStart: String(wallet.period_start || ""),
          periodEnd: String(wallet.period_end || ""),
          subscriptionStatus: String(wallet.subscription_status || "active"),
        }
      : null,
  };
};

const userWithAccount = async (raw: SupabaseRawUser): Promise<SupabaseUser> => {
  const account = await ensureSupabaseAccount(raw);
  return userFromRaw(raw, account);
};

const userForSession = async (
  tokens: SupabaseTokens,
  raw?: SupabaseRawUser,
): Promise<SupabaseUser> => {
  if (raw && isUuid(raw.id)) {
    if (!isVerified(raw)) {
      throw new SupabaseAuthError(
        "Verify your email before signing in. Check your inbox for the confirmation link.",
        403,
        "email_verification_required",
      );
    }
    return userWithAccount(raw);
  }

  const response = await call("/auth/v1/user", {
    method: "GET",
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (response.status < 200 || response.status >= 300 || !rawUser(response.body)) {
    throw new SupabaseAuthError("Your session is no longer valid. Sign in again.", 401, "auth_required");
  }
  const user = rawUser(response.body)!;
  if (!isVerified(user)) {
    throw new SupabaseAuthError(
      "Verify your email before signing in. Check your inbox for the confirmation link.",
      403,
      "email_verification_required",
    );
  }
  return userWithAccount(user);
};

const refreshTokens = async (refreshToken: string): Promise<{ tokens: SupabaseTokens; user: SupabaseUser }> => {
  const response = await call("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (response.status < 200 || response.status >= 300) {
    throw authError(response.status, response.body, "Your session has expired. Sign in again.", "session_expired");
  }
  const parsed = sessionFromRaw(response.body || {});
  if (!parsed) {
    throw new SupabaseAuthError("Your session has expired. Sign in again.", 401, "session_expired");
  }
  const user = await userForSession(parsed.tokens, parsed.rawUser);
  return { tokens: parsed.tokens, user };
};

const cookieValue = (req: Request, name: string): string | undefined => {
  const cookie = req.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    const value = rest.join("=").trim();
    if (value) return value;
  }
  return undefined;
};

const seal = (payload: SealedPayload): string => {
  const secret = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new SupabaseAuthError("Account sessions are not configured.", 503, "auth_not_configured");
  const key = createHash("sha256").update(`serene-supabase-session-v1:${secret}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `s1.${Buffer.concat([iv, tag, encrypted]).toString("base64url")}`;
};

const open = (value: string | undefined): SealedPayload | null => {
  if (!value || !value.startsWith("s1.")) return null;
  try {
    const secret = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!secret) return null;
    const key = createHash("sha256").update(`serene-supabase-session-v1:${secret}`).digest();
    const raw = Buffer.from(value.slice(3), "base64url");
    if (raw.length < 30) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const payload = JSON.parse(plain) as SealedPayload;
    if (payload?.v !== 1 || !("kind" in payload)) return null;
    if (payload.kind === "session") {
      if (
        typeof payload.sessionId !== "string" ||
        !/^[a-f0-9-]{36}$/i.test(payload.sessionId) ||
        !Number.isFinite(Number(payload.issuedAt)) ||
        !isUuid(payload.userId) ||
        typeof payload.email !== "string" ||
        typeof payload.name !== "string" ||
        typeof payload.accessToken !== "string" ||
        typeof payload.refreshToken !== "string" ||
        typeof payload.expiresAt !== "string"
      ) {
        return null;
      }
    } else if (
      payload.kind !== "reset" ||
      !isUuid(payload.userId) ||
      typeof payload.accessToken !== "string" ||
      typeof payload.expiresAt !== "string"
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

const secureCookie = (): string => {
  const origin = appOrigin();
  return process.env.NODE_ENV === "production" || /^https:\/\//i.test(origin) ? "; Secure" : "";
};

const serializeCookie = (name: string, value: string, maxAge: number): string =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie()}`;

const sessionPayload = (tokens: SupabaseTokens, user: SupabaseUser): SessionCookiePayload => ({
  v: 1,
  kind: "session",
  sessionId: randomUUID(),
  issuedAt: Date.now(),
  userId: user.id,
  email: user.email,
  name: user.name,
  createdAt: user.createdAt,
  accessToken: tokens.accessToken,
  refreshToken: tokens.refreshToken,
  expiresAt: tokens.expiresAt,
});

let revocationCache: RevocationStore | null = null;

const freshRevocations = (): RevocationStore => ({
  version: 1,
  sessions: {},
  users: {},
});

const readRevocations = (): RevocationStore => {
  if (revocationCache) return revocationCache;
  try {
    const raw = JSON.parse(fs.readFileSync(REVOCATION_FILE, "utf8")) as Partial<RevocationStore>;
    revocationCache = {
      version: 1,
      sessions:
        raw.sessions && typeof raw.sessions === "object"
          ? Object.fromEntries(
              Object.entries(raw.sessions).filter(
                ([key, value]) => /^[a-f0-9-]{36}$/i.test(key) && Number.isFinite(Number(value)),
              ),
            )
          : {},
      users:
        raw.users && typeof raw.users === "object"
          ? Object.fromEntries(
              Object.entries(raw.users).filter(
                ([key, value]) => isUuid(key) && Number.isFinite(Number(value)),
              ),
            )
          : {},
    };
  } catch {
    revocationCache = freshRevocations();
  }
  return revocationCache;
};

const writeRevocations = (store: RevocationStore): void => {
  const now = Date.now();
  for (const [key, expires] of Object.entries(store.sessions)) {
    if (Number(expires) <= now) delete store.sessions[key];
  }
  try {
    fs.mkdirSync(path.dirname(REVOCATION_FILE), { recursive: true });
    const temp = `${REVOCATION_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(store), { mode: 0o600 });
    fs.renameSync(temp, REVOCATION_FILE);
  } catch {
    // The in-memory record still rejects the cookie for this process lifetime.
  }
};

const sessionIsRevoked = (payload: SessionCookiePayload): boolean => {
  const store = readRevocations();
  const expires = Number(store.sessions[payload.sessionId] || 0);
  if (expires > Date.now()) return true;
  const userCutoff = Number(store.users[payload.userId] || 0);
  return Number(payload.issuedAt) <= userCutoff;
};

export const revokeSupabaseSession = (req: Request): void => {
  const payload = open(cookieValue(req, SESSION_COOKIE));
  if (!payload || payload.kind !== "session") return;
  const store = readRevocations();
  store.sessions[payload.sessionId] = Date.parse(payload.expiresAt) || Date.now() + 3_600_000;
  writeRevocations(store);
};

const revokeSupabaseUser = (userId: string, cutoff = Date.now()): void => {
  const store = readRevocations();
  store.users[userId] = Math.max(Number(store.users[userId] || 0), cutoff);
  writeRevocations(store);
};

export const setSupabaseSessionCookie = (res: ExpressResponse, session: SupabaseSession): void => {
  const payload = sessionPayload(session.tokens, session.user);
  res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, seal(payload), SESSION_DAYS * 86_400));
};

export const setSupabaseResetCookie = (
  res: ExpressResponse,
  tokens: SupabaseTokens,
  user: SupabaseUser,
): void => {
  const payload: ResetCookiePayload = {
    v: 1,
    kind: "reset",
    userId: user.id,
    email: user.email,
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt,
  };
  res.setHeader("Set-Cookie", serializeCookie(RESET_COOKIE, seal(payload), RESET_SECONDS));
};

export const clearSupabaseCookies = (res: ExpressResponse): void => {
  res.setHeader("Set-Cookie", [
    serializeCookie(SESSION_COOKIE, "", 0),
    serializeCookie(RESET_COOKIE, "", 0),
  ]);
};

const storeSessionCookie = (res: ExpressResponse, tokens: SupabaseTokens, user: SupabaseUser): void => {
  res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, seal(sessionPayload(tokens, user)), SESSION_DAYS * 86_400));
};

export const resolveSupabaseSession = async (
  req: Request,
  res: ExpressResponse,
): Promise<SupabaseUser | null> => {
  if (!supabaseAuthConfigured()) return null;
  const payload = open(cookieValue(req, SESSION_COOKIE));
  if (!payload || payload.kind !== "session") return null;
  if (sessionIsRevoked(payload)) {
    clearSupabaseCookies(res);
    return null;
  }

  let tokens: SupabaseTokens = {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    expiresAt: payload.expiresAt,
  };
  let user: SupabaseUser = {
    id: payload.userId,
    email: payload.email,
    name: payload.name,
    createdAt: payload.createdAt,
    emailVerified: true,
  };

  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt - Date.now() <= REFRESH_WINDOW_MS) {
    try {
      const refreshed = await refreshTokens(payload.refreshToken);
      tokens = refreshed.tokens;
      user = refreshed.user;
      payload.accessToken = tokens.accessToken;
      payload.refreshToken = tokens.refreshToken;
      payload.expiresAt = tokens.expiresAt;
      res.setHeader(
        "Set-Cookie",
        serializeCookie(SESSION_COOKIE, seal(payload), SESSION_DAYS * 86_400),
      );
    } catch {
      clearSupabaseCookies(res);
      return null;
    }
  }
  return user;
};

const resetPayloadFromRequest = (req: Request): ResetCookiePayload | null => {
  const payload = open(cookieValue(req, RESET_COOKIE));
  return payload && payload.kind === "reset" ? payload : null;
};

export const registerSupabaseUser = async (input: {
  name: string;
  email: string;
  password: string;
  redirectTo: string;
}): Promise<{ verificationRequired: true; email: string } | SupabaseSession> => {
  const response = await call(
    `/auth/v1/signup?redirect_to=${encodeURIComponent(input.redirectTo)}`,
    {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        data: { display_name: input.name },
      }),
    },
  );

  if (response.status === 429) {
    throw new SupabaseAuthError("Too many attempts. Try again later.", 429, "rate_limited");
  }
  if (response.status === 422 || response.status === 409) {
    const message = upstreamMessage(response.body).toLowerCase();
    if (message.includes("already") || message.includes("registered")) {
      return { verificationRequired: true, email: input.email };
    }
    throw authError(
      response.status,
      response.body,
      "The account could not be created. Try again shortly.",
      "registration_failed",
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw authError(
      response.status,
      response.body,
      "The account could not be created. Try again shortly.",
      "registration_failed",
    );
  }

  const raw = rawUser(response.body?.user) || rawUser(response.body);
  if (!raw || !isUuid(raw.id)) {
    return { verificationRequired: true, email: input.email };
  }

  await ensureSupabaseAccount(raw);
  const parsed = sessionFromRaw(response.body || {});
  if (!parsed || !isVerified(raw)) {
    return { verificationRequired: true, email: input.email };
  }
  return {
    tokens: parsed.tokens,
    user: await userWithAccount(raw),
  };
};

export const loginSupabaseUser = async (input: {
  email: string;
  password: string;
}): Promise<SupabaseSession> => {
  const response = await call("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  if (response.status < 200 || response.status >= 300) {
    const message = upstreamMessage(response.body).toLowerCase();
    if (message.includes("email not confirmed") || message.includes("email_not_confirmed")) {
      throw new SupabaseAuthError(
        "Verify your email before signing in. Check your inbox for the confirmation link.",
        403,
        "email_verification_required",
      );
    }
    throw new SupabaseAuthError("Email or password is incorrect.", 401, "invalid_credentials");
  }
  const parsed = sessionFromRaw(response.body || {});
  if (!parsed) {
    throw new SupabaseAuthError("Email or password is incorrect.", 401, "invalid_credentials");
  }
  const user = await userForSession(parsed.tokens, parsed.rawUser);
  return { tokens: parsed.tokens, user };
};

export const verifySupabaseTokenHash = async (input: {
  tokenHash: string;
  type: string;
  redirectTo: string;
}): Promise<SupabaseSession> => {
  const response = await call(
    `/auth/v1/verify?redirect_to=${encodeURIComponent(input.redirectTo)}`,
    {
      method: "POST",
      body: JSON.stringify({ token_hash: input.tokenHash, type: input.type }),
    },
  );
  if (response.status < 200 || response.status >= 300) {
    throw authError(
      response.status,
      response.body,
      "That verification link is invalid or has expired.",
      "verification_failed",
    );
  }
  const parsed = sessionFromRaw(response.body || {});
  if (!parsed) {
    throw new SupabaseAuthError(
      "That verification link is invalid or has expired.",
      401,
      "verification_failed",
    );
  }
  const user = await userForSession(parsed.tokens, parsed.rawUser);
  return { tokens: parsed.tokens, user };
};

export const resendSupabaseVerification = async (input: {
  email: string;
  redirectTo: string;
}): Promise<void> => {
  const response = await call(
    `/auth/v1/resend?redirect_to=${encodeURIComponent(input.redirectTo)}`,
    {
      method: "POST",
      body: JSON.stringify({ type: "signup", email: input.email }),
    },
  );
  if (response.status === 429) {
    throw new SupabaseAuthError("Too many attempts. Try again later.", 429, "rate_limited");
  }
  if (response.status >= 500) {
    throw new SupabaseAuthError(
      "The email service is not available right now. Try again shortly.",
      503,
      "email_unavailable",
    );
  }
  // A missing account is intentionally indistinguishable from a sent email.
};

export const requestSupabasePasswordReset = async (input: {
  email: string;
  redirectTo: string;
}): Promise<void> => {
  const response = await call(
    `/auth/v1/recover?redirect_to=${encodeURIComponent(input.redirectTo)}`,
    {
      method: "POST",
      body: JSON.stringify({ email: input.email }),
    },
  );
  if (response.status >= 500) {
    throw new SupabaseAuthError(
      "The email service is not available right now. Try again shortly.",
      503,
      "email_unavailable",
    );
  }
  // Always return the same result, whether or not the address has an account.
};

export const resetSupabasePassword = async (req: Request, newPassword: string): Promise<void> => {
  const payload = resetPayloadFromRequest(req);
  if (!payload) {
    throw new SupabaseAuthError("That reset link is invalid or has expired.", 401, "reset_link_invalid");
  }
  const response = await call("/auth/v1/user", {
    method: "PUT",
    headers: { Authorization: `Bearer ${payload.accessToken}` },
    body: JSON.stringify({ password: newPassword }),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new SupabaseAuthError(
      "That reset link is invalid or has expired.",
      401,
      "reset_link_invalid",
    );
  }
  revokeSupabaseUser(payload.userId);
  await logoutSupabase(payload.accessToken, true);
};

export const logoutSupabase = async (accessToken: string, global = false): Promise<void> => {
  try {
    await call(`/auth/v1/logout?scope=${global ? "global" : "local"}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Clearing the local cookie is still correct when Supabase is unreachable.
  }
};

export const supabaseSessionAccessToken = (req: Request): string | null => {
  const payload = open(cookieValue(req, SESSION_COOKIE));
  return payload?.kind === "session" ? payload.accessToken : null;
};

export const renameSupabaseAccount = async (userId: string, name: string): Promise<void> => {
  if (!isUuid(userId)) {
    throw new SupabaseAuthError("Account not found.", 404, "account_not_found");
  }
  const response = await serviceRequest(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ display_name: name }),
    },
  );
  if (response.status < 200 || response.status >= 300) {
    throw new SupabaseAuthError(
      "Your name could not be saved. Try again shortly.",
      503,
      "profile_update_failed",
    );
  }
};

export const hasSupabaseResetCookie = (req: Request): boolean =>
  Boolean(resetPayloadFromRequest(req));

export const clearSupabaseResetCookie = (res: ExpressResponse): void => {
  res.setHeader("Set-Cookie", serializeCookie(RESET_COOKIE, "", 0));
};
