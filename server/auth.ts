/**
 * Server-verified identity.
 *
 * When Supabase is configured, Supabase Auth is the identity provider and the
 * browser sends only its email and password to this server. The server sets an
 * encrypted, HttpOnly session cookie and never hands Supabase tokens to page
 * JavaScript. The existing local vault password remains separate: it still
 * derives the AES-GCM key on the device and is never sent here.
 *
 * The legacy JSON account path remains available only when Supabase is not
 * configured. It exists so the pre-migration app and its existing data keep
 * working during a staged rollout; it is not used once Supabase is configured.
 */

import express, { NextFunction, Request, Response } from "express";
import {
  createHash,
  randomBytes,
  scrypt,
  ScryptOptions,
  timingSafeEqual,
} from "crypto";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import {
  SupabaseAuthError,
  clearSupabaseCookies,
  hasSupabaseResetCookie,
  loginSupabaseUser,
  logoutSupabase,
  registerSupabaseUser,
  renameSupabaseAccount,
  requestSupabasePasswordReset,
  resendSupabaseVerification,
  resetSupabasePassword,
  resolveSupabaseSession,
  revokeSupabaseSession,
  setSupabaseResetCookie,
  setSupabaseSessionCookie,
  supabaseAuthConfigured,
  supabaseCallbackUrl,
  supabaseSessionAccessToken,
  verifySupabaseTokenHash,
  type SupabaseAccount,
} from "./supabaseAuth";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  emailVerified?: boolean;
  account?: SupabaseAccount;
}

interface StoredAccount extends AuthUser {
  authHash: string;
  updatedAt: string;
}

interface StoredSession {
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

interface AuthStore {
  version: 1;
  accounts: Record<string, StoredAccount>;
  sessions: Record<string, StoredSession>;
  updatedAt: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "auth.json");
const COOKIE_NAME = "serene_session";
const SESSION_DAYS = 30;
const MAX_ACCOUNTS = 10_000;
const MAX_SESSIONS = 10_000;
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SECRET_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-f0-9]{16,64}$/;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const SCRYPT_OPTIONS: ScryptOptions = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};

const nowIso = () => new Date().toISOString();
const normaliseEmail = (email: string) => email.trim().toLowerCase();

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const freshStore = (): AuthStore => ({
  version: 1,
  accounts: {},
  sessions: {},
  updatedAt: nowIso(),
});

const normaliseStore = (raw: unknown): AuthStore => {
  if (!raw || typeof raw !== "object") return freshStore();
  const source = raw as Partial<AuthStore>;
  const store = freshStore();

  for (const [id, value] of Object.entries(source.accounts || {})) {
    if (!ID_PATTERN.test(id) || !value || typeof value !== "object") continue;
    const account = value as Partial<StoredAccount>;
    if (typeof account.email !== "string" || !EMAIL_PATTERN.test(account.email)) continue;
    if (typeof account.authHash !== "string" || !account.authHash.includes(":")) continue;
    if (typeof account.name !== "string" || !account.name.trim()) continue;
    store.accounts[id] = {
      id,
      email: normaliseEmail(account.email),
      name: account.name.trim().slice(0, 80),
      authHash: account.authHash,
      createdAt:
        typeof account.createdAt === "string" && account.createdAt
          ? account.createdAt
          : nowIso(),
      updatedAt:
        typeof account.updatedAt === "string" && account.updatedAt
          ? account.updatedAt
          : nowIso(),
    };
  }

  const now = Date.now();
  for (const [key, value] of Object.entries(source.sessions || {})) {
    if (!TOKEN_PATTERN.test(key) || !value || typeof value !== "object") continue;
    const session = value as Partial<StoredSession>;
    if (typeof session.userId !== "string" || !store.accounts[session.userId]) continue;
    const expires = Date.parse(String(session.expiresAt));
    if (!Number.isFinite(expires) || expires <= now) continue;
    store.sessions[key] = {
      userId: session.userId,
      createdAt:
        typeof session.createdAt === "string" && session.createdAt
          ? session.createdAt
          : nowIso(),
      expiresAt: new Date(expires).toISOString(),
      lastSeenAt:
        typeof session.lastSeenAt === "string" && session.lastSeenAt
          ? session.lastSeenAt
          : nowIso(),
    };
  }

  store.updatedAt = typeof source.updatedAt === "string" ? source.updatedAt : nowIso();
  return store;
};

