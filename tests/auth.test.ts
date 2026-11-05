/**
 * Identity and wallet-binding tests.
 *
 * These exercise the real account routes, scrypt verifier, HttpOnly session,
 * one-wallet-per-account rule and the one-time legacy wallet claim.
 *
 * Run with: npm run auth:test
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
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

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-auth-"));
process.chdir(workdir);
process.env.NODE_ENV = "test";
process.env.FREEBUFF_API_KEY = "auth-test-key";
process.env.FREEBUFF_ENABLED = "true";
process.env.FREEBUFF_MODEL = "auth-test-model";
process.env.FREEBUFF_MODELS = "auth-test-model";
process.env.FREEBUFF_INPUT_PRICE_PER_MILLION = "0";
process.env.FREEBUFF_OUTPUT_PRICE_PER_MILLION = "0";
process.env.AI_VALIDATE_MODELS = "false";
process.env.AI_STREAMING = "false";
process.env.AI_CACHE_ENABLED = "false";
process.env.AI_REQUESTS_PER_MINUTE = "1000";
process.env.AI_REQUESTS_PER_DAY = "100000";
process.env.AI_REQUESTS_PER_DAY_PER_CLIENT = "100000";
process.env.AI_REQUESTS_PER_DAY_PER_USER = "100000";
process.env.AI_TOKENS_PER_DAY = "100000000";
process.env.AI_TOKENS_PER_DAY_PER_USER = "100000000";
process.env.AI_COST_PER_MONTH_USD = "1000";
process.env.AI_COST_PER_MONTH_PER_USER_USD = "1000";
process.env.AI_ADMIN_TOKEN = "auth-admin-token-123456";
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_ENABLED;
delete process.env.HUGGINGFACE_API_KEY;
delete process.env.AI_DEFAULT_MODEL;
delete process.env.AI_BACKUP_MODEL;
delete process.env.AI_ENABLED;

const realFetch = globalThis.fetch;

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

(globalThis as any).fetch = async (input: any, init?: any): Promise<Response> => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (!url.includes("/chat/completions")) return realFetch(input, init);
  return json(200, {
    choices: [{ message: { content: "Identity check reply." } }],
    usage: { prompt_tokens: 20, completion_tokens: 10 },
  });
};

const authRoutes = await import("../server/auth");
const aiRoutes = await import("../server/ai/routes");
const adminRoutes = await import("../server/ai/admin");
const credits = await import("../server/ai/credits");

const app = express();
app.use("/api/auth", express.json({ limit: "32kb" }), authRoutes.default);
app.use("/api/ai/admin", express.json({ limit: "32kb" }), adminRoutes.default);
app.use("/api/ai", express.json({ limit: "3mb" }), aiRoutes.default);
const listener = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => listener.once("listening", () => resolve()));
const port = (listener.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

const call = async (url: string, init?: RequestInit) => {
  const response = await realFetch(url, init);
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return {
    status: response.status,
    body,
    cookie: (response.headers.get("set-cookie") || "").split(";")[0],
    setCookie: response.headers.get("set-cookie") || "",
  };
};

const secret = (seed: string) => seed.repeat(64).slice(0, 64);
const register = async (name: string, email: string, authSecret: string) =>
  call(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, authSecret }),
  });
const login = async (email: string, authSecret: string) =>
  call(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, authSecret }),
  });
const authed = (cookie: string, extra: Record<string, string> = {}) => ({
  "Content-Type": "application/json",
  Cookie: cookie,
  ...extra,
});

try {
  // --- registration and session -------------------------------------------

  let response = await register("Ada", "ada@example.test", secret("a"));
  check("registration creates a server account", response.status === 201 && Boolean(response.body?.user?.id), response.body);
  check("the server assigns the account id", /^[a-f0-9]{40}$/.test(response.body?.user?.id || ""), response.body?.user?.id);
  check("the session cookie is HttpOnly", /HttpOnly/i.test(response.setCookie), response.setCookie);
  check("the session cookie is SameSite=Strict", /SameSite=Strict/i.test(response.setCookie), response.setCookie);
  const ada = response.body.user;
  const adaCookie = response.cookie;

  response = await call(`${base}/api/auth/me`, { headers: authed(adaCookie) });
  check("the session identifies the account", response.status === 200 && response.body?.user?.id === ada.id, response.body);

  response = await register("Ada again", "ada@example.test", secret("b"));
  check("duplicate emails are refused", response.status === 409 && response.body?.code === "email_in_use", response.body);

  response = await login("ada@example.test", secret("b"));
  check("a wrong verifier cannot log in", response.status === 401 && response.body?.code === "invalid_credentials", response.body);

  response = await login("ada@example.test", secret("a"));
  check("the correct verifier logs in", response.status === 200 && response.body?.user?.id === ada.id, response.body);

  // --- one wallet per account ---------------------------------------------

  response = await call(`${base}/api/ai/wallet`, {
    method: "POST",
    headers: authed(adaCookie),
  });
  check("a verified account gets one free wallet", response.status === 200 && response.body?.credits?.balance === 100, response.body);
  const firstReset = response.body?.credits?.resetAt;

  response = await call(`${base}/api/ai/wallet`, {
    method: "POST",
    headers: authed(adaCookie),
  });
  check("creating the wallet again does not add credits", response.status === 200 && response.body?.credits?.balance === 100 && response.body?.credits?.resetAt === firstReset, response.body);

  response = await call(`${base}/api/ai/credits`, {
    headers: authed(adaCookie, { "x-serene-user": "f".repeat(40) }),
  });
  check("a spoofed user header is ignored", response.status === 200 && response.body?.credits?.balance === 100, response.body);

  // --- a second account is isolated ---------------------------------------

  response = await register("Grace", "grace@example.test", secret("c"));
  const grace = response.body.user;
  const graceCookie = response.cookie;
  check("a second account gets a different id", grace.id !== ada.id, { ada: ada.id, grace: grace.id });

  response = await call(`${base}/api/ai/wallet`, { method: "POST", headers: authed(graceCookie) });
  check("the second account gets its own wallet", response.status === 200 && response.body?.credits?.balance === 100, response.body);

  response = await call(`${base}/api/ai/credits`, { headers: authed(adaCookie) });
  check("the first account balance is unchanged", response.body?.credits?.balance === 100, response.body?.credits?.balance);

  // --- chat uses only the verified id -------------------------------------

  response = await call(`${base}/api/ai/chat`, {
    method: "POST",
    headers: authed(adaCookie, { "x-serene-user": grace.id, "x-ai-request-id": "auth-chat-0001" }),
    body: JSON.stringify({ message: "Hello", history: [], context: {} }),
  });
  check("chat succeeds for the signed-in account", response.status === 200, response.body);
  check("a spoofed id cannot spend the other wallet", response.body?.credits?.balance === 99, response.body?.credits?.balance);
  response = await call(`${base}/api/ai/credits`, { headers: authed(graceCookie) });
  check("the other account still has all its credits", response.body?.credits?.balance === 100, response.body?.credits?.balance);

  // --- legacy wallet migration --------------------------------------------

  const legacyId = "d".repeat(40);
  const legacyToken = "e".repeat(64);
  credits.registerCreditAccount({ userId: legacyId, token: legacyToken });
  credits.reserveCredits({ userId: legacyId, action: "simple_message", requestId: "legacy-auth-row" });
  credits.settleCredits({ userId: legacyId, requestId: "legacy-auth-row" });

  response = await register("Linus", "linus@example.test", secret("d"));
  const linusCookie = response.cookie;
  const linus = response.body.user;
  response = await call(`${base}/api/ai/wallet/claim`, {
    method: "POST",
    headers: authed(linusCookie),
    body: JSON.stringify({ legacyUserId: legacyId, legacyToken }),
  });
  check("an existing wallet can be claimed once", response.status === 200 && response.body?.credits?.balance === 99, response.body);
  check("the claimed wallet belongs to the verified id", credits.creditSummary(linus.id).balance === 99);
  check("the legacy wallet id no longer exists", (() => {
    try {
      credits.creditSummary(legacyId);
      return false;
    } catch {
      return true;
    }
  })());
  response = await call(`${base}/api/ai/credits/history`, { headers: authed(linusCookie) });
  check("credit history moves with the wallet", response.body?.history?.some((row: any) => row.requestId === "legacy-auth-row"), response.body?.history);

  // --- admin remains separate ---------------------------------------------

  response = await call(`${base}/api/ai/admin/overview`, { headers: authed(adaCookie) });
  check("a user session cannot open the admin dashboard", response.status === 401, response.status);
  response = await call(`${base}/api/ai/admin/overview`, {
    headers: { Authorization: "Bearer auth-admin-token-123456" },
  });
  check("the separate admin token still works", response.status === 200 && Boolean(response.body?.usage), response.status);

  // --- quota key is the verified id, not a caller header ------------------

  response = await register("Rate", "rate@example.test", secret("f"));
  const rateCookie = response.cookie;
  const rateUser = response.body.user;
  credits.ensureCreditAccount(rateUser.id);
  // The wallet bootstrap is direct, so the next two chat calls are the first
  // pair counted against the tight per-account limit.
  process.env.AI_REQUESTS_PER_MINUTE = "1";
  const first = await call(`${base}/api/ai/chat`, {
    method: "POST",
    headers: authed(rateCookie, { "x-serene-client": "one", "x-ai-request-id": "auth-rate-0001" }),
    body: JSON.stringify({ message: "First", history: [], context: {} }),
  });
  const second = await call(`${base}/api/ai/chat`, {
    method: "POST",
    headers: authed(rateCookie, { "x-serene-client": "two", "x-ai-request-id": "auth-rate-0002" }),
    body: JSON.stringify({ message: "Second", history: [], context: {} }),
  });
  check("the first request is allowed", first.status === 200, first.body);
  check("rotating a client header cannot bypass the account limit", second.status === 429 && second.body?.code === "rate_limited", second.body);

  // --- logout -------------------------------------------------------------

  response = await call(`${base}/api/auth/logout`, { method: "POST", headers: authed(adaCookie) });
  check("logout succeeds", response.status === 200);
  response = await call(`${base}/api/auth/me`, { headers: authed(adaCookie) });
  check("the old session cannot be reused", response.status === 401, response.status);
} catch (error) {
  fail += 1;
  console.error("SUITE FAILED:", error);
} finally {
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  console.log("");
  if (fail === 0) {
    console.log(`PASS ${pass} / ${pass + fail}`);
    console.log("AUTH_TESTS_OK");
  } else {
    console.error(`PASS ${pass} / ${pass + fail}`);
    process.exitCode = 1;
  }
  fs.rmSync(workdir, { recursive: true, force: true });
}
