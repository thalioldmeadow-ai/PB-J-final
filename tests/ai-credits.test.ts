/**
 * System tests for server-authoritative AI credits.
 *
 * These cover registration, wallet auth, reservations, duplicate requests,
 * failed-request refunds, concurrent spending, period reset, admin pricing and
 * plan assignment, history and the public HTTP routes.
 *
 * Run with: npm run ai:credits:test
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

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-credits-"));
process.chdir(workdir);
process.env.NODE_ENV = "test";

process.env.FREEBUFF_API_KEY = "test-freebuff-key-value";
process.env.FREEBUFF_ENABLED = "true";
process.env.FREEBUFF_MODEL = "test-model";
process.env.FREEBUFF_MODELS = "test-model";
process.env.FREEBUFF_INPUT_PRICE_PER_MILLION = "0";
process.env.FREEBUFF_OUTPUT_PRICE_PER_MILLION = "0";
process.env.AI_VALIDATE_MODELS = "false";
process.env.AI_STREAMING = "false";
process.env.AI_CACHE_ENABLED = "false";
process.env.AI_REQUESTS_PER_MINUTE_PER_CLIENT = "1000";
process.env.AI_REQUESTS_PER_MINUTE = "1000";
process.env.AI_REQUESTS_PER_DAY = "100000";
process.env.AI_REQUESTS_PER_DAY_PER_CLIENT = "100000";
process.env.AI_REQUESTS_PER_DAY_PER_USER = "100000";
process.env.AI_TOKENS_PER_DAY = "100000000";
process.env.AI_TOKENS_PER_DAY_PER_USER = "100000000";
process.env.AI_COST_PER_MONTH_USD = "1000";
process.env.AI_COST_PER_MONTH_PER_USER_USD = "1000";
process.env.AI_ADMIN_TOKEN = "credits-admin-token-123456";
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_ENABLED;
delete process.env.HUGGINGFACE_API_KEY;
delete process.env.AI_DEFAULT_MODEL;
delete process.env.AI_BACKUP_MODEL;
delete process.env.AI_ENABLED;

const realFetch = globalThis.fetch;
let providerMode: "ok" | "down" = "ok";
let providerCalls = 0;

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

(globalThis as any).fetch = async (input: any, init?: any): Promise<Response> => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (!url.includes("/chat/completions")) return realFetch(input, init);

  providerCalls += 1;
  if (providerMode === "down") return json(503, { error: "provider unavailable" });
  return json(200, {
    choices: [{ message: { content: "A short, useful answer." } }],
    usage: { prompt_tokens: 40, completion_tokens: 20 },
  });
};

const userA = "a".repeat(40);
const userB = "b".repeat(40);
const tokenA = "1".repeat(64);
const tokenB = "2".repeat(64);
const wrongToken = "3".repeat(64);

const credits = await import("../server/ai/credits");
const routes = await import("../server/ai/routes");
const admin = await import("../server/ai/admin");
const auth = await import("../server/auth");

const app = express();
app.use("/api/ai/admin", express.json({ limit: "32kb" }), admin.default);
app.use("/api/ai", express.json({ limit: "3mb" }), routes.default);
const listener = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => listener.once("listening", () => resolve()));
const port = (listener.address() as AddressInfo).port;
const aiUrl = `http://127.0.0.1:${port}/api/ai`;
const adminUrl = `${aiUrl}/admin`;

const call = async (url: string, init?: RequestInit) => {
  const response = await realFetch(url, init);
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
};

const walletHeaders = (userId: string, _token?: string) => ({
  "Content-Type": "application/json",
  Cookie: `serene_session=${auth.createTestSession(userId)}`,
});

const chat = (userId: string, token: string, requestId: string, message: string, mode = "general") =>
  call(`${aiUrl}/chat`, {
    method: "POST",
    headers: { ...walletHeaders(userId, token), "x-ai-request-id": requestId },
    body: JSON.stringify({ message, mode, history: [], context: {} }),
  });

const summary = async (userId: string, token: string) => {
  const response = await call(`${aiUrl}/credits`, { headers: walletHeaders(userId, token) });
  return response;
};

const adminHeaders = {
  Authorization: "Bearer credits-admin-token-123456",
  "Content-Type": "application/json",
};

try {
  // --- registration and wallet authentication -----------------------------

  let response = await call(`${aiUrl}/credits/register`, {
    method: "POST",
    headers: walletHeaders(userA, tokenA),
    body: JSON.stringify({ userId: userA, token: tokenA }),
  });
  check("registration creates a free wallet", response.status === 200 && response.body?.credits?.balance === 100, response.body);
  check("registration reports the allocation", response.body?.credits?.total === 100, response.body?.credits?.total);
  check("registration reports a reset date", typeof response.body?.credits?.resetAt === "string");
  check("registration lists action prices", response.body?.credits?.actions?.length === 4);

  response = await call(`${aiUrl}/credits/register`, {
    method: "POST",
    headers: walletHeaders(userA, tokenA),
    body: JSON.stringify({ userId: userA, token: tokenA }),
  });
  check("registration is idempotent", response.status === 200 && response.body?.credits?.balance === 100);

  response = await call(`${aiUrl}/credits/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: userA, token: wrongToken }),
  });
  check("wallet registration requires a verified session", response.status === 401, response.status);

  response = await call(`${aiUrl}/credits`);
  check("wallet reads require a verified session", response.status === 401, response.status);
  response = await summary(userA, tokenA);
  check("wallet reads accept the vault credential", response.status === 200 && response.body?.credits?.balance === 100);

  response = await call(`${aiUrl}/credits`, {
    method: "POST",
    headers: walletHeaders(userA, tokenA),
    body: JSON.stringify({ balance: 999999 }),
  });
  check("there is no client route to write a balance", response.status === 404, response.status);

  // --- successful reservation and idempotent retry ------------------------

  const firstRequest = "req-success-0001";
  response = await chat(userA, tokenA, firstRequest, "Hello, can you help me think?", "general");
  check("a successful AI request is processed", response.status === 200, response.status);
  check("the response includes the new balance", response.body?.credits?.balance === 99, response.body?.credits?.balance);

  response = await summary(userA, tokenA);
  check("a successful request deducts one credit", response.body?.credits?.balance === 99);
  check("used-this-period is recorded", response.body?.credits?.periodCreditsUsed === 1);

  response = await chat(userA, tokenA, firstRequest, "Retrying the exact same request", "general");
  check("a retried request is rejected as a duplicate", response.status === 409 && response.body?.code === "duplicate_request", response.body);
  response = await summary(userA, tokenA);
  check("a retried request is not charged twice", response.body?.credits?.balance === 99);

  // --- failed requests are refunded ---------------------------------------

  providerMode = "down";
  response = await chat(userA, tokenA, "req-failure-0001", "This provider will fail", "general");
  check("provider failure returns an error", response.status >= 500, response.status);
  providerMode = "ok";

  response = await summary(userA, tokenA);
  check("a failed request is not charged", response.body?.credits?.balance === 99, response.body?.credits?.balance);

  const historyResponse = await call(`${aiUrl}/credits/history`, { headers: walletHeaders(userA, tokenA) });
  check("history is readable by the wallet owner", historyResponse.status === 200);
  const failedEntry = historyResponse.body?.history?.find((entry: any) => entry.requestId === "req-failure-0001");
  check("failed history records the request id", Boolean(failedEntry));
  check("failed history has status failed", failedEntry?.status === "failed");
  check("failed history records zero charged credits", failedEntry?.credits === 0);
  check(
    "history records user, action, date and status",
    Boolean(failedEntry?.userId) &&
      Boolean(failedEntry?.action) &&
      Boolean(failedEntry?.createdAt) &&
      Boolean(failedEntry?.status),
  );

  // --- action classification ----------------------------------------------

  check(
    "simple messages use simple_message",
    credits.classifyCreditAction({ mode: "general" }) === "simple_message",
  );
  check(
    "planning uses daily_plan",
    credits.classifyCreditAction({ mode: "planning" }) === "daily_plan",
  );
  check(
    "progress analysis uses detailed_analysis",
    credits.classifyCreditAction({ mode: "progress" }) === "detailed_analysis",
  );
  check(
    "attachments use complex_task",
    credits.classifyCreditAction({ mode: "planning", attachments: [{}] }) === "complex_task",
  );

  // --- period rollover -----------------------------------------------------

  const storeFile = path.join(workdir, "data", "ai-credits.json");
  const raw = JSON.parse(fs.readFileSync(storeFile, "utf8"));
  raw.accounts[userA].balance = 0;
  raw.accounts[userA].periodCreditsUsed = 100;
  raw.accounts[userA].periodEnd = new Date(Date.now() - 1_000).toISOString();
  fs.writeFileSync(storeFile, JSON.stringify(raw));
  credits.resetCreditsCache();

  response = await summary(userA, tokenA);
  check("an expired period resets the balance", response.body?.credits?.balance === 100, response.body?.credits?.balance);
  check("an expired period resets usage", response.body?.credits?.periodCreditsUsed === 0);

  // --- admin pricing and plan assignment ----------------------------------

  response = await call(`${adminUrl}/credits`, { headers: adminHeaders });
  check("admin can read credit settings", response.status === 200 && response.body?.config?.actions?.length === 4);

  response = await call(`${adminUrl}/credits/settings`, { method: "POST", body: JSON.stringify({}) });
  check("admin credit writes require a token", response.status === 401, response.status);

  response = await call(`${adminUrl}/credits/settings`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ actions: { simple_message: 2, daily_plan: 4, detailed_analysis: 6, complex_task: 12 } }),
  });
  check("admin can change action prices", response.status === 200, response.body);
  const priced = response.body?.credits?.config?.actions?.find((entry: any) => entry.key === "simple_message");
  check("a numeric action price is persisted", priced?.cost === 2, priced);

  response = await call(`${adminUrl}/credits/settings`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ plans: { free: { creditsPerPeriod: 250, periodDays: 14 } } }),
  });
  const freePlan = response.body?.credits?.config?.plans?.find((entry: any) => entry.id === "free");
  check("admin can change the free allocation", freePlan?.creditsPerPeriod === 250, freePlan);
  check("admin can change the period length", freePlan?.periodDays === 14, freePlan);

  response = await call(`${aiUrl}/credits/register`, {
    method: "POST",
    headers: walletHeaders(userB, tokenB),
    body: JSON.stringify({ userId: userB, token: tokenB }),
  });
  check("a new wallet uses the updated free allocation", response.body?.credits?.total === 250, response.body?.credits?.total);

  // Concurrency uses a deliberately high price so the 250-credit balance
  // allows exactly ten requests. All eleven are in flight at once.
  await call(`${adminUrl}/credits/settings`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ actions: { simple_message: 25 } }),
  });

  const attempts = await Promise.all(
    Array.from({ length: 11 }, (_, index) =>
      chat(userB, tokenB, `req-concurrent-${index.toString().padStart(4, "0")}`, `Message ${index}`, "general"),
    ),
  );
  const succeeded = attempts.filter((entry) => entry.status === 200).length;
  const rejected = attempts.filter((entry) => entry.status === 402).length;
  check("simultaneous requests cannot overspend", succeeded === 10 && rejected === 1, {
    succeeded,
    rejected,
    statuses: attempts.map((entry) => entry.status),
  });

  response = await summary(userB, tokenB);
  check("concurrent spending leaves no negative balance", response.body?.credits?.balance === 0, response.body?.credits?.balance);

  response = await chat(userB, tokenB, "req-insufficient-0001", "One too many", "general");
  check("an insufficient balance is refused before the provider", response.status === 402 && response.body?.code === "insufficient_credits", response.body);
  check("insufficient requests are not charged", (await summary(userB, tokenB)).body?.credits?.balance === 0);

  response = await call(`${adminUrl}/credits/plan`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ userId: userB, plan: "plus" }),
  });
  check("admin can assign a subscription plan", response.status === 200, response.body);
  const accountB = response.body?.credits?.accounts?.find((entry: any) => entry.userId === userB);
  check("plan assignment resets to the plan allocation", accountB?.balance === 1000 && accountB?.plan === "plus", accountB);

  response = await call(`${adminUrl}/credits/plan`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ userId: userB, plan: "enterprise" }),
  });
  check("unknown plans are rejected", response.status === 400 && response.body?.code === "bad_plan", response.body);

  response = await call(`${adminUrl}/credits`, { headers: adminHeaders });
  check("admin overview lists wallets", response.body?.accounts?.some((entry: any) => entry.userId === userB));
  check("admin overview lists credit history", response.body?.history?.length >= 10, response.body?.history?.length);

  response = await call(`${aiUrl}/credits/history`, { headers: walletHeaders(userB, tokenB) });
  check("history is scoped to the calling wallet", response.status === 200);
  check(
    "history does not leak another wallet",
    Array.isArray(response.body?.history) &&
      response.body.history.every((entry: any) => entry.userId === userB),
  );
  check("successful history records the charged credits", response.body?.history?.some((entry: any) => entry.credits === 25 && entry.status === "succeeded"));

  // --- malformed input ----------------------------------------------------

  response = await call(`${aiUrl}/credits/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "not-a-user", token: tokenA }),
  });
  check("a browser cannot choose the wallet account", response.status === 401, response.body);

  response = await call(`${aiUrl}/chat`, {
    method: "POST",
    headers: { ...walletHeaders(userB, tokenB), "x-ai-request-id": "short" },
    body: JSON.stringify({ message: "Bad request id" }),
  });
  check("malformed request ids are rejected", response.status === 400 && response.body?.code === "bad_request_id", response.body);

  response = await call(`${aiUrl}/chat`, {
    method: "POST",
    headers: walletHeaders(userB, tokenB),
    body: JSON.stringify({ message: "Missing request id" }),
  });
  check("a request id is required", response.status === 400 && response.body?.code === "bad_request_id", response.body);

  check("the provider was reached for successful requests", providerCalls >= 12, providerCalls);
} catch (error) {
  fail += 1;
  console.error("SUITE FAILED:", error);
} finally {
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  delete process.env.AI_ADMIN_TOKEN;
  console.log("");
  if (fail === 0) {
    console.log(`PASS ${pass} / ${pass + fail}`);
    console.log("AI_CREDITS_TESTS_OK");
  } else {
    console.error(`PASS ${pass} / ${pass + fail}`);
    process.exitCode = 1;
  }
  fs.rmSync(workdir, { recursive: true, force: true });
}
