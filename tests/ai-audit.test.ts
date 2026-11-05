/**
 * Dedicated AI system audit.
 *
 * Covers the scenarios that were outstanding after the previous audit:
 * concurrent credit spending, global spending limits and reservations,
 * provider failures/timeouts/malformed replies, user-security attempts and
 * end-to-end ledger consistency.
 *
 * Run with: npm run ai:audit:test
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

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-audit-"));
process.chdir(workdir);
process.env.NODE_ENV = "test";

process.env.FREEBUFF_API_KEY = "audit-freebuff-key-value";
process.env.FREEBUFF_ENABLED = "true";
process.env.FREEBUFF_MODEL = "audit-model";
process.env.FREEBUFF_MODELS = "audit-model";
process.env.FREEBUFF_INPUT_PRICE_PER_MILLION = "0";
process.env.FREEBUFF_OUTPUT_PRICE_PER_MILLION = "1000";
process.env.FREEBUFF_BILLING_CURRENCY = "USD";
process.env.AI_AUD_PER_USD = "1.55";
process.env.AI_MAX_OUTPUT_TOKENS = "64";
process.env.AI_TIMEOUT_MS = "3000";
process.env.AI_STREAMING = "false";
process.env.AI_CACHE_ENABLED = "false";
process.env.AI_VALIDATE_MODELS = "false";
process.env.AI_REQUESTS_PER_MINUTE = "1000";
process.env.AI_REQUESTS_PER_DAY = "100000";
process.env.AI_REQUESTS_PER_DAY_PER_CLIENT = "100000";
process.env.AI_REQUESTS_PER_DAY_PER_USER = "100000";
process.env.AI_TOKENS_PER_DAY = "100000000";
process.env.AI_TOKENS_PER_DAY_PER_USER = "100000000";
process.env.AI_COST_PER_MONTH_USD = "1000";
process.env.AI_COST_PER_MONTH_PER_USER_USD = "1000";
process.env.AI_ADMIN_TOKEN = "audit-admin-token-123456";
process.env.REVENUECAT_ENVIRONMENT = "SANDBOX";
process.env.REVENUECAT_LIVE_PAYMENTS = "false";
process.env.REVENUECAT_PLUS_ENTITLEMENT = "plus";
process.env.REVENUECAT_PRODUCT_PLUS_MONTHLY = "serene_plus_monthly";
process.env.REVENUECAT_WEBHOOK_AUTH = "audit-webhook-secret";
process.env.REVENUECAT_SECRET_KEY = "rc_audit_secret";
process.env.REVENUECAT_API_BASE = "https://api.revenuecat.test/v1";
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_ENABLED;
delete process.env.HUGGINGFACE_API_KEY;
delete process.env.HF_TOKEN;
delete process.env.AI_DEFAULT_MODEL;
delete process.env.AI_BACKUP_MODEL;
delete process.env.AI_ENABLED;

const ADMIN_TOKEN = "audit-admin-token-123456";
const RC_API_BASE = "https://api.revenuecat.test/v1";
const userA = "a1".repeat(20);
const tokenA = "1".repeat(64);
const userB = "b2".repeat(20);
const tokenB = "2".repeat(64);
const rcPlusUser = userB;

type ProviderMode = "ok" | "error" | "timeout" | "invalid-json" | "empty";
let providerMode: ProviderMode = "ok";
let providerDelayMs = 0;
let providerCalls = 0;
let rcRequested: string[] = [];

const realFetch = globalThis.fetch;

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const abortError = () => {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
};

(globalThis as any).fetch = async (input: any, init?: any): Promise<Response> => {
  const url = typeof input === "string" ? input : input?.url || "";

  if (url.startsWith(`${RC_API_BASE}/subscribers/`)) {
    const id = decodeURIComponent(url.slice(`${RC_API_BASE}/subscribers/`.length));
    rcRequested.push(id);
    if (id === rcPlusUser) {
      const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
      return json(200, {
        subscriber: {
          entitlements: {
            plus: {
              product_identifier: "serene_plus_monthly",
              purchase_date: new Date().toISOString(),
              expires_date: expires,
            },
          },
          subscriptions: { serene_plus_monthly: { expires_date: expires } },
          management_url: "https://example.test/manage",
        },
      });
    }
    return json(200, { subscriber: {} });
  }

  if (!url.includes("/chat/completions")) return realFetch(input, init);

  providerCalls += 1;
  if (providerDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, providerDelayMs));
  }

  if (providerMode === "timeout") {
    const signal = init?.signal as AbortSignal | undefined;
    return await new Promise<Response>((_resolve, reject) => {
      const onAbort = () => reject(abortError());
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  if (providerMode === "error") return json(503, { error: "provider unavailable" });
  if (providerMode === "invalid-json") {
    return new Response("{not valid json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (providerMode === "empty") return json(200, { choices: [] });

  return json(200, {
    choices: [{ message: { content: "Audit reply." } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });
};

const credits = await import("../server/ai/credits");
const routes = await import("../server/ai/routes");
const admin = await import("../server/ai/admin");
const billingRoutes = await import("../server/billing/routes");
const usage = await import("../server/ai/usage");
const overrides = await import("../server/ai/overrides");
const auth = await import("../server/auth");

fs.rmSync(path.join(workdir, "data", "ai-settings.json"), { force: true });
overrides.resetOverridesCache();

const app = express();
app.use("/api/ai/admin", express.json({ limit: "32kb" }), admin.default);
app.use("/api/billing", express.json({ limit: "128kb" }), billingRoutes.default);
app.use("/api/ai", express.json({ limit: "3mb" }), routes.default);
const listener = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => listener.once("listening", () => resolve()));
const port = (listener.address() as AddressInfo).port;
const aiUrl = `http://127.0.0.1:${port}/api/ai`;
const adminUrl = `${aiUrl}/admin`;
const billingUrl = `http://127.0.0.1:${port}/api/billing`;

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

const adminHeaders = {
  Authorization: `Bearer ${ADMIN_TOKEN}`,
  "Content-Type": "application/json",
};

const register = (userId: string, token: string) =>
  call(`${aiUrl}/credits/register`, {
    method: "POST",
    headers: walletHeaders(userId, token),
    body: JSON.stringify({ userId, token }),
  });

const chat = (userId: string, token: string, requestId: string, message = "Audit message.") =>
  call(`${aiUrl}/chat`, {
    method: "POST",
    headers: { ...walletHeaders(userId, token), "x-ai-request-id": requestId },
    body: JSON.stringify({ message, history: [], context: {} }),
  });

const summary = (userId: string, token: string) =>
  call(`${aiUrl}/credits`, { headers: walletHeaders(userId, token) });

const history = (userId: string, token: string) =>
  call(`${aiUrl}/credits/history`, { headers: walletHeaders(userId, token) });

const overview = () => call(`${adminUrl}/overview`, { headers: adminHeaders });

const resetLedger = () => {
  fs.rmSync(path.join(workdir, "data", "ai-usage.json"), { force: true });
  usage.resetLedgerCache();
  providerCalls = 0;
  providerMode = "ok";
  providerDelayMs = 0;
};

const resetCredits = () => {
  fs.rmSync(path.join(workdir, "data", "ai-credits.json"), { force: true });
  credits.resetCreditsCache();
};

const baseLimits = {
  monthlyBudgetAud: 1000,
  monthlyHardLimitAud: 1000,
  dailyLimitAud: 1000,
  requestsPerDay: 100000,
  tokensPerDay: 100000000,
  requestsPerDayPerUser: 100000,
  tokensPerDayPerUser: 100000000,
  costPerMonthPerUserUsd: 1000,
};

const setLimits = async (limits: Partial<typeof baseLimits> = {}) => {
  const response = await call(`${adminUrl}/settings`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ limits: { ...baseLimits, ...limits } }),
  });
  if (response.status !== 200) {
    throw new Error(`Could not set limits: ${JSON.stringify(response.body)}`);
  }
};

const configureCredits = async (freeAllocation: number) => {
  const response = await call(`${adminUrl}/credits/settings`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      actions: {
        simple_message: 1,
        daily_plan: 3,
        detailed_analysis: 5,
        complex_task: 10,
      },
      plans: {
        free: {
          creditsPerPeriod: freeAllocation,
          periodDays: 1,
          requestsPerDay: 100000,
          tokensPerDay: 100000000,
          memoryLimit: 6,
          historyLimit: 8,
          historyCharLimit: 4000,
          maxAttachments: 0,
          advancedFeatures: false,
        },
      },
    }),
  });
  if (response.status !== 200) {
    throw new Error(`Could not configure credits: ${JSON.stringify(response.body)}`);
  }
};

const model = {
  id: "audit-model",
  provider: "freebuff" as const,
  label: "Audit model",
  price: { inputPerMillion: 0, outputPerMillion: 1000, source: "audit" },
  capabilities: { streaming: true, tools: true, structuredOutputs: true },
};

const auditData = path.join(workdir, "data", "ai-credits.json");
const readCreditStore = (): any => JSON.parse(fs.readFileSync(auditData, "utf8"));

try {
  // ---------------------------------------------------------------- concurrency
  resetLedger();
  resetCredits();
  await configureCredits(3);
  await setLimits();
  await register(userA, tokenA);
  providerMode = "ok";
  providerDelayMs = 75;
  providerCalls = 0;

  const concurrentIds = Array.from(
    { length: 6 },
    (_, index) => `audit-concurrent-${String(index).padStart(3, "0")}`,
  );
  const concurrent = await Promise.all(
    concurrentIds.map((id) => chat(userA, tokenA, id, `Concurrent message ${id}`)),
  );
  const concurrentOk = concurrent.filter((entry) => entry.status === 200).length;
  const concurrentRejected = concurrent.filter(
    (entry) => entry.status === 402 && entry.body?.code === "insufficient_credits",
  ).length;
  check(
    "six simultaneous requests cannot overspend three credits",
    concurrentOk === 3 && concurrentRejected === 3,
    { statuses: concurrent.map((entry) => entry.status), bodies: concurrent.map((entry) => entry.body?.code) },
  );
  check("only successful concurrent requests reach the provider", providerCalls === 3, providerCalls);

  const concurrentSummary = await summary(userA, tokenA);
  check(
    "concurrent spending leaves a zero balance, never a negative one",
    concurrentSummary.body?.credits?.balance === 0,
    concurrentSummary.body?.credits,
  );
  check(
    "concurrent usage matches exactly three deductions",
    concurrentSummary.body?.credits?.periodCreditsUsed === 3,
    concurrentSummary.body?.credits?.periodCreditsUsed,
  );

  const concurrentHistory = (await history(userA, tokenA)).body?.history || [];
  check("concurrent history has one row per successful request", concurrentHistory.length === 3, concurrentHistory.length);
  check(
    "every concurrent transaction belongs to the requesting user",
    concurrentHistory.every((entry: any) => entry.userId === userA),
    concurrentHistory.map((entry: any) => entry.userId),
  );
  check(
    "concurrent history has no duplicate request ids",
    new Set(concurrentHistory.map((entry: any) => entry.requestId)).size === 3,
  );
  check(
    "concurrent history records exactly the deducted credits",
    concurrentHistory.every((entry: any) => entry.status === "succeeded" && entry.credits === 1),
    concurrentHistory,
  );

  const concurrentStore = readCreditStore();
  const concurrentRequests = Object.values(concurrentStore.requests).filter(
    (entry: any) => entry.userId === userA,
  ) as any[];
  check(
    "concurrent reservation ledger has exactly three settled requests",
    concurrentRequests.length === 3 &&
      concurrentRequests.every((entry) => entry.status === "succeeded"),
    concurrentRequests,
  );
  check(
    "concurrent account balance matches allocation minus settled credits",
    concurrentStore.accounts[userA].balance ===
      concurrentStore.accounts[userA].allocated - concurrentHistory.reduce((sum: number, entry: any) => sum + entry.credits, 0),
    concurrentStore.accounts[userA],
  );

  // Duplicate request ids: one reservation, one settlement, one charge.
  resetLedger();
  resetCredits();
  await configureCredits(3);
  await setLimits();
  const duplicateUser = "d3".repeat(20);
  const duplicateToken = "3".repeat(64);
  await register(duplicateUser, duplicateToken);
  providerMode = "ok";
  providerDelayMs = 100;
  providerCalls = 0;
  const duplicateId = "audit-duplicate-0001";
  const duplicatePair = await Promise.all([
    chat(duplicateUser, duplicateToken, duplicateId, "First in-flight request"),
    chat(duplicateUser, duplicateToken, duplicateId, "Duplicate in-flight request"),
  ]);
  const duplicateStatuses = duplicatePair.map((entry) => entry.status).sort();
  check(
    "a duplicate concurrent request is rejected while the original runs",
    duplicateStatuses[0] === 200 && duplicateStatuses[1] === 409,
    duplicatePair.map((entry) => entry.body),
  );
  const duplicateRejection = duplicatePair.find((entry) => entry.status === 409);
  check(
    "the duplicate rejection identifies an in-flight or completed request",
    duplicateRejection?.body?.code === "request_in_progress" ||
      duplicateRejection?.body?.code === "duplicate_request",
    duplicateRejection?.body,
  );
  const duplicateRetry = await chat(duplicateUser, duplicateToken, duplicateId, "Retry after settlement");
  check(
    "retrying a settled request is refused as a duplicate",
    duplicateRetry.status === 409 && duplicateRetry.body?.code === "duplicate_request",
    duplicateRetry.body,
  );
  check("a duplicate request reaches the provider only once", providerCalls === 1, providerCalls);
  const duplicateSummary = await summary(duplicateUser, duplicateToken);
  check(
    "a duplicate request cannot cause a second deduction",
    duplicateSummary.body?.credits?.balance === 2 &&
      duplicateSummary.body?.credits?.periodCreditsUsed === 1,
    duplicateSummary.body?.credits,
  );
  const duplicateHistory = (await history(duplicateUser, duplicateToken)).body?.history || [];
  check(
    "duplicate request history contains one successful charge",
    duplicateHistory.length === 1 &&
      duplicateHistory[0]?.status === "succeeded" &&
      duplicateHistory[0]?.credits === 1,
    duplicateHistory,
  );

  // ------------------------------------------------------------ global budgets
  resetLedger();
  resetCredits();
  await configureCredits(100);
  await setLimits({ dailyLimitAud: 0.18, monthlyBudgetAud: 1000, monthlyHardLimitAud: 1000 });
  const budgetUser = "e4".repeat(20);
  const budgetToken = "4".repeat(64);
  await register(budgetUser, budgetToken);
  providerMode = "ok";
  providerDelayMs = 0;
  providerCalls = 0;

  const dailyAttempts = [];
  for (let index = 0; index < 3; index += 1) {
    dailyAttempts.push(await chat(budgetUser, budgetToken, `audit-daily-${index}`, `Daily budget ${index}`));
  }
  check(
    "daily spending limit allows requests below the ceiling",
    dailyAttempts[0]?.status === 200 && dailyAttempts[1]?.status === 200,
    dailyAttempts.map((entry) => entry.status),
  );
  check(
    "daily spending limit rejects the request that would exceed it",
    dailyAttempts[2]?.status === 429 && dailyAttempts[2]?.body?.code === "daily-budget",
    dailyAttempts[2],
  );
  check("daily budget rejection never reaches the provider", providerCalls === 2, providerCalls);
  const dailySummary = await summary(budgetUser, budgetToken);
  check("daily budget rejection is refunded", dailySummary.body?.credits?.balance === 98, dailySummary.body?.credits);
  const dailyUsage = usage.summariseUsage();
  check(
    "daily budget ledger records the actual provider cost",
    Math.abs((dailyUsage.today.costAud || 0) - 0.155) < 1e-9,
    dailyUsage.today,
  );

  resetLedger();
  resetCredits();
  await configureCredits(100);
  await setLimits({ dailyLimitAud: 1000, monthlyBudgetAud: 0.18, monthlyHardLimitAud: 0.18 });
  await register(budgetUser, budgetToken);
  providerCalls = 0;
  const monthlyAttempts = [];
  for (let index = 0; index < 3; index += 1) {
    monthlyAttempts.push(await chat(budgetUser, budgetToken, `audit-monthly-${index}`, `Monthly budget ${index}`));
  }
  check(
    "monthly spending limit allows requests below the hard ceiling",
    monthlyAttempts[0]?.status === 200 && monthlyAttempts[1]?.status === 200,
    monthlyAttempts.map((entry) => entry.status),
  );
  check(
    "monthly hard limit rejects the next request",
    monthlyAttempts[2]?.status === 429 && monthlyAttempts[2]?.body?.code === "monthly-budget",
    monthlyAttempts[2],
  );
  check("monthly budget rejection never reaches the provider", providerCalls === 2, providerCalls);
  check(
    "monthly budget rejection is refunded",
    (await summary(budgetUser, budgetToken)).body?.credits?.balance === 98,
  );

  // Two requests reserve at once: only one reservation fits under the ceiling.
  resetLedger();
  resetCredits();
  await configureCredits(100);
  await setLimits({ dailyLimitAud: 0.18, monthlyBudgetAud: 1000, monthlyHardLimitAud: 1000 });
  await register(budgetUser, budgetToken);
  providerMode = "ok";
  providerDelayMs = 150;
  providerCalls = 0;
  const simultaneousSpend = await Promise.all([
    chat(budgetUser, budgetToken, "audit-budget-race-1", "Race one"),
    chat(budgetUser, budgetToken, "audit-budget-race-2", "Race two"),
  ]);
  const raceOk = simultaneousSpend.filter((entry) => entry.status === 200).length;
  const raceRejected = simultaneousSpend.filter((entry) => entry.status === 429).length;
  check(
    "simultaneous requests cannot both reserve the same remaining budget",
    raceOk === 1 && raceRejected === 1,
    simultaneousSpend.map((entry) => entry.body),
  );
  check("only one race request reaches the provider", providerCalls === 1, providerCalls);
  const postRace = await chat(budgetUser, budgetToken, "audit-budget-race-3", "After release");
  check(
    "the released reservation allows a subsequent request",
    postRace.status === 200,
    postRace.body,
  );

  // 75% warning and monthly hard alert.
  resetLedger();
  await setLimits({ dailyLimitAud: 1000, monthlyBudgetAud: 0.2, monthlyHardLimitAud: 0.3 });
  usage.recordUsage({ model, inputTokens: 0, outputTokens: 0, costUsd: 0.14 / 1.55, costAud: 0.14 });
  let budgetOverview = (await overview()).body;
  check(
    "below 75% does not raise the budget warning",
    !budgetOverview?.budget?.alerts?.some((alert: any) => alert.code === "budget-75"),
    budgetOverview?.budget?.alerts,
  );
  usage.recordUsage({ model, inputTokens: 0, outputTokens: 0, costUsd: 0.01 / 1.55, costAud: 0.01 });
  budgetOverview = (await overview()).body;
  check(
    "75% raises the monthly budget warning",
    budgetOverview?.budget?.percentageUsed === 0.75 &&
      budgetOverview?.budget?.alerts?.some((alert: any) => alert.code === "budget-75"),
    budgetOverview?.budget,
  );
  check(
    "the 75% warning is displayed in AUD",
    budgetOverview?.budget?.alerts?.some(
      (alert: any) => alert.code === "budget-75" && /A\$/.test(alert.message),
    ),
    budgetOverview?.budget?.alerts,
  );
  usage.recordUsage({ model, inputTokens: 0, outputTokens: 0, costUsd: 0.1 / 1.55, costAud: 0.1 });
  budgetOverview = (await overview()).body;
  check(
    "below the hard limit has no critical monthly alert",
    !budgetOverview?.budget?.alerts?.some((alert: any) => alert.code === "monthly-limit"),
    budgetOverview?.budget?.alerts,
  );
  usage.recordUsage({ model, inputTokens: 0, outputTokens: 0, costUsd: 0.05 / 1.55, costAud: 0.05 });
  budgetOverview = (await overview()).body;
  check(
    "reaching the hard limit raises a critical monthly alert",
    budgetOverview?.budget?.alerts?.some((alert: any) => alert.code === "monthly-limit"),
    budgetOverview?.budget?.alerts,
  );

  // Exhausted budgets reject before the provider and refund the wallet.
  resetLedger();
  resetCredits();
  await configureCredits(100);
  await setLimits({ dailyLimitAud: 1000, monthlyBudgetAud: 0.18, monthlyHardLimitAud: 0.18 });
  await register(budgetUser, budgetToken);
  usage.recordUsage({ model, inputTokens: 0, outputTokens: 0, costUsd: 0.18 / 1.55, costAud: 0.18 });
  providerCalls = 0;
  const monthlyExhausted = await chat(budgetUser, budgetToken, "audit-exhausted-monthly", "Exhausted month");
  check(
    "an exhausted monthly hard limit rejects the request",
    monthlyExhausted.status === 429 && monthlyExhausted.body?.code === "monthly-budget",
    monthlyExhausted.body,
  );
  check("an exhausted monthly budget never reaches the provider", providerCalls === 0, providerCalls);
  check(
    "an exhausted monthly budget refunds the wallet",
    (await summary(budgetUser, budgetToken)).body?.credits?.balance === 100,
  );

  resetLedger();
  await setLimits({ dailyLimitAud: 0.18, monthlyBudgetAud: 1000, monthlyHardLimitAud: 1000 });
  usage.recordUsage({ model, inputTokens: 0, outputTokens: 0, costUsd: 0.18 / 1.55, costAud: 0.18 });
  providerCalls = 0;
  const dailyExhausted = await chat(budgetUser, budgetToken, "audit-exhausted-daily", "Exhausted day");
  check(
    "an exhausted daily limit rejects the request",
    dailyExhausted.status === 429 && dailyExhausted.body?.code === "daily-budget",
    dailyExhausted.body,
  );
  check("an exhausted daily budget never reaches the provider", providerCalls === 0, providerCalls);

  // ----------------------------------------------------------- failed requests
  resetLedger();
  resetCredits();
  await configureCredits(100);
  await setLimits();
  const failureUser = "f5".repeat(20);
  const failureToken = "5".repeat(64);
  await register(failureUser, failureToken);
  providerDelayMs = 0;
  providerCalls = 0;

  for (const mode of ["error", "invalid-json", "empty", "timeout"] as ProviderMode[]) {
    providerMode = mode;
    const response = await chat(failureUser, failureToken, `audit-failure-${mode}`, `Failure mode ${mode}`);
    check(`${mode} provider failure returns an error`, response.status >= 500, response.status);
    check(
      `${mode} provider failure is reported as provider_failed`,
      response.body?.code === "provider_failed",
      response.body,
    );
  }
  providerMode = "ok";
  check("all failure attempts reached the provider", providerCalls === 4, providerCalls);
  const failedSummary = await summary(failureUser, failureToken);
  check(
    "provider, timeout and malformed failures consume no credits",
    failedSummary.body?.credits?.balance === 100,
    failedSummary.body?.credits,
  );
  const failedHistory = (await history(failureUser, failureToken)).body?.history || [];
  check(
    "failed requests are recorded without charged credits",
    failedHistory.length === 4 &&
      failedHistory.every((entry: any) => entry.status === "failed" && entry.credits === 0),
    failedHistory,
  );
  const failedUsage = usage.summariseUsage();
  check("failed requests record no provider cost", failedUsage.totals.costAud === 0, failedUsage.totals);
  check("failed requests are counted", failedUsage.totals.failedRequests === 4, failedUsage.totals);

  const successAfterFailures = await chat(failureUser, failureToken, "audit-failure-success", "Successful retry");
  check("a request succeeds after provider failures", successAfterFailures.status === 200, successAfterFailures.body);
  check(
    "a successful request records its actual USD cost",
    Math.abs((successAfterFailures.body?.usage?.costUsd || 0) - 0.05) < 1e-9,
    successAfterFailures.body?.usage,
  );
  check(
    "a successful request records its actual AUD cost",
    Math.abs((successAfterFailures.body?.usage?.costAud || 0) - 0.0775) < 1e-9,
    successAfterFailures.body?.usage,
  );
  const successSummary = await summary(failureUser, failureToken);
  check("a successful request deducts one credit", successSummary.body?.credits?.balance === 99, successSummary.body?.credits);
  const successOverview = (await overview()).body;
  const successLog = successOverview?.usage?.recentRequests?.find(
    (entry: any) => entry.requestId === "audit-failure-success",
  );
  check("the successful request log records cost", Math.abs((successLog?.costAud || 0) - 0.0775) < 1e-9, successLog);
  check(
    "failed request logs record zero cost",
    successOverview?.usage?.recentRequests
      ?.filter((entry: any) => entry.status === "failed")
      .every((entry: any) => entry.costAud === 0),
    successOverview?.usage?.recentRequests,
  );

  // ---------------------------------------------------------------- user security
  resetLedger();
  resetCredits();
  await configureCredits(100);
  await setLimits();
  await register(userA, tokenA);
  await register(userB, tokenB);
  const plusB = await call(`${adminUrl}/credits/plan`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ userId: userB, plan: "plus" }),
  });
  check("the audit can prepare a Plus account for isolation checks", plusB.status === 200, plusB.body);

  let securityResponse = await call(`${aiUrl}/credits`, {
    method: "POST",
    headers: walletHeaders(userA, tokenA),
    body: JSON.stringify({ balance: 99999 }),
  });
  check("a wallet cannot write its own balance", securityResponse.status === 404, securityResponse.status);

  securityResponse = await call(`${aiUrl}/credits/register`, {
    method: "POST",
    headers: walletHeaders(userA, tokenA),
    body: JSON.stringify({
      userId: userA,
      token: tokenA,
      balance: 99999,
      plan: "plus",
      subscriptionStatus: "active",
    }),
  });
  check(
    "registration ignores client-supplied plan and balance fields",
    securityResponse.status === 200 &&
      securityResponse.body?.credits?.plan?.id === "free" &&
      securityResponse.body?.credits?.balance === 100,
    securityResponse.body,
  );

  securityResponse = await call(`${aiUrl}/credits/status`, {
    method: "POST",
    headers: walletHeaders(userA, tokenA),
    body: JSON.stringify({ status: "active" }),
  });
  check("there is no wallet route to change subscription status", securityResponse.status === 404, securityResponse.status);

  securityResponse = await call(`${adminUrl}/credits/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: userA, plan: "plus" }),
  });
  check("admin plan changes require the admin token", securityResponse.status === 401, securityResponse.status);

  securityResponse = await call(`${adminUrl}/credits/plan`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" },
    body: JSON.stringify({ userId: userA, plan: "plus" }),
  });
  check("a wallet credential cannot impersonate the admin token", securityResponse.status === 401, securityResponse.status);

  securityResponse = await call(`${adminUrl}/credits/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: userA, status: "canceled" }),
  });
  check("admin subscription changes require the admin token", securityResponse.status === 401, securityResponse.status);

  securityResponse = await call(`${adminUrl}/credits/status`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" },
    body: JSON.stringify({ userId: userA, status: "canceled" }),
  });
  check("a wallet credential cannot change subscription status", securityResponse.status === 401, securityResponse.status);
  check(
    "security attempts leave the wallet Free",
    (await summary(userA, tokenA)).body?.credits?.plan?.id === "free",
  );

  rcRequested = [];
  securityResponse = await call(`${billingUrl}/revenuecat/sync`, {
    method: "POST",
    headers: walletHeaders(userA, tokenA),
    body: JSON.stringify({ customerId: userB, plan: "plus", status: "active" }),
  });
  check(
    "a wallet cannot attach another RevenueCat customer id",
    securityResponse.status === 200 &&
      securityResponse.body?.verification?.plan === "free" &&
      rcRequested.length === 1 &&
      rcRequested[0] === userA,
    { response: securityResponse.body, requested: rcRequested },
  );
  check(
    "the other RevenueCat customer was never queried",
    !rcRequested.includes(userB),
    rcRequested,
  );
  check(
    "the wallet remains Free after the attach attempt",
    (await summary(userA, tokenA)).body?.credits?.plan?.id === "free",
  );

  rcRequested = [];
  securityResponse = await call(`${billingUrl}/revenuecat/sync`, {
    method: "POST",
    headers: { ...walletHeaders(userA, tokenA), "x-serene-user": userB },
    body: JSON.stringify({ customerId: userB }),
  });
  check(
    "a spoofed wallet header cannot change the sync identity",
    securityResponse.status === 200 && rcRequested.length === 1 && rcRequested[0] === userA,
    { response: securityResponse.body, requested: rcRequested },
  );
  check("the spoofed wallet is never queried", !rcRequested.includes(userB), rcRequested);

  securityResponse = await call(`${billingUrl}/revenuecat/link`, {
    method: "POST",
    headers: walletHeaders(userA, tokenA),
    body: JSON.stringify({ customerId: userB }),
  });
  check("there is no browser route to link a RevenueCat customer", securityResponse.status === 404, securityResponse.status);

  providerMode = "ok";
  const privateRequest = await chat(userA, tokenA, "audit-private-usage", "Private usage request");
  check("the owner can make a request for usage isolation", privateRequest.status === 200, privateRequest.body);

  securityResponse = await call(`${aiUrl}/usage?userId=${userB}`, {
    headers: walletHeaders(userA, tokenA),
  });
  check(
    "the usage route ignores a foreign user id in the query string",
    securityResponse.status === 200 &&
      securityResponse.body?.user?.today?.requests === 1,
    securityResponse.body?.user,
  );

  securityResponse = await call(`${aiUrl}/status?userId=${userB}`, {
    headers: walletHeaders(userA, tokenA),
  });
  check(
    "the status route reports only the authenticated caller's usage",
    securityResponse.status === 200 &&
      securityResponse.body?.user?.today?.requests === 1,
    securityResponse.body?.user,
  );

  securityResponse = await call(`${aiUrl}/usage`, {
    headers: { "x-serene-user": userB },
  });
  check(
    "a user hash alone cannot read personal usage",
    securityResponse.status === 200 &&
      securityResponse.body?.user === null &&
      !securityResponse.body?.usage?.byUser,
    securityResponse.body,
  );

  securityResponse = await call(`${aiUrl}/status`, {
    headers: { "x-serene-user": userB },
  });
  check(
    "a user hash alone cannot read personal status",
    securityResponse.status === 200 && securityResponse.body?.user === null,
    securityResponse.body,
  );

  securityResponse = await call(`${aiUrl}/usage`, {
    headers: { "x-serene-user": userB, "x-serene-credit-token": tokenA },
  });
  check(
    "wallet headers cannot attach another user's usage",
    securityResponse.status === 200 &&
      securityResponse.body?.user === null &&
      !securityResponse.body?.usage?.byUser,
    securityResponse.body,
  );

  const publicStatus = await call(`${aiUrl}/status`);
  check(
    "public status withholds per-user ledger detail",
    publicStatus.status === 200 &&
      !publicStatus.body?.usage?.byUser &&
      !publicStatus.body?.usage?.recentRequests,
    publicStatus.body?.usage,
  );
  const publicUsage = await call(`${aiUrl}/usage`);
  check(
    "public usage withholds per-user ledger detail",
    publicUsage.status === 200 &&
      !publicUsage.body?.usage?.byUser &&
      !publicUsage.body?.usage?.recentRequests,
    publicUsage.body?.usage,
  );

  securityResponse = await call(`${adminUrl}/credits/usage/${userB}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  check(
    "a wallet credential cannot read another user's admin usage detail",
    securityResponse.status === 401,
    securityResponse.status,
  );

  const scopedHistory = (await history(userA, tokenA)).body?.history || [];
  check(
    "credit history is scoped to the authenticated wallet",
    scopedHistory.length === 1 && scopedHistory.every((entry: any) => entry.userId === userA),
    scopedHistory,
  );

  // ----------------------------------------------------------- data consistency
  resetLedger();
  resetCredits();
  await configureCredits(10);
  await setLimits();
  const consistencyUser = "c6".repeat(20);
  const consistencyToken = "6".repeat(64);
  await register(consistencyUser, consistencyToken);
  providerMode = "ok";
  providerDelayMs = 0;
  providerCalls = 0;

  const consistencySuccesses = [];
  for (let index = 0; index < 3; index += 1) {
    consistencySuccesses.push(
      await chat(
        consistencyUser,
        consistencyToken,
        `audit-consistency-${index}`,
        `Consistency success ${index}`,
      ),
    );
  }
  providerMode = "error";
  const consistencyFailure = await chat(
    consistencyUser,
    consistencyToken,
    "audit-consistency-failure",
    "Consistency failure",
  );
  providerMode = "ok";

  check(
    "consistency scenario records three successes and one failure",
    consistencySuccesses.every((entry) => entry.status === 200) &&
      consistencyFailure.status >= 500,
    {
      successes: consistencySuccesses.map((entry) => entry.status),
      failure: consistencyFailure.status,
    },
  );
  const consistencySummary = await summary(consistencyUser, consistencyToken);
  check(
    "credit balance matches the allocation minus successful charges",
    consistencySummary.body?.credits?.balance === 7 &&
      consistencySummary.body?.credits?.periodCreditsUsed === 3,
    consistencySummary.body?.credits,
  );
  const consistencyHistory = (await history(consistencyUser, consistencyToken)).body?.history || [];
  check("consistency history contains every request outcome", consistencyHistory.length === 4, consistencyHistory.length);
  check(
    "every credit transaction has the correct user id",
    consistencyHistory.every((entry: any) => entry.userId === consistencyUser),
    consistencyHistory,
  );
  check(
    "credit history has no duplicate transactions",
    new Set(consistencyHistory.map((entry: any) => entry.requestId)).size === 4,
  );
  check(
    "credit history sums to the balance change",
    consistencyHistory
      .filter((entry: any) => entry.status === "succeeded")
      .reduce((sum: number, entry: any) => sum + entry.credits, 0) === 3 &&
      consistencyHistory
        .filter((entry: any) => entry.status === "failed")
        .every((entry: any) => entry.credits === 0),
    consistencyHistory,
  );
  check(
    "no credit request is left pending",
    consistencyHistory.every((entry: any) => entry.status !== "pending"),
    consistencyHistory,
  );

  const consistencyStore = readCreditStore();
  const consistencyRequests = Object.values(consistencyStore.requests).filter(
    (entry: any) => entry.userId === consistencyUser,
  ) as any[];
  check(
    "credit reservation ledger has no pending or foreign rows",
    consistencyRequests.length === 4 &&
      consistencyRequests.every(
        (entry) => entry.userId === consistencyUser && entry.status !== "pending",
      ),
    consistencyRequests,
  );
  check(
    "stored account balance is consistent with its transactions",
    consistencyStore.accounts[consistencyUser].balance === 7 &&
      consistencyStore.accounts[consistencyUser].periodCreditsUsed === 3,
    consistencyStore.accounts[consistencyUser],
  );

  const consistencyUsage = usage.summariseUsage();
  const consistencyLogs = consistencyUsage.recentRequests.filter(
    (entry: any) => entry.userId === consistencyUser,
  );
  check("usage log contains every request outcome", consistencyLogs.length === 4, consistencyLogs.length);
  check(
    "every usage transaction has the correct user id",
    consistencyLogs.every((entry: any) => entry.userId === consistencyUser),
    consistencyLogs,
  );
  check(
    "usage log has no duplicate request ids",
    new Set(consistencyLogs.map((entry: any) => entry.requestId)).size === 4,
  );
  check(
    "successful usage records the actual provider cost",
    consistencyLogs
      .filter((entry: any) => entry.status === "success")
      .every(
        (entry: any) =>
          Math.abs((entry.costUsd || 0) - 0.05) < 1e-9 &&
          Math.abs((entry.costAud || 0) - 0.0775) < 1e-9,
      ),
    consistencyLogs,
  );
  check(
    "failed usage records zero cost",
    consistencyLogs
      .filter((entry: any) => entry.status === "failed")
      .every((entry: any) => entry.costUsd === 0 && entry.costAud === 0),
    consistencyLogs,
  );
  check(
    "per-user usage matches the request outcomes",
    consistencyUsage.byUser[consistencyUser]?.allTime.requests === 4 &&
      consistencyUsage.byUser[consistencyUser]?.allTime.credits === 3,
    consistencyUsage.byUser[consistencyUser],
  );
  check(
    "global usage cost matches the successful requests",
    Math.abs((consistencyUsage.totals.costAud || 0) - 0.2325) < 1e-9,
    consistencyUsage.totals,
  );
  check(
    "AUD cost is a single conversion of the recorded USD cost",
    Math.abs(
      (consistencyUsage.totals.costAud || 0) -
        Number(((consistencyUsage.totals.costUsd || 0) * 1.55).toFixed(4)),
    ) < 1e-9,
    consistencyUsage.totals,
  );

  const consistencyOverview = (await overview()).body;
  check(
    "admin usage overview exposes the same consistent totals",
    consistencyOverview?.usage?.totals?.requests === 4 &&
      consistencyOverview?.usage?.totals?.failedRequests === 1 &&
      Math.abs((consistencyOverview?.usage?.totals?.costAud || 0) - 0.2325) < 1e-9,
    consistencyOverview?.usage?.totals,
  );
} catch (error) {
  fail += 1;
  console.error("SUITE FAILED:", error);
} finally {
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  delete process.env.AI_ADMIN_TOKEN;
  console.log("");
  if (fail === 0) {
    console.log(`PASS ${pass} / ${pass + fail}`);
    console.log("AI_AUDIT_TESTS_OK");
  } else {
    console.error(`PASS ${pass} / ${pass + fail}`);
    process.exitCode = 1;
  }
  fs.rmSync(workdir, { recursive: true, force: true });
}