let cached: AuthStore | null = null;

const persist = (store: AuthStore): void => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(store), { mode: 0o600 });
    fs.renameSync(temp, FILE);
  } catch {
    // Authentication is fail-closed: never report a successful login or
    // registration when the account cannot be made durable.
    throw new AuthError(
      "Account storage is unavailable right now. Try again shortly.",
      503,
      "auth_storage_unavailable",
    );
  }
};

const readStore = (): AuthStore => {
  if (cached) return cached;
  if (!fs.existsSync(FILE)) {
    cached = freshStore();
    return cached;
  }
  try {
    cached = normaliseStore(JSON.parse(fs.readFileSync(FILE, "utf8")));
    return cached;
  } catch {
    // Do not overwrite a damaged account file with an empty one. A corrupt
    // identity store must be an outage, not a silent mass account deletion.
    throw new AuthError(
      "Account storage is unavailable right now. Try again shortly.",
      503,
      "auth_storage_unavailable",
    );
  }
};

const writeStore = (store: AuthStore): void => {
  store.updatedAt = nowIso();
  persist(store);
};

const publicUser = (account: StoredAccount): AuthUser => ({
  id: account.id,
  email: account.email,
  name: account.name,
  createdAt: account.createdAt,
});

const hashAuthSecret = async (secret: string): Promise<string> => {
  const salt = randomBytes(16);
  const derived = await scryptAsync(secret, salt, 64, SCRYPT_OPTIONS);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
};

const verifyAuthSecret = async (secret: string, stored: string): Promise<boolean> => {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex || !/^[a-f0-9]{32}$/.test(saltHex) || !/^[a-f0-9]{128}$/.test(hashHex)) {
    return false;
  }
  const derived = await scryptAsync(secret, Buffer.from(saltHex, "hex"), 64, SCRYPT_OPTIONS);
  const expected = Buffer.from(hashHex, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
};

const validSecret = (value: unknown): value is string =>
  typeof value === "string" && SECRET_PATTERN.test(value);

const validEmail = (value: string): boolean => EMAIL_PATTERN.test(normaliseEmail(value));

const sessionExpiry = (): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + SESSION_DAYS);
  return date.toISOString();
};

const cleanSessions = (store: AuthStore): boolean => {
  const now = Date.now();
  let changed = false;
  for (const [key, session] of Object.entries(store.sessions)) {
    if (Date.parse(session.expiresAt) <= now) {
      delete store.sessions[key];
      changed = true;
    }
  }
  const keys = Object.keys(store.sessions);
  if (keys.length > MAX_SESSIONS) {
    for (const key of keys.slice(0, keys.length - MAX_SESSIONS)) {
      delete store.sessions[key];
      changed = true;
    }
  }
  return changed;
};

export const createSession = (userId: string): string => {
  const store = readStore();
  const account = store.accounts[userId];
  if (!account) throw new AuthError("Account not found.", 401, "auth_required");
  const token = randomBytes(32).toString("hex");
  const createdAt = nowIso();
  store.sessions[hashToken(token)] = {
    userId,
    createdAt,
    expiresAt: sessionExpiry(),
    lastSeenAt: createdAt,
  };
  cleanSessions(store);
  writeStore(store);
  return token;
};

export const deleteSession = (token: string | undefined): void => {
  if (!token || !TOKEN_PATTERN.test(token)) return;
  const store = readStore();
  const key = hashToken(token);
  if (!store.sessions[key]) return;
  delete store.sessions[key];
  writeStore(store);
};

