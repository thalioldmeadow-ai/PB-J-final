/**
 * System tests for per-request AI usage and cost analytics.
 *
 * Run with: npm run ai:usage:test
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

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-usage-"));
process.chdir(workdir);
process.env.NODE_ENV = "test";

process.env.FREEBUFF_API_KEY = "test-freebuff-key-value";
process.env.FREEBUFF_ENABLED = "true";
process.env.FREEBUFF_MODEL = "test-model";
process.env.FREEBUFF_MODELS = "test-model";
process.env.FREEBUFF_INPUT_PRICE_PER_MILLION = "2";
process.env.FREEBUFF_OUTPUT_PRICE_PER_MILLION = "4";
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
process.env.AI_ADMIN_TOKEN = "usage-admin-token-123456";
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_ENABLED;
delete process.env.HUGGINGFACE_API_KEY;
delete process.env.AI_DEFAULT_MODEL;
delete process.env.AI_BACKUP_MODEL;
delete process.env.AI_ENABLED;

const realFetch = globalThis.fetch;
let mode: "reported" | "no-usage" | "fail" = "reported";
const SECRET = "PRIVATE_PROMPT_SHOULD_NEVER_APPEAR_8421";

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

(globalThis as any).fetch = async (input: any, init?: any): Promise<Response> => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (!url.includes("/chat/completions")) return realFetch(input, init);
  if (mode === "fail") return json(503, { error: "provider unavailable" });
  if (mode === "no-usage") {
    return json(200, { choices: [{ message: { content: "No usage block from this provider." } }] });
  }
  return json(200, {
    choices: [{ message: { content: "A reported-usage answer." } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });
};

const freeUser = "f".repeat(40);
const freeToken = "7".repeat(64);
const plusUser = "9".repeat(40);
const plusToken = "8".repeat(64);

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
  Authorization: "Bearer usage-admin-token-123456",
  "Content-Type": "application/json",
};

const chat = (userId: string, token: string, requestId: string, body: Record<string, unknown> = {}) =>
  call(`${aiUrl}/chat`, {
    method: "POST",
    headers: { ...walletHeaders(userId, token), "x-ai-request-id": requestId },
    body: JSON.stringify({
      message: `Help me plan my Tuesday ${SECRET}`,
      history: [],
      context: {},
      ...body,
    }),
  });

const register = (userId: string, token: string) =>
  call(`${aiUrl}/credits/register`, {
    method: "POST",
    headers: walletHeaders(userId, token),
    body: JSON.stringify({ userId, token }),
  });

try {
  await register(freeUser, freeToken);
  await register(plusUser, plusToken);
  await call(`${adminUrl}/credits/plan`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ userId: plusUser, plan: "plus" }),
  });

  // Provider-reported success.
  let response = await chat(freeUser, freeToken, "usage-free-success");
  check("reported-usage request succeeds", response.status === 200);
  check("provider-reported input tokens are exact", response.body?.usage?.inputTokens === 100, response.body?.usage);
  check("provider-reported output tokens are exact", response.body?.usage?.outputTokens === 50, response.body?.usage);
  check("reported usage is not marked estimated", response.body?.usage?.estimated === false);

  // Failed provider attempt: must be logged, refunded and never charged.
  mode = "fail";
  response = await chat(freeUser, freeToken, "usage-free-failure");
  check("failed request returns an error", response.status >= 500, response.status);
  mode = "reported";
  response = await call(`${aiUrl}/credits`, { headers: walletHeaders(freeUser, freeToken) });
  check("failed request is refunded", response.body?.credits?.balance === 99, response.body?.credits?.balance);

  // No provider usage block: never invent tokens from message length.
  mode = "no-usage";
  response = await chat(freeUser, freeToken, "usage-free-no-usage");
  check("no-usage reply succeeds", response.status === 200);
  check("missing provider usage is not estimated", response.body?.usage?.inputTokens === 0 && response.body?.usage?.outputTokens === 0);
  check("missing provider usage is marked estimated", response.body?.usage?.estimated === true);

  // Plus action with an attachment, so plan and action analytics both have data.
  mode = "reported";
  response = await chat(plusUser, plusToken, "usage-plus-attachment", {
    attachments: [{ name: "notes.txt", mime: "text/plain", size: 5, kind: "file", text: "hello" }],
  });
  check("Plus attachment request succeeds", response.status === 200);

  const overview = await call(`${adminUrl}/overview`, { headers: adminHeaders });
  const usage = overview.body?.usage;
  check("admin overview includes all-time requests", usage?.totals?.requests === 4, usage?.totals);
  check("admin overview includes all-time credits", usage?.totals?.credits === 12, usage?.totals);
  check("admin overview includes failed requests", usage?.totals?.failedRequests === 1, usage?.totals);
  check("admin overview includes total API cost", Math.abs((usage?.totals?.costUsd || 0) - 0.0008) < 1e-9, usage?.totals?.costUsd);
  check("admin overview includes daily cost", Math.abs((usage?.today?.costUsd || 0) - 0.0008) < 1e-9, usage?.today?.costUsd);
  check("admin overview includes monthly cost", Math.abs((usage?.thisMonth?.costUsd || 0) - 0.0008) < 1e-9, usage?.thisMonth?.costUsd);
  check("admin overview includes total AUD cost", Math.abs((usage?.totals?.costAud || 0) - 0.0012) < 1e-9, usage?.totals?.costAud);
  check("admin overview includes daily AUD cost", Math.abs((usage?.today?.costAud || 0) - 0.0012) < 1e-9, usage?.today?.costAud);
  check("admin overview includes monthly AUD cost", Math.abs((usage?.thisMonth?.costAud || 0) - 0.0012) < 1e-9, usage?.thisMonth?.costAud);
  check("average cost per request is derived", Math.abs((usage?.totals?.averageCostPerRequest || 0) - 0.0002) < 1e-9, usage?.totals?.averageCostPerRequest);
  check("average cost per user is derived", Math.abs((usage?.totals?.averageCostPerUser || 0) - 0.0004) < 1e-9, usage?.totals?.averageCostPerUser);
  check("average AUD cost per request is derived", Math.abs((usage?.totals?.averageCostPerRequestAud || 0) - 0.0003) < 1e-9, usage?.totals?.averageCostPerRequestAud);
  check("average AUD cost per user is derived", Math.abs((usage?.totals?.averageCostPerUserAud || 0) - 0.0006) < 1e-9, usage?.totals?.averageCostPerUserAud);
  check("most expensive actions includes complex task", usage?.byAction?.complex_task?.costUsd > 0);
  check("most expensive actions includes AUD cost", usage?.byAction?.complex_task?.costAud > 0);
  check("admin budget is labelled AUD", overview.body?.budget?.currency === "AUD", overview.body?.budget);
  check(
    "admin budget reads AUD spend directly",
    overview.body?.budget?.currentMonthAud === usage?.thisMonth?.costAud,
    { budget: overview.body?.budget?.currentMonthAud, ledger: usage?.thisMonth?.costAud },
  );
  check(
    "AUD usage is converted once at the exposed rate",
    Math.abs((usage?.totals?.costAud || 0) - Number(((usage?.totals?.costUsd || 0) * 1.55).toFixed(4))) < 1e-9,
    { aud: usage?.totals?.costAud, usd: usage?.totals?.costUsd },
  );
  check("most active users includes both users", Object.keys(usage?.byUser || {}).length === 2, usage?.byUser);
  check("free versus plus usage is separated", usage?.byPlan?.free?.requests === 3 && usage?.byPlan?.plus?.requests === 1, usage?.byPlan);
  check("failed request is in the per-request log", usage?.recentRequests?.some((entry: any) => entry.requestId === "usage-free-failure" && entry.status === "failed"));

  const successLog = usage?.recentRequests?.find((entry: any) => entry.requestId === "usage-free-success");
  check("request log records provider", successLog?.provider === "freebuff", successLog);
  check("request log records model", successLog?.model === "test-model");
  check("request log records action", successLog?.action === "simple_message");
  check("request log records plan", successLog?.plan === "free");
  check("request log records total tokens", successLog?.totalTokens === 150, successLog);
  check("request log records credits", successLog?.credits === 1, successLog);
  check("request log records cost", Math.abs((successLog?.costUsd || 0) - 0.0004) < 1e-9, successLog?.costUsd);
  check("request log records AUD cost", Math.abs((successLog?.costAud || 0) - 0.00062) < 1e-9, successLog?.costAud);
  check("request log records duration", typeof successLog?.durationMs === "number");
  check("request log records timestamp", typeof successLog?.timestamp === "string");
  check("request log records success", successLog?.status === "success");

  const noUsageLog = usage?.recentRequests?.find((entry: any) => entry.requestId === "usage-free-no-usage");
  check("no-usage request stores zero tokens", noUsageLog?.inputTokens === 0 && noUsageLog?.outputTokens === 0);
  check("no-usage request is flagged estimated", noUsageLog?.estimatedUsage === true);

  const failedLog = usage?.recentRequests?.find((entry: any) => entry.requestId === "usage-free-failure");
  check("failed request stores zero credits", failedLog?.credits === 0, failedLog);
  check("failed request stores zero API cost", failedLog?.costUsd === 0, failedLog);
  check("failed request has failed status", failedLog?.status === "failed");

  const serialised = JSON.stringify(overview.body);
  check("admin payload never contains the prompt", !serialised.includes(SECRET));
  check("request log has no prompt or reply fields", usage?.recentRequests?.every((entry: any) => !("message" in entry) && !("reply" in entry) && !("context" in entry)));
  check("request log has no account email", !serialised.includes("@"));

  response = await call(`${adminUrl}/credits/usage/${freeUser}`, { headers: adminHeaders });
  check("admin can load one user's usage", response.status === 200, response.status);
  check("user detail has subscription tier", response.body?.account?.plan === "free", response.body?.account);
  check("user detail has remaining credits", response.body?.account?.balance === 98, response.body?.account);
  check("user detail has total requests", response.body?.usage?.allTime?.requests === 3, response.body?.usage?.allTime);
  check("user detail has credits used", response.body?.usage?.allTime?.credits === 2, response.body?.usage?.allTime);
  check("user detail has estimated expenditure", Math.abs((response.body?.usage?.allTime?.costUsd || 0) - 0.0004) < 1e-9);
  check("user detail has request history", response.body?.usage?.requests?.length === 3, response.body?.usage?.requests?.length);
  check("user detail history is scoped", response.body?.usage?.requests?.every((entry: any) => entry.userId === freeUser));

  response = await call(`${adminUrl}/credits/usage/not-a-user`, { headers: adminHeaders });
  check("user detail validates user ids", response.status === 400, response.status);
} catch (error) {
  fail += 1;
  console.error("SUITE FAILED:", error);
} finally {
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  delete process.env.AI_ADMIN_TOKEN;
  console.log("");
  if (fail === 0) {
    console.log(`PASS ${pass} / ${pass + fail}`);
    console.log("AI_USAGE_TESTS_OK");
  } else {
    console.error(`PASS ${pass} / ${pass + fail}`);
    process.exitCode = 1;
  }
  fs.rmSync(workdir, { recursive: true, force: true });
}
