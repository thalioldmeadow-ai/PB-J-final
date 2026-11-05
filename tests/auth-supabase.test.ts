/**
 * Phase 4 Supabase authentication tests.
 *
 * These exercise the real Express auth router. Supabase Auth and PostgREST are
 * mocked at the HTTP boundary so the suite can run without a hosted project or
 * credentials. The real database trigger/wallet rules remain covered by the
 * embedded-Postgres foundation and RLS suites.
 *
 * Run with: npm run auth:supabase:test
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";

let pass = 0;
let fail = 0;

const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.error(`FAIL  ${name}${detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`);
  }
};

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-auth-supabase-"));
process.chdir(workdir);
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://phase4-test.supabase.co";
process.env.SUPABASE_ANON_KEY = "phase4-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "phase4-service-role-key";
process.env.SUPABASE_AUTH_ENABLED = "false";

const { supabaseAuthConfigured } = await import("../server/supabaseAuth");
check("credentials alone do not activate Supabase auth", supabaseAuthConfigured() === false);
process.env.SUPABASE_AUTH_ENABLED = "true";
check("explicit opt-in activates Supabase auth", supabaseAuthConfigured() === true);

interface MockUser {
  id: string;
  email: string;
  password: string;
  email_confirmed_at: string | null;
  raw_user_meta_data: Record<string, unknown>;
  created_at: string;
}

interface MockProfile {
  id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

interface MockWallet {
  user_id: string;
  plan: "free";
  balance: string;
  allocated: string;
  period_credits_used: string;
  period_start: string;
  period_end: string;
  subscription_status: "active";
}

interface MockSubscription {
  user_id: string;
  plan: "free";
  status: "active";
  environment: "SANDBOX";
  purchased_at: string;
  expires_at: string;
}

const users = new Map<string, MockUser>();
const usersByEmail = new Map<string, string>();
const profiles = new Map<string, MockProfile>();
const wallets = new Map<string, MockWallet>();
const subscriptions = new Map<string, MockSubscription>();
const tokens = new Map<string, { userId: string; expiresIn: number }>();
const refreshTokens = new Map<string, string>();
const verificationTokens = new Map<string, { userId: string; type: string; used: boolean }>();
let rpcCalls = 0;
let refreshCalls = 0;
let tokenCounter = 0;

const nowIso = () => new Date().toISOString();
const futureIso = (seconds = 3600) => new Date(Date.now() + seconds * 1000).toISOString();

const publicUser = (user: MockUser) => ({
  id: user.id,
  email: user.email,
  email_confirmed_at: user.email_confirmed_at,
  created_at: user.created_at,
  user_metadata: user.raw_user_meta_data,
});

const issueSession = (user: MockUser) => {
  tokenCounter += 1;
  const access = `access-token-${tokenCounter}-${randomUUID()}`;
  const refresh = `refresh-token-${tokenCounter}-${randomUUID()}`;
  const expiresIn = user.email.startsWith("short-") ? 1 : 3600;
  tokens.set(access, { userId: user.id, expiresIn });
  refreshTokens.set(refresh, user.id);
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: expiresIn,
    user: publicUser(user),
  };
};

const ensureAccount = (userId: string, displayName: string) => {
  const user = [...users.values()].find((entry) => entry.id === userId);
  if (!user) return;
  if (!profiles.has(userId)) {
    const created = nowIso();
    profiles.set(userId, {
      id: userId,
      display_name: displayName.slice(0, 80) || "Member",
      created_at: created,
      updated_at: created,
    });
  }
  if (!wallets.has(userId)) {
    const created = nowIso();
    wallets.set(userId, {
      user_id: userId,
      plan: "free",
      balance: "100.0000",
      allocated: "100.0000",
      period_credits_used: "0.0000",
      period_start: created,
      period_end: futureIso(86_400),
      subscription_status: "active",
    });
  }
  if (!subscriptions.has(userId)) {
    subscriptions.set(userId, {
      user_id: userId,
      plan: "free",
      status: "active",
      environment: "SANDBOX",
      purchased_at: nowIso(),
      expires_at: futureIso(86_400),
    });
  }
};

const createUser = (email: string, password: string, confirmed: boolean): MockUser => {
  const user: MockUser = {
    id: randomUUID(),
    email: email.toLowerCase(),
    password,
    email_confirmed_at: confirmed ? nowIso() : null,
    raw_user_meta_data: { display_name: email.split("@")[0] },
    created_at: nowIso(),
  };
  users.set(user.id, user);
  usersByEmail.set(user.email, user.id);
  ensureAccount(user.id, String(user.raw_user_meta_data.display_name));
  return user;
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const noContent = (status = 204) => new Response(null, { status });

const realFetch = globalThis.fetch;
const supabaseFetch = async (input: any, init?: any): Promise<Response> => {
  const rawUrl = typeof input === "string" ? input : input?.url || "";
  if (!rawUrl.startsWith(process.env.SUPABASE_URL!)) return realFetch(input, init);
  const url = new URL(rawUrl);
  const method = String(init?.method || "GET").toUpperCase();
  let body: any = {};
  if (init?.body) {
    try {
      body = JSON.parse(String(init.body));
    } catch {
      body = {};
    }
  }

  if (url.pathname === "/auth/v1/signup") {
    const email = String(body.email || "").toLowerCase();
    const password = String(body.password || "");
    if (usersByEmail.has(email)) return json(422, { msg: "User already registered" });
    if (password.length < 8) return json(422, { msg: "Password should be at least 8 characters" });
    const user = createUser(email, password, false);
    if (body.data?.display_name) user.raw_user_meta_data.display_name = body.data.display_name;
    const tokenHash = `signup-${randomUUID()}`;
    verificationTokens.set(tokenHash, { userId: user.id, type: "signup", used: false });
    return json(200, { user: publicUser(user) });
  }

  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
    const user = users.get(usersByEmail.get(String(body.email || "").toLowerCase()) || "");
    if (!user || user.password !== body.password) {
      return json(400, { error_code: "invalid_grant", msg: "Invalid login credentials" });
    }
    if (!user.email_confirmed_at) {
      return json(400, { error_code: "email_not_confirmed", msg: "Email not confirmed" });
    }
    return json(200, issueSession(user));
  }

  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
    const userId = refreshTokens.get(String(body.refresh_token || ""));
    const user = userId ? users.get(userId) : undefined;
    if (!user) return json(401, { error_code: "invalid_grant", msg: "Invalid Refresh Token" });
    refreshCalls += 1;
    return json(200, issueSession(user));
  }

  if (url.pathname === "/auth/v1/verify") {
    const record = verificationTokens.get(String(body.token_hash || ""));
    if (!record || record.used) return json(401, { msg: "Token has expired or is invalid" });
    record.used = true;
    const user = users.get(record.userId);
    if (!user) return json(401, { msg: "Token has expired or is invalid" });
    if (record.type === "signup" && user.email_confirmed_at) {
      return json(409, { msg: "Email already confirmed" });
    }
    user.email_confirmed_at = nowIso();
    return json(200, issueSession(user));
  }

  if (url.pathname === "/auth/v1/recover") {
    const user = users.get(usersByEmail.get(String(body.email || "").toLowerCase()) || "");
    if (user) {
      const tokenHash = `recovery-${randomUUID()}`;
      verificationTokens.set(tokenHash, { userId: user.id, type: "recovery", used: false });
    }
    return json(200, {});
  }

  if (url.pathname === "/auth/v1/resend") {
    const user = users.get(usersByEmail.get(String(body.email || "").toLowerCase()) || "");
    if (user && !user.email_confirmed_at) {
      const tokenHash = `signup-${randomUUID()}`;
      verificationTokens.set(tokenHash, { userId: user.id, type: "signup", used: false });
    }
    return json(200, {});
  }

  if (url.pathname === "/auth/v1/user") {
    const auth = String(init?.headers?.Authorization || init?.headers?.authorization || "");
    const access = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const record = tokens.get(access);
    const user = record ? users.get(record.userId) : undefined;
    if (!user) return json(401, { msg: "invalid token" });
    if (method === "PUT") {
      if (typeof body.password !== "string" || body.password.length < 8) {
        return json(422, { msg: "Password should be at least 8 characters" });
      }
      user.password = body.password;
    }
    return json(200, publicUser(user));
  }

  if (url.pathname === "/auth/v1/logout") {
    return noContent();
  }

  if (url.pathname === "/rest/v1/rpc/create_profile_and_wallet") {
    rpcCalls += 1;
    ensureAccount(String(body.p_user_id), String(body.p_display_name || "Member"));
    return noContent();
  }

  if (url.pathname === "/rest/v1/profiles") {
    const id = (url.searchParams.get("id") || "").replace(/^eq\./, "");
    if (method === "PATCH") {
      const profile = profiles.get(id);
      if (!profile) return json(404, { message: "not found" });
      profile.display_name = String(body.display_name || profile.display_name).slice(0, 80);
      profile.updated_at = nowIso();
      return json(200, [profile]);
    }
    const profile = profiles.get(id);
    return json(200, profile ? [profile] : []);
  }

  if (url.pathname === "/rest/v1/wallets") {
    const id = (url.searchParams.get("user_id") || "").replace(/^eq\./, "");
    const wallet = wallets.get(id);
    return json(200, wallet ? [wallet] : []);
  }

  if (url.pathname === "/rest/v1/subscriptions") {
    const id = (url.searchParams.get("user_id") || "").replace(/^eq\./, "");
    const subscription = subscriptions.get(id);
    return json(200, subscription ? [subscription] : []);
  }

  return json(500, { message: `unexpected mocked Supabase request: ${method} ${url.pathname}` });
};

(globalThis as any).fetch = supabaseFetch;

const authRouter = await import("../server/auth");
const app = express();
app.use("/api/auth", express.json({ limit: "32kb" }), authRouter.default);
const listener = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => listener.once("listening", () => resolve()));
const base = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
process.env.APP_ORIGIN = base;

const call = async (route: string, init?: RequestInit) => {
  const response = await realFetch(`${base}${route}`, { ...init, redirect: "manual" });
  let body: any = null;
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }
  const setCookie = response.headers.get("set-cookie") || "";
  return {
    status: response.status,
    body,
    location: response.headers.get("location") || "",
    setCookie,
    cookie: setCookie.split(";")[0],
  };
};

const jsonHeaders = (cookie?: string) => ({
  "Content-Type": "application/json",
  ...(cookie ? { Cookie: cookie } : {}),
});

const register = (email: string, password = "correct horse battery", extra: Record<string, unknown> = {}) =>
  call("/api/auth/register", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      name: "Test Person",
      email,
      password,
      acceptedTerms: true,
      ...extra,
    }),
  });

const login = (email: string, password = "correct horse battery") =>
  call("/api/auth/login", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password }),
  });

const confirm = async (email: string) => {
  const user = users.get(usersByEmail.get(email) || "");
  if (!user) throw new Error("test user missing");
  const entry = [...verificationTokens.entries()].find(
    ([, value]) => value.userId === user.id && value.type === "signup" && !value.used,
  );
  if (!entry) throw new Error("verification token missing");
  return call(`/api/auth/callback?token_hash=${encodeURIComponent(entry[0])}&type=signup`);
};

try {
  // --- registration and validation ---------------------------------------
  let response = await call("/api/auth/config");
  check("config reports Supabase", response.body?.provider === "supabase" && response.body?.emailVerification === true, response.body);

  response = await register("ada@example.test");
  check("valid registration asks for email verification", response.status === 202
    && response.body?.verificationRequired === true
    && !response.setCookie, response.body);
  const ada = users.get(usersByEmail.get("ada@example.test") || "")!;
  check("registration creates exactly one profile", profiles.size === 1 && profiles.has(ada.id), [...profiles.keys()]);
  check("registration creates exactly one Free wallet", wallets.size === 1
    && wallets.get(ada.id)?.plan === "free"
    && Number(wallets.get(ada.id)?.balance) === 100, wallets.get(ada.id));
  check("registration creates exactly one Free subscription", subscriptions.size === 1
    && subscriptions.get(ada.id)?.plan === "free"
    && subscriptions.get(ada.id)?.status === "active"
    && subscriptions.get(ada.id)?.environment === "SANDBOX", subscriptions.get(ada.id));
  check("registration never assigns an administrator", !fs.existsSync(path.join(workdir, "data", "auth.json")));

  response = await register("ada@example.test", "different password");
  check("duplicate registration is non-enumerating", response.status === 202
    && response.body?.verificationRequired === true, response.body);
  check("duplicate registration cannot add a wallet", wallets.size === 1, wallets.size);

  response = await register("not-an-email");
  check("invalid email is rejected", response.status === 400 && response.body?.code === "bad_email", response.body);

  response = await register("weak@example.test", "short");
  check("weak password is rejected", response.status === 400 && response.body?.code === "weak_password", response.body);

  response = await register("terms@example.test", "correct horse battery", { acceptedTerms: false });
  check("terms acceptance is required", response.status === 400 && response.body?.code === "terms_required", response.body);

  response = await register("plan@example.test", "correct horse battery", {
    plan: "plus",
    credits: 999999,
    subscriptionStatus: "active",
    userId: randomUUID(),
  });
  const attemptedPlan = users.get(usersByEmail.get("plan@example.test") || "");
  check("browser-supplied plan and credit fields are ignored", response.status === 202
    && Boolean(attemptedPlan)
    && wallets.get(attemptedPlan!.id)?.plan === "free"
    && Number(wallets.get(attemptedPlan!.id)?.balance) === 100
    && subscriptions.get(attemptedPlan!.id)?.plan === "free", {
      status: response.status,
      wallet: attemptedPlan ? wallets.get(attemptedPlan.id) : null,
    });

  // --- unverified login and resend ---------------------------------------
  response = await login("ada@example.test");
  check("unverified login is refused", response.status === 403
    && response.body?.code === "email_verification_required"
    && !response.setCookie, response.body);

  response = await call("/api/auth/resend-verification", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email: "ada@example.test" }),
  });
  check("verification email can be resent", response.status === 202 && response.body?.ok === true, response.body);

  // --- email confirmation and account load -------------------------------
  response = await confirm("ada@example.test");
  check("valid verification redirects to the success page", response.status === 302
    && response.location === "/#/auth/verified?status=success", response.location);
  check("verification sets an HttpOnly Strict session", /HttpOnly/i.test(response.setCookie)
    && /SameSite=Strict/i.test(response.setCookie), response.setCookie);
  const adaCookie = response.cookie;

  response = await call("/api/auth/me", { headers: { Cookie: adaCookie } });
  check("confirmed session identifies the Supabase user", response.status === 200
    && response.body?.user?.id === ada.id
    && response.body?.user?.email === "ada@example.test"
    && response.body?.user?.emailVerified === true, response.body);

  response = await login("ada@example.test");
  check("verified credentials log in", response.status === 200
    && response.body?.user?.id === ada.id
    && response.body?.user?.account?.wallet?.balance === 100
    && response.body?.user?.account?.subscription?.plan === "free", response.body);

  response = await login("ada@example.test", "wrong password");
  check("wrong password is rejected", response.status === 401 && response.body?.code === "invalid_credentials", response.body);

  response = await call(`/api/auth/callback?token_hash=${encodeURIComponent("already-used")}&type=signup`);
  check("invalid or used verification links fail safely", response.status === 302
    && response.location.includes("status=error"), response.location);

  const unusedSignup = [...verificationTokens.entries()].find(
    ([, value]) => value.userId === ada.id && value.type === "signup" && !value.used,
  );
  response = await call(`/api/auth/callback?token_hash=${encodeURIComponent(unusedSignup?.[0] || "missing")}&type=signup`);
  check("already-verified accounts get the already-verified state", response.status === 302
    && response.location.includes("reason=already_verified"), response.location);

  // --- session refresh ----------------------------------------------------
  const shortUser = createUser("short-refresh@example.test", "refresh password", true);
  const shortLogin = await login("short-refresh@example.test", "refresh password");
  check("short-lived session logs in", shortLogin.status === 200 && Boolean(shortLogin.cookie), shortLogin.body);
  const beforeRefresh = refreshCalls;
  response = await call("/api/auth/me", { headers: { Cookie: shortLogin.cookie } });
  check("an expired access token is refreshed", response.status === 200
    && response.body?.user?.id === shortUser.id
    && refreshCalls > beforeRefresh
    && Boolean(response.setCookie), { body: response.body, refreshCalls });

  // --- password reset -----------------------------------------------------
  response = await call("/api/auth/forgot-password", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email: "ada@example.test" }),
  });
  check("known email gets a generic reset response", response.status === 202
    && response.body?.ok === true, response.body);
  const resetEntry = [...verificationTokens.entries()].find(
    ([, value]) => value.userId === ada.id && value.type === "recovery" && !value.used,
  );
  check("reset email token was created", Boolean(resetEntry));

  response = await call("/api/auth/forgot-password", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email: "missing@example.test" }),
  });
  check("unknown email gets the same generic reset response", response.status === 202
    && response.body?.ok === true, response.body);

  response = await call(`/api/auth/callback?token_hash=${encodeURIComponent(resetEntry![0])}&type=recovery`);
  check("recovery link opens the reset page", response.status === 302
    && response.location === "/#/auth/reset?status=ready", response.location);
  const resetCookie = response.setCookie.split(";")[0];

  response = await call("/api/auth/reset-password", {
    method: "POST",
    headers: jsonHeaders(resetCookie),
    body: JSON.stringify({ password: "new account password", confirmPassword: "different" }),
  });
  check("mismatched new passwords are rejected", response.status === 400
    && response.body?.code === "password_mismatch", response.body);

  response = await call("/api/auth/reset-password", {
    method: "POST",
    headers: jsonHeaders(resetCookie),
    body: JSON.stringify({ password: "new account password", confirmPassword: "new account password" }),
  });
  check("valid recovery link changes the account password", response.status === 200
    && response.body?.ok === true, response.body);

  response = await login("ada@example.test", "correct horse battery");
  check("old password no longer works", response.status === 401, response.body);
  response = await login("ada@example.test", "new account password");
  check("new password works", response.status === 200 && response.body?.user?.id === ada.id, response.body);
  const freshLoginCookie = response.cookie;

  // --- impersonation and duplicate-wallet attempts -----------------------
  response = await call("/api/auth/me", {
    headers: {
      Cookie: freshLoginCookie,
      "x-serene-user": randomUUID(),
      "x-user-id": randomUUID(),
      "x-supabase-user": randomUUID(),
    },
  });
  check("browser-supplied ids cannot impersonate another account", response.status === 200
    && response.body?.user?.id === ada.id, response.body);

  const walletCountBefore = wallets.size;
  await call("/api/auth/me", { headers: { Cookie: freshLoginCookie } });
  await call("/api/auth/me", { headers: { Cookie: freshLoginCookie } });
  await login("ada@example.test", "new account password");
  check("repeated logins and reads do not create another wallet", wallets.size === walletCountBefore
    && Number(wallets.get(ada.id)?.balance) === 100, { walletCountBefore, wallets: wallets.size });
  check("the idempotent account RPC was used", rpcCalls >= 3, rpcCalls);

  // --- logout -------------------------------------------------------------
  response = await call("/api/auth/logout", {
    method: "POST",
    headers: { Cookie: freshLoginCookie },
  });
  check("logout succeeds and clears the HttpOnly session", response.status === 200
    && /serene_session=;/i.test(response.setCookie), response.setCookie);
  response = await call("/api/auth/me", { headers: { Cookie: freshLoginCookie } });
  check("the old session cannot be reused", response.status === 401, response.status);
} catch (error) {
  fail += 1;
  console.error("SUITE FAILED:", error);
} finally {
  (globalThis as any).fetch = realFetch;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  console.log("");
  if (fail === 0) {
    console.log(`PASS ${pass} / ${pass + fail}`);
    console.log("AUTH_SUPABASE_TESTS_OK");
  } else {
    console.error(`PASS ${pass} / ${pass + fail}`);
    process.exitCode = 1;
  }
  fs.rmSync(workdir, { recursive: true, force: true });
}