export const sessionFromRequest = (req: Request): string | undefined => {
  const header = req.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const value = header.slice(7).trim().toLowerCase();
    if (TOKEN_PATTERN.test(value)) return value;
  }
  const cookie = req.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== COOKIE_NAME) continue;
    const value = rest.join("=").trim();
    if (TOKEN_PATTERN.test(value)) return value;
  }
  return undefined;
};

/** Resolve the server-side identity from the encrypted Supabase cookie, or the legacy session when Supabase is not configured. */
export const resolveUser = async (
  req: Request,
  res: Response,
): Promise<AuthUser | null> => {
  const existing = authUser(req);
  if (existing) return existing;
  if (supabaseAuthConfigured()) {
    return resolveSupabaseSession(req, res);
  }
  return userFromRequest(req);
};

export const userFromRequest = (req: Request): AuthUser | null => {
  try {
    const token = sessionFromRequest(req);
    if (!token) return null;
    const store = readStore();
    const key = hashToken(token);
    const session = store.sessions[key];
    if (!session) return null;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      delete store.sessions[key];
      writeStore(store);
      return null;
    }
    const account = store.accounts[session.userId];
    if (!account) return null;

    // Avoid a disk write on every request; refresh the idle timestamp hourly.
    if (Date.now() - Date.parse(session.lastSeenAt) > 3_600_000) {
      session.lastSeenAt = nowIso();
      writeStore(store);
    }
    return publicUser(account);
  } catch {
    return null;
  }
};

