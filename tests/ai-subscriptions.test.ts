/**
 * System tests for subscription tiers and backend entitlements.
 *
 * Run with: npm run ai:subscriptions:test
 *
 * The test deliberately sends Plus-only requests directly to the HTTP route,
 * exactly as a modified frontend would, so the checks prove the server refuses
 * them rather than relying on hidden buttons.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
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

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-subs-"));
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
process.env.AI_REQUESTS_PER_MINUTE = "1000";
process.env.AI_REQUESTS_PER_DAY = "100000";
process.env.AI_REQUESTS_PER_DAY_PER_CLIENT = "100000";
process.env.AI_REQUESTS_PER_DAY_PER_USER = "100000";
process.env.AI_TOKENS_PER_DAY = "100000000";
process.env.AI_TOKENS_PER_DAY_PER_USER = "100000000";
process.env.AI_COST_PER_MONTH_USD = "1000";
process.env.AI_COST_PER_MONTH_PER_USER_USD = "1000";
process.env.AI_ADMIN_TOKEN = "subscription-admin-token-123456";
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_ENABLED;
delete process.env.HUGGINGFACE_API_KEY;
delete process.env.AI_DEFAULT_MODEL;
delete process.env.AI_BACKUP_MODEL;
delete process.env.AI_ENABLED;

const realFetch = globalThis.fetch;
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
  return json(200, {
    choices: [{ message: { content: "A short, useful answer." } }],
    usage: { prompt_tokens: 40, completion_tokens: 20 },
  });
};

const freeUser = "c".repeat(40);
const freeToken = "4".repeat(64);
const legacyUser = "d".repeat(40);
const legacyToken = "5".repeat(64);
const limitsUser = "e".repeat(40);
const limitsToken = "6".repeat(64);

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

const adminHeaders = {
  Authorization: "Bearer subscription-admin-token-123456",
  "Content-Type": "application/json",
};

const chat = (
  userId: string,
  token: string,
  requestId: string,
  extra: Record<string, unknown> = {},
) =>
  call(`${aiUrl}/chat`, {
    method: "POST",
    headers: { ...walletHeaders(userId, token), "x-ai-request-id": requestId },
    body: JSON.stringify({
      message: "Help me plan a calm Tuesday.",
      history: [],
      context: {},
      ...extra,
    }),
  });

const summary = (userId: string, token: string) =>
  call(`${aiUrl}/credits`, { headers: walletHeaders(userId, token) });

const planBody = (requestsPerDay: number) => ({
  plans: {
    free: {
      creditsPerPeriod: 100,
      periodDays: 1,
      requestsPerDay,
      tokensPerDay: 60000,
      memoryLimit: 3,
      historyLimit: 8,
      historyCharLimit: 4000,
      maxAttachments: 0,
      advancedFeatures: false,
    },
  },
});

try {
  // --- automatic Free tier -------------------------------------------------

  let response = await call(`${aiUrl}/credits/register`, {
    method: "POST",
    headers: walletHeaders(freeUser, freeToken),
    body: JSON.stringify({ userId: freeUser, token: freeToken }),
  });
  check("registration creates a Free subscription", response.status === 200 && response.body?.credits?.subscription?.tier === "free", response.body);
  check("Free starts active", response.body?.credits?.subscription?.status === "active");
  check("Free stores a start date", Boolean(response.body?.credits?.subscription?.startedAt));
  check("Free stores a renewal date", Boolean(response.body?.credits?.subscription?.renewalAt));
  check("Free stores an expiry date", Boolean(response.body?.credits?.subscription?.expiresAt));
  check("Free has 100 credits", response.body?.credits?.balance === 100 && response.body?.credits?.total === 100);
  check("Free has standard AI access", response.body?.credits?.entitlements?.tier === "free");
  check("Free has basic memory", response.body?.credits?.entitlements?.memoryLimit === 6);
  check("Free has no advanced AI features", response.body?.credits?.entitlements?.advancedFeatures === false);
  check("Free lists its benefits", response.body?.credits?.benefits?.some((entry: string) => /Basic AI memory/.test(entry)));
  const freeStart = Date.parse(response.body?.credits?.periodStart);
  const freeEnd = Date.parse(response.body?.credits?.periodEnd);
  check("Free renews daily", (freeEnd - freeStart) / 86_400_000 >= 0.9 && (freeEnd - freeStart) / 86_400_000 < 1.1);

  // --- backend blocks a Plus-only feature for Free -------------------------

  const freeAttachment = [
    {
      name: "notes.txt",
      mime: "text/plain",
      size: 11,
      kind: "file",
      text: "hello world",
    },
  ];
  response = await chat(freeUser, freeToken, "sub-free-attachment-01", {
    attachments: freeAttachment,
  });
  check("Free cannot use Plus attachments through the API", response.status === 403 && response.body?.code === "plus_required", response.body);
  check("blocked attachment is not charged", (await summary(freeUser, freeToken)).body?.credits?.balance === 100);
  check("blocked attachment never reaches the provider", providerCalls === 0, providerCalls);

  // --- Free request limits are enforced server-side ------------------------

  const manyMemory = Array.from({ length: 20 }, (_, index) => `Preference number ${index} about mornings.`);
  const manyHistory = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `Earlier turn ${index} about routines.`,
  }));
  response = await chat(freeUser, freeToken, "sub-free-limits-01", {
    memory: manyMemory,
    history: manyHistory,
  });
  check("Free request succeeds within its limits", response.status === 200, response.status);
  check("Free memory is capped by the server", response.body?.shared?.memoryCount <= 6, response.body?.shared);
  check("Free history is capped by the server", response.body?.shared?.historyTurns <= 8, response.body?.shared);

  // --- upgrade to Plus -----------------------------------------------------

  response = await call(`${adminUrl}/credits/plan`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ userId: freeUser, plan: "plus" }),
  });
  check("admin can upgrade an account to Plus", response.status === 200, response.body);
  const upgraded = response.body?.credits?.accounts?.find((account: any) => account.userId === freeUser);
  check("Plus is stored as the current tier", upgraded?.plan === "plus", upgraded);
  check("Plus has the higher allocation", upgraded?.balance === 1000 && upgraded?.total === 1000, upgraded);
  check("Plus is active after assignment", upgraded?.subscriptionStatus === "active");

  response = await summary(freeUser, freeToken);
  check("Plus reports extended memory", response.body?.credits?.entitlements?.memoryLimit === 30, response.body?.credits?.entitlements);
  check("Plus reports higher request limits", response.body?.credits?.entitlements?.requestsPerDay === 120);
  check("Plus reports advanced features", response.body?.credits?.entitlements?.advancedFeatures === true);
  check("Plus allows attachments", response.body?.credits?.entitlements?.maxAttachments === 4);
  check("Plus lists its benefits", response.body?.credits?.benefits?.some((entry: string) => /Extended AI memory/.test(entry)));
  const plusStart = Date.parse(response.body?.credits?.periodStart);
  const plusEnd = Date.parse(response.body?.credits?.periodEnd);
  check("Plus renews monthly", (plusEnd - plusStart) / 86_400_000 >= 29 && (plusEnd - plusStart) / 86_400_000 < 31);

  // --- Plus can use the advanced feature ----------------------------------

  response = await chat(freeUser, freeToken, "sub-plus-attachment-01", {
    attachments: freeAttachment,
  });
  check("Plus can use an attachment through the API", response.status === 200, response.body);
  check("Plus attachment uses the complex action price", response.body?.credits?.balance === 990, response.body?.credits?.balance);

  response = await chat(freeUser, freeToken, "sub-plus-limits-01", {
    memory: manyMemory,
    history: manyHistory,
  });
  check("Plus accepts more saved notes", response.body?.shared?.memoryCount === 20, response.body?.shared);
  check("Plus accepts more conversation history", response.body?.shared?.historyTurns === 20, response.body?.shared);

  // --- inactive Plus loses Plus entitlements but keeps the account ----------

  response = await call(`${adminUrl}/credits/status`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ userId: freeUser, status: "canceled" }),
  });
  check("admin can mark a subscription inactive", response.status === 200, response.body);
  response = await summary(freeUser, freeToken);
  check("inactive Plus reports its status", response.body?.credits?.subscription?.status === "canceled");
  check("inactive Plus falls back to Free limits", response.body?.credits?.entitlements?.tier === "free");
  response = await chat(freeUser, freeToken, "sub-canceled-attachment-01", {
    attachments: freeAttachment,
  });
  check("inactive Plus cannot use Plus attachments", response.status === 403 && response.body?.code === "plus_required", response.body);

  await call(`${adminUrl}/credits/status`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ userId: freeUser, status: "active" }),
  });

  // --- admin-configurable tier limits -------------------------------------

  response = await call(`${adminUrl}/credits/settings`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify(planBody(2)),
  });
  check("admin can change Free request limits", response.status === 200, response.body);
  const configuredFree = response.body?.credits?.config?.plans?.find((plan: any) => plan.id === "free");
  check("configured Free limits are persisted", configuredFree?.requestsPerDay === 2 && configuredFree?.memoryLimit === 3, configuredFree);

  response = await call(`${aiUrl}/credits/register`, {
    method: "POST",
    headers: walletHeaders(limitsUser, limitsToken),
    body: JSON.stringify({ userId: limitsUser, token: limitsToken }),
  });
  check("a new Free account uses the configured limits", response.body?.credits?.entitlements?.requestsPerDay === 2, response.body?.credits?.entitlements);

  const limited = [];
  for (let index = 0; index < 3; index += 1) {
    limited.push(await chat(limitsUser, limitsToken, `sub-limit-${index}`, { message: `Limit message ${index}` }));
  }
  check("Free request limit allows the configured number", limited[0]?.status === 200 && limited[1]?.status === 200, limited.map((entry) => entry.status));
  check("Free request limit blocks the next request", limited[2]?.status === 429 && limited[2]?.body?.code === "user-daily-requests", limited[2]?.body);

  // --- existing version-1 wallet migrates without losing history ----------

  const storeFile = path.join(workdir, "data", "ai-credits.json");
  const raw = JSON.parse(fs.readFileSync(storeFile, "utf8"));
  raw.version = 1;
  raw.accounts[legacyUser] = {
    userId: legacyUser,
    tokenHash: createHash("sha256").update(legacyToken).digest("hex"),
    plan: "free",
    balance: 0,
    allocated: 100,
    periodCreditsUsed: 100,
    periodStart: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    periodEnd: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    createdAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  raw.history.unshift({
    id: "legacy-history-row",
    userId: legacyUser,
    action: "simple_message",
    actionLabel: "Simple AI message",
    credits: 1,
    createdAt: new Date().toISOString(),
    status: "succeeded",
    requestId: "legacy-request-row",
    plan: "free",
  });
  fs.writeFileSync(storeFile, JSON.stringify(raw));
  credits.resetCreditsCache();

  response = await summary(legacyUser, legacyToken);
  check("old Free wallets are migrated", response.status === 200, response.status);
  check("migration preserves the wallet", response.body?.credits?.subscription?.tier === "free");
  check("migration refreshes the Free allowance", response.body?.credits?.balance === 100, response.body?.credits?.balance);
  check("migration keeps credit history", response.body?.credits ? (await call(`${aiUrl}/credits/history`, { headers: walletHeaders(legacyUser, legacyToken) })).body?.history?.some((entry: any) => entry.id === "legacy-history-row") : false);
} catch (error) {
  fail += 1;
  console.error("SUITE FAILED:", error);
} finally {
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  delete process.env.AI_ADMIN_TOKEN;
  console.log("");
  if (fail === 0) {
    console.log(`PASS ${pass} / ${pass + fail}`);
    console.log("AI_SUBSCRIPTION_TESTS_OK");
  } else {
    console.error(`PASS ${pass} / ${pass + fail}`);
    process.exitCode = 1;
  }
  fs.rmSync(workdir, { recursive: true, force: true });
}