export const cookieForSession = (token: string): string => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${
    SESSION_DAYS * 86_400
  }${secure}`;
};

export const clearSessionCookie = (): string => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await resolveUser(req, res);
    if (!user) {
      return res.status(401).json({
        error: "Sign in to your account to use the AI assistant.",
        code: "auth_required",
      });
    }
    (req as Request & { auth?: AuthUser }).auth = user;
    return next();
  } catch {
    return res.status(401).json({
      error: "Sign in to your account to use the AI assistant.",
      code: "auth_required",
    });
  }
};

export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await resolveUser(req, res);
    if (user) (req as Request & { auth?: AuthUser }).auth = user;
  } catch {
    // Optional identity must never block public status pages.
  }
  return next();
};

export const authUser = (req: Request): AuthUser | undefined =>
  (req as Request & { auth?: AuthUser }).auth;

export const registerAccount = async (input: {
  email: unknown;
  name: unknown;
  authSecret: unknown;
}): Promise<AuthUser> => {
  if (typeof input.email !== "string" || !validEmail(input.email)) {
    throw new AuthError("Enter a valid email address.", 400, "bad_email");
  }
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw new AuthError("Enter your name.", 400, "bad_name");
  }
  if (!validSecret(input.authSecret)) {
    throw new AuthError("The account credential is not valid.", 400, "bad_auth_secret");
  }

  const email = normaliseEmail(input.email);
  const store = readStore();
  if (Object.keys(store.accounts).length >= MAX_ACCOUNTS) {
    throw new AuthError("Account registration is temporarily unavailable.", 503, "auth_full");
  }
  if (Object.values(store.accounts).some((account) => account.email === email)) {
    throw new AuthError(
      "An account with that email already exists. Sign in instead.",
      409,
      "email_in_use",
    );
  }

  const createdAt = nowIso();
  const account: StoredAccount = {
    id: randomBytes(20).toString("hex"),
    email,
    name: input.name.trim().slice(0, 80),
    authHash: await hashAuthSecret(input.authSecret),
    createdAt,
    updatedAt: createdAt,
  };
  store.accounts[account.id] = account;
  writeStore(store);
  return publicUser(account);
};

export const loginAccount = async (input: {
  email: unknown;
  authSecret: unknown;
}): Promise<AuthUser> => {
  if (typeof input.email !== "string" || !validEmail(input.email)) {
    throw new AuthError("Email or password is incorrect.", 401, "invalid_credentials");
  }
  if (!validSecret(input.authSecret)) {
    throw new AuthError("Email or password is incorrect.", 401, "invalid_credentials");
  }

  const email = normaliseEmail(input.email);
  const store = readStore();
  const account = Object.values(store.accounts).find((entry) => entry.email === email);
  if (!account) {
    // Keep the failure path expensive so account existence is not obvious from
    // response timing alone.
    await scryptAsync("0".repeat(64), "0".repeat(16), 64, SCRYPT_OPTIONS);
    throw new AuthError("Email or password is incorrect.", 401, "invalid_credentials");
  }
  if (!(await verifyAuthSecret(input.authSecret, account.authHash))) {
    throw new AuthError("Email or password is incorrect.", 401, "invalid_credentials");
  }
  return publicUser(account);
};

export const renameAccount = (userId: string, name: string): AuthUser => {
  const store = readStore();
  const account = store.accounts[userId];
  if (!account) throw new AuthError("Account not found.", 404, "account_not_found");
  const clean = name.trim();
  if (!clean) throw new AuthError("Enter your name.", 400, "bad_name");
  account.name = clean.slice(0, 80);
  account.updatedAt = nowIso();
  writeStore(store);
  return publicUser(account);
};

/** Test-only session bootstrap. Never available outside a test process. */
export const createTestSession = (userId: string): string => {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("createTestSession is only available in tests");
  }
  if (!ID_PATTERN.test(userId)) throw new Error("Invalid test user id");
  const store = readStore();
  if (!store.accounts[userId]) {
    const createdAt = nowIso();
    store.accounts[userId] = {
      id: userId,
      email: `${userId}@test.local`,
      name: "Test user",
      authHash: `${randomBytes(16).toString("hex")}:${randomBytes(64).toString("hex")}`,
      createdAt,
      updatedAt: createdAt,
    };
    writeStore(store);
  }
  return createSession(userId);
};

export const resetAuthCache = (): void => {
  cached = null;
};

export const resetAuthStore = (): void => {
  cached = null;
  fs.rmSync(FILE, { force: true });
};

const attempts = new Map<string, { count: number; resetAt: number }>();

const isLimited = (key: string): boolean => {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    if (attempts.size > 5_000) attempts.clear();
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_LOGIN_ATTEMPTS;
};

const clearLimit = (key: string): void => {
  attempts.delete(key);
};

const fail = (res: Response, error: unknown) => {
  if (error instanceof AuthError || error instanceof SupabaseAuthError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error("Auth request failed:", (error as Error).message);
  return res.status(500).json({ error: "Authentication failed.", code: "auth_error" });
};

const router = express.Router();

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.get("/config", (_req: Request, res: Response) => {
  const supabase = supabaseAuthConfigured();
  res.json({
    configured: true,
    provider: supabase ? "supabase" : "password",
    emailVerification: supabase,
    sessionDays: SESSION_DAYS,
  });
});

const validEmailInput = (value: unknown): string => {
  const email = typeof value === "string" ? normaliseEmail(value) : "";
  if (!validEmail(email)) {
    throw new AuthError("Enter a valid email address.", 400, "bad_email");
  }
  return email;
};

const validPasswordInput = (value: unknown): string => {
  if (typeof value !== "string" || value.length < 8) {
    throw new AuthError("Use a password of at least 8 characters.", 400, "weak_password");
  }
  if (value.length > 200) {
    throw new AuthError("That password is too long.", 400, "weak_password");
  }
  return value;
};

router.post("/register", async (req: Request, res: Response) => {
  const email = typeof req.body?.email === "string" ? normaliseEmail(req.body.email) : "";
  const key = `${req.ip || "unknown"}:${email}`;
  if (isLimited(key)) {
    return res.status(429).json({ error: "Too many attempts. Try again later.", code: "rate_limited" });
  }
  try {
    if (supabaseAuthConfigured()) {
      const cleanEmail = validEmailInput(req.body?.email);
      const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 80) : "";
      if (!name) throw new AuthError("Enter your name.", 400, "bad_name");
      const password = validPasswordInput(req.body?.password);
      if (req.body?.acceptedTerms !== true) {
        throw new AuthError("Accept the terms and privacy policy to create an account.", 400, "terms_required");
      }

      const result = await registerSupabaseUser({
        name,
        email: cleanEmail,
        password,
        redirectTo: supabaseCallbackUrl(req),
      });
      clearLimit(key);
      if ("verificationRequired" in result) {
        return res.status(202).json({
          ok: true,
          verificationRequired: true,
          email: result.email,
          message: "Check your inbox to verify your email, then sign in.",
        });
      }
      setSupabaseSessionCookie(res, result);
      return res.status(201).json({ user: result.user });
    }

    const user = await registerAccount(req.body || {});
    clearLimit(key);
    res.setHeader("Set-Cookie", cookieForSession(createSession(user.id)));
    return res.status(201).json({ user });
  } catch (error) {
    return fail(res, error);
  }
});

router.post("/login", async (req: Request, res: Response) => {
  const email = typeof req.body?.email === "string" ? normaliseEmail(req.body.email) : "";
  const key = `${req.ip || "unknown"}:${email}`;
  if (isLimited(key)) {
    return res.status(429).json({ error: "Too many attempts. Try again later.", code: "rate_limited" });
  }
  try {
    if (supabaseAuthConfigured()) {
      const cleanEmail = validEmailInput(req.body?.email);
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!password) {
        throw new AuthError("Email or password is incorrect.", 401, "invalid_credentials");
      }
      const session = await loginSupabaseUser({ email: cleanEmail, password });
      clearLimit(key);
      setSupabaseSessionCookie(res, session);
      return res.json({ user: session.user });
    }

    const user = await loginAccount(req.body || {});
    clearLimit(key);
    res.setHeader("Set-Cookie", cookieForSession(createSession(user.id)));
    return res.json({ user });
  } catch (error) {
    return fail(res, error);
  }
});

router.post("/forgot-password", async (req: Request, res: Response) => {
  if (!supabaseAuthConfigured()) {
    return res.status(503).json({ error: "Password reset is not configured.", code: "auth_not_configured" });
  }
  const email = typeof req.body?.email === "string" ? normaliseEmail(req.body.email) : "";
  const key = `${req.ip || "unknown"}:forgot:${email}`;
  if (isLimited(key)) {
    return res.status(429).json({ error: "Too many attempts. Try again later.", code: "rate_limited" });
  }
  try {
    if (validEmail(email)) {
      await requestSupabasePasswordReset({ email, redirectTo: supabaseCallbackUrl(req) });
    }
    return res.status(202).json({
      ok: true,
      message: "If that email has an account, a reset link is on its way.",
    });
  } catch (error) {
    return fail(res, error);
  }
});

router.post("/resend-verification", async (req: Request, res: Response) => {
  if (!supabaseAuthConfigured()) {
    return res.status(503).json({ error: "Verification email is not configured.", code: "auth_not_configured" });
  }
  const email = typeof req.body?.email === "string" ? normaliseEmail(req.body.email) : "";
  const key = `${req.ip || "unknown"}:resend:${email}`;
  if (isLimited(key)) {
    return res.status(429).json({ error: "Too many attempts. Try again later.", code: "rate_limited" });
  }
  try {
    if (validEmail(email)) {
      await resendSupabaseVerification({ email, redirectTo: supabaseCallbackUrl(req) });
    }
    return res.status(202).json({
      ok: true,
      message: "If that email needs verification, a new link is on its way.",
    });
  } catch (error) {
    return fail(res, error);
  }
});

router.get("/callback", async (req: Request, res: Response) => {
  const type = typeof req.query.type === "string" ? req.query.type : "";
  const tokenHash = typeof req.query.token_hash === "string" ? req.query.token_hash : "";
  const isRecovery = type === "recovery";
  const failure = (reason: string) =>
    res.redirect(302, `/#/auth/${isRecovery ? "reset" : "verified"}?status=error&reason=${encodeURIComponent(reason)}`);

  if (!supabaseAuthConfigured()) return failure("auth_not_configured");
  if (req.query.error) return failure("link_invalid");
  if (!["signup", "email", "recovery", "invite"].includes(type)) return failure("link_invalid");
  if (tokenHash.length < 10 || tokenHash.length > 500) return failure("link_invalid");

  try {
    const session = await verifySupabaseTokenHash({
      tokenHash,
      type,
      redirectTo: supabaseCallbackUrl(req),
    });
    if (isRecovery) {
      setSupabaseResetCookie(res, session.tokens, session.user);
      return res.redirect(302, "/#/auth/reset?status=ready");
    }
    setSupabaseSessionCookie(res, session);
    return res.redirect(302, "/#/auth/verified?status=success");
  } catch (error) {
    const code = error instanceof SupabaseAuthError ? error.code : "verification_failed";
    return failure(
      code === "email_verification_required" || code === "already_verified"
        ? "already_verified"
        : "expired_or_used",
    );
  }
});

router.post("/reset-password", async (req: Request, res: Response) => {
  if (!supabaseAuthConfigured()) {
    return res.status(503).json({ error: "Password reset is not configured.", code: "auth_not_configured" });
  }
  if (!hasSupabaseResetCookie(req)) {
    return res.status(401).json({ error: "That reset link is invalid or has expired.", code: "reset_link_invalid" });
  }
  try {
    const password = validPasswordInput(req.body?.password);
    if (req.body?.confirmPassword !== undefined && req.body.confirmPassword !== password) {
      throw new AuthError("Those two passwords do not match.", 400, "password_mismatch");
    }
    await resetSupabasePassword(req, password);
    clearSupabaseCookies(res);
    return res.json({ ok: true, message: "Your account password was updated. Sign in with it now." });
  } catch (error) {
    return fail(res, error);
  }
});

router.post("/logout", async (req: Request, res: Response) => {
  if (supabaseAuthConfigured()) {
    const accessToken = supabaseSessionAccessToken(req);
    revokeSupabaseSession(req);
    if (accessToken) await logoutSupabase(accessToken);
    clearSupabaseCookies(res);
    return res.json({ ok: true });
  }
  try {
    deleteSession(sessionFromRequest(req));
  } catch {
    // Clearing the cookie is still the correct outcome.
  }
  res.setHeader("Set-Cookie", clearSessionCookie());
  return res.json({ ok: true });
});

router.get("/me", requireAuth, (req: Request, res: Response) => {
  res.json({ user: authUser(req) });
});

router.patch("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = authUser(req)!;
    const clean = String(req.body?.name || "").trim();
    if (!clean) throw new AuthError("Enter your name.", 400, "bad_name");
    if (supabaseAuthConfigured()) {
      await renameSupabaseAccount(user.id, clean.slice(0, 80));
      return res.json({ user: { ...user, name: clean.slice(0, 80) } });
    }
    const updated = renameAccount(user.id, clean);
    return res.json({ user: updated });
  } catch (error) {
    return fail(res, error);
  }
});

router.all("*", (_req: Request, res: Response) => {
  res.setHeader("Allow", "GET, POST, PATCH");
  res.status(404).json({ error: "Unknown account route.", code: "not_found" });
});

router.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = error?.status === 413 ? 413 : 400;
  res.status(status).json({
    error: status === 413 ? "That account request is too large." : "The account request could not be read.",
    code: status === 413 ? "payload_too_large" : "bad_json",
  });
});

export default router;
