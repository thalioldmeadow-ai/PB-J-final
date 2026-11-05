/**
 * Phase 6.3 tests for AI usage and spending analytics.
 *
 * The SQL checks run the real migrations in PGlite, insert deterministic usage
 * and reservation fixtures, and exercise every date preset, breakdown, filter,
 * search and pagination path. The HTTP checks cover admin authentication,
 * query forwarding and upstream failure handling.
 *
 * Run with: npm run ai:admin:analytics:test
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import { PGlite } from "@electric-sql/pglite";

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

const projectRoot = process.cwd();
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-analytics-"));
process.chdir(workdir);
process.env.AI_ADMIN_TOKEN = "phase63-admin-token-123456";
process.env.SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
delete process.env.SUPABASE_ANON_KEY;

const db = new PGlite();
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[];
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
  (await rows<T>(sql, params))[0];
const exec = (sql: string) => db.exec(sql);

const bootstrap = `
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create or replace function auth.uid()
  returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

const summaryKeys = [
  "totalRequests",
  "successfulRequests",
  "failedRequests",
  "cancelledRequests",
  "cancelledAvailable",
  "cancelledReason",
  "creditsUsed",
  "actualSpendAud",
  "estimatedSpendAud",
  "recordedSpendAud",
  "actualSpendTodayAud",
  "estimatedSpendTodayAud",
  "actualSpendMonthAud",
  "estimatedSpendMonthAud",
  "reservedAud",
  "uncertainReservedAud",
  "heldReservedAud",
  "averageCostPerRequestAud",
  "averageActualCostPerRequestAud",
] as const;

const fixture = {
  generatedAt: "2026-11-04T03:00:00.000Z",
  range: {
    preset: "last7",
    from: "2026-10-29T00:00:00.000Z",
    to: "2026-11-05T00:00:00.000Z",
    timezone: "UTC",
  },
  summary: {
    totalRequests: 4,
    successfulRequests: 3,
    failedRequests: 1,
    cancelledRequests: null,
    cancelledAvailable: false,
    cancelledReason: "No cancelled status is recorded.",
    creditsUsed: 10,
    actualSpendAud: 0.7,
    estimatedSpendAud: 0.3,
    recordedSpendAud: 1,
    actualSpendTodayAud: 0.2,
    estimatedSpendTodayAud: 0.3,
    actualSpendMonthAud: 0.7,
    estimatedSpendMonthAud: 0.3,
    reservedAud: 1.25,
    uncertainReservedAud: 0.4,
    heldReservedAud: 1.65,
    averageCostPerRequestAud: 0.25,
    averageActualCostPerRequestAud: 0.233333,
  },
  timeseries: [
    {
      day: "2026-11-04",
      requests: 3,
      successful: 2,
      failed: 1,
      credits: 5,
      actualCostAud: 0.2,
      estimatedCostAud: 0.3,
      costAud: 0.5,
    },
  ],
  byProvider: [],
  byModel: [],
  byAction: [],
  byUser: [],
  historyTotal: 4,
  history: [
    {
      requestId: "req-today-estimated",
      userLabel: "Alice",
      userShortId: "abcd1234",
      action: "simple_message",
      model: "gpt-a",
      provider: "openai",
      credits: 3,
      actualCostAud: 0,
      estimatedCostAud: 0.3,
      costAud: 0.3,
      status: "success",
      estimated: true,
      createdAt: "2026-11-04T01:00:00.000Z",
    },
  ],
  options: {
    providers: ["huggingface", "openai"],
    models: ["gpt-a", "model-b"],
    actions: ["complex_task", "simple_message"],
  },
};

const realFetch = globalThis.fetch;
let rpcMode: "ok" | "error" = "ok";
let rpcBody: any = null;
globalThis.fetch = async (input: any, init?: any): Promise<Response> => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (url.includes("/rest/v1/rpc/admin_ai_analytics")) {
    rpcBody = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    if (rpcMode === "error") {
      return new Response(JSON.stringify({ message: "function unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return realFetch(input, init);
};

let listener: ReturnType<express.Express["listen"]> | null = null;

try {
  await exec(bootstrap);
  const migrationDir = path.join(projectRoot, "supabase", "migrations");
  const migrations = fs.readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort();
  for (const migration of migrations) {
    await exec(fs.readFileSync(path.join(migrationDir, migration), "utf8"));
  }
  check("all migration files apply", migrations.length === 9, migrations);

  const createUser = async (label: string): Promise<string> => {
    const id = randomUUID();
    await rows(
      "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)",
      [id, `${label.toLowerCase().replace(/\s+/g, "-")}@example.test`, JSON.stringify({ display_name: label })],
    );
    return id;
  };
  const alice = await createUser("Alice");
  const bob = await createUser("Bob");

  const todayStart = "(date_trunc('day', now() at time zone 'utc') at time zone 'utc')";
  const insertUsage = async (
    userId: string,
    requestId: string,
    provider: string,
    model: string,
    action: string,
    credits: number,
    costAud: number,
    estimated: boolean,
    status: "success" | "failed",
    createdAtSql: string,
  ) =>
    rows(
      `insert into public.ai_usage_events
        (user_id, request_id, provider, model, action, plan, credits, cost_aud, estimated_usage, status, created_at)
       values ($1, $2, $3, $4, $5, 'free', $6, $7, $8, $9, ${createdAtSql})`,
      [userId, requestId, provider, model, action, credits, costAud, estimated, status],
    );

  await insertUsage(alice, "req-today-actual", "openai", "gpt-a", "simple_message", 2, 0.2, false, "success", `${todayStart} + interval '1 hour'`);
  await insertUsage(alice, "req-today-estimated", "openai", "gpt-a", "simple_message", 3, 0.3, true, "success", `${todayStart} + interval '2 hours'`);
  await insertUsage(bob, "req-today-failed", "huggingface", "model-b", "complex_task", 0, 0, false, "failed", `${todayStart} + interval '3 hours'`);
  await insertUsage(bob, "req-recent-actual", "huggingface", "model-b", "complex_task", 5, 0.5, false, "success", `${todayStart} - interval '3 days' + interval '2 hours'`);
  await insertUsage(alice, "req-old-actual", "openai", "gpt-a", "simple_message", 7, 0.7, false, "success", `${todayStart} - interval '40 days' + interval '2 hours'`);

  await rows(
    `insert into public.ai_spend_reservations
      (user_id, request_id, day_key, month_key, reserved_aud, status, expires_at)
     values
      ($1, 'reserve-live-1', to_char(now() at time zone 'utc', 'YYYY-MM-DD'), to_char(now() at time zone 'utc', 'YYYY-MM'), 1.25, 'reserved', now() + interval '10 minutes'),
      ($1, 'reserve-expired-1', to_char(now() at time zone 'utc', 'YYYY-MM-DD'), to_char(now() at time zone 'utc', 'YYYY-MM'), 9.99, 'reserved', now() - interval '10 minutes'),
      ($2, 'reserve-uncertain-1', to_char(now() at time zone 'utc', 'YYYY-MM-DD'), to_char(now() at time zone 'utc', 'YYYY-MM'), 0.40, 'uncertain', now() + interval '10 minutes'),
      ($2, 'reserve-consumed-1', to_char(now() at time zone 'utc', 'YYYY-MM-DD'), to_char(now() at time zone 'utc', 'YYYY-MM'), 5.00, 'consumed', now() + interval '10 minutes')`,
    [alice, bob],
  );

  const resolveAnalyticsRange = (await import("../server/ai/analytics")).resolveAnalyticsRange;
  const fixed = new Date("2026-11-04T10:30:00.000Z");
  const todayRange = resolveAnalyticsRange("today", undefined, undefined, fixed);
  check(
    "today preset uses UTC day boundaries",
    todayRange.from === "2026-11-04T00:00:00.000Z" && todayRange.to === "2026-11-05T00:00:00.000Z",
    todayRange,
  );
  const last7Range = resolveAnalyticsRange("last7", undefined, undefined, fixed);
  check(
    "last 7 days includes today and six prior UTC days",
    last7Range.from === "2026-10-29T00:00:00.000Z" && last7Range.to === "2026-11-05T00:00:00.000Z",
    last7Range,
  );
  const last30Range = resolveAnalyticsRange("last30", undefined, undefined, fixed);
  check(
    "last 30 days includes today and twenty-nine prior UTC days",
    last30Range.from === "2026-10-06T00:00:00.000Z" && last30Range.to === "2026-11-05T00:00:00.000Z",
    last30Range,
  );
  const monthRange = resolveAnalyticsRange("month", undefined, undefined, fixed);
  check(
    "this month preset spans the UTC calendar month",
    monthRange.from === "2026-11-01T00:00:00.000Z" && monthRange.to === "2026-12-01T00:00:00.000Z",
    monthRange,
  );
  const customRange = resolveAnalyticsRange("custom", "2026-10-01", "2026-10-03", fixed);
  check(
    "custom preset includes the whole end date",
    customRange.from === "2026-10-01T00:00:00.000Z" && customRange.to === "2026-10-04T00:00:00.000Z",
    customRange,
  );
  let badRange = false;
  try {
    resolveAnalyticsRange("custom", "2026-10-04", "2026-10-03", fixed);
  } catch {
    badRange = true;
  }
  check("custom preset rejects an inverted range", badRange);
  let badDate = false;
  try {
    resolveAnalyticsRange("custom", "2026-02-30", "2026-03-01", fixed);
  } catch {
    badDate = true;
  }
  check("custom preset rejects invalid calendar dates", badDate);

  const query = async (from: string, to: string, args: Record<string, unknown> = {}) => {
    const result = await one<{ analytics: any }>(
      `select public.admin_ai_analytics(
        $1::timestamptz, $2::timestamptz, $3::text, $4::text, $5::text, $6::text, $7::int, $8::int
      ) as analytics`,
      [
        from,
        to,
        args.provider ?? null,
        args.model ?? null,
        args.action ?? null,
        args.search ?? null,
        args.limit ?? 25,
        args.offset ?? 0,
      ],
    );
    return result.analytics;
  };

  const last30 = await query(last30Range.from, last30Range.to);
  check("summary includes every requested statistic", summaryKeys.every((key) => key in last30.summary), last30.summary);
  check("total requests count all statuses", Number(last30.summary.totalRequests) === 4, last30.summary);
  check("successful and failed requests are separated", Number(last30.summary.successfulRequests) === 3 && Number(last30.summary.failedRequests) === 1, last30.summary);
  check("cancelled requests are explicitly unavailable", last30.summary.cancelledRequests === null && last30.summary.cancelledAvailable === false, last30.summary);
  check("credits count successful requests only", Number(last30.summary.creditsUsed) === 10, last30.summary);
  check("actual spend excludes estimated usage", Number(last30.summary.actualSpendAud) === 0.7, last30.summary);
  check("estimated spend is reported separately", Number(last30.summary.estimatedSpendAud) === 0.3, last30.summary);
  check("reserved spend is not added to actual spend", Math.abs(Number(last30.summary.heldReservedAud) - 1.65) < 1e-9 && Math.abs(Number(last30.summary.actualSpendAud) - 0.7) < 1e-9, last30.summary);
  check("only unexpired reservations are counted as reserved", Math.abs(Number(last30.summary.reservedAud) - 1.25) < 1e-9, last30.summary);
  check("uncertain reservations are reported separately", Math.abs(Number(last30.summary.uncertainReservedAud) - 0.4) < 1e-9, last30.summary);
  check("average cost is derived from recorded spend", Math.abs(Number(last30.summary.averageCostPerRequestAud) - 0.25) < 1e-9, last30.summary);
  check("history total reflects all matching requests", Number(last30.historyTotal) === 4, last30.historyTotal);
  check(
    "timeseries groups by UTC day",
    last30.timeseries.length === 2 &&
      last30.timeseries.some((point: any) => point.day === "2026-11-04" && Number(point.requests) === 3),
    last30.timeseries,
  );
  check(
    "provider breakdown aggregates spend per provider",
    last30.byProvider.some((row: any) => row.provider === "huggingface" && Math.abs(Number(row.costAud) - 0.5) < 1e-9) &&
      last30.byProvider.some((row: any) => row.provider === "openai" && Math.abs(Number(row.costAud) - 0.5) < 1e-9),
    last30.byProvider,
  );
  check("model breakdown includes provider and model", last30.byModel.some((row: any) => row.provider === "openai" && row.model === "gpt-a" && Number(row.requests) === 2), last30.byModel);
  check("action breakdown groups features", last30.byAction.some((row: any) => row.action === "complex_task" && Number(row.requests) === 2), last30.byAction);
  check("user breakdown uses display names and short ids", last30.byUser.some((row: any) => row.userLabel === "Alice" && row.userShortId === alice.slice(0, 8)), last30.byUser);

  const today = await query(todayRange.from, todayRange.to);
  check("today filters out older requests", Number(today.summary.totalRequests) === 3, today.summary);
  check("today actual and estimated spend are separate", Number(today.summary.actualSpendAud) === 0.2 && Number(today.summary.estimatedSpendAud) === 0.3, today.summary);
  check("today credits count successful requests", Number(today.summary.creditsUsed) === 5, today.summary);

  const last7 = await query(last7Range.from, last7Range.to);
  check("last 7 days includes the recent request", Number(last7.summary.totalRequests) === 4, last7.summary);
  check("last 7 days excludes the 40-day-old request", !last7.history.some((row: any) => row.requestId === "req-old-actual"), last7.history);

  const month = await query(monthRange.from, monthRange.to);
  const monthExpected = await one<{ total: string }>(
    `select count(*)::text as total from public.ai_usage_events
     where created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')
       and created_at < ((date_trunc('month', now() at time zone 'utc') at time zone 'utc') + interval '1 month')`,
  );
  check("this month uses the UTC calendar month", Number(month.summary.totalRequests) === Number(monthExpected.total), { got: month.summary.totalRequests, expected: monthExpected.total });

  const custom = await query(customRange.from, customRange.to);
  check("custom range returns no unrelated requests", Number(custom.summary.totalRequests) === 0, custom.summary);
  const customRecent = await query(
    new Date(Date.parse(todayRange.from) - 3 * 86_400_000).toISOString(),
    todayRange.to,
  );
  check("custom range includes both endpoints", Number(customRecent.summary.totalRequests) === 4, customRecent.summary);

  const openai = await query(last30Range.from, last30Range.to, { provider: "openai" });
  check("provider filter narrows summary and history", Number(openai.summary.totalRequests) === 2 && openai.history.every((row: any) => row.provider === "openai"), openai);
  check("provider filter keeps actual and estimated separate", Number(openai.summary.actualSpendAud) === 0.2 && Number(openai.summary.estimatedSpendAud) === 0.3, openai.summary);

  const model = await query(last30Range.from, last30Range.to, { model: "model-b" });
  check("model filter narrows summary and history", Number(model.summary.totalRequests) === 2 && model.history.every((row: any) => row.model === "model-b"), model);

  const action = await query(last30Range.from, last30Range.to, { action: "complex_task" });
  check("feature filter narrows summary and history", Number(action.summary.totalRequests) === 2 && action.history.every((row: any) => row.action === "complex_task"), action);

  const byRequest = await query(last30Range.from, last30Range.to, { search: "req-today-estimated" });
  check("history searches by request id", Number(byRequest.historyTotal) === 1 && byRequest.history[0]?.requestId === "req-today-estimated", byRequest.history);
  const byUser = await query(last30Range.from, last30Range.to, { search: "ALICE" });
  check("history searches display names case-insensitively", Number(byUser.historyTotal) === 2, byUser.history);
  const byAction = await query(last30Range.from, last30Range.to, { search: "complex" });
  check("history searches actions", Number(byAction.historyTotal) === 2, byAction.history);
  const byModel = await query(last30Range.from, last30Range.to, { search: "model-b" });
  check("history searches models", Number(byModel.historyTotal) === 2, byModel.history);

  const pageOne = await query(last30Range.from, last30Range.to, { limit: 2, offset: 0 });
  const pageTwo = await query(last30Range.from, last30Range.to, { limit: 2, offset: 2 });
  check("history pagination returns the requested page sizes", pageOne.history.length === 2 && pageTwo.history.length === 2, { pageOne: pageOne.history.length, pageTwo: pageTwo.history.length });
  check("history pagination keeps the full matching total", pageOne.historyTotal === 4 && pageTwo.historyTotal === 4, { pageOne: pageOne.historyTotal, pageTwo: pageTwo.historyTotal });
  check("history pages do not repeat requests", pageOne.history[0].requestId !== pageTwo.history[0].requestId, { pageOne: pageOne.history, pageTwo: pageTwo.history });
  check("history is newest first", Date.parse(pageOne.history[0].createdAt) >= Date.parse(pageOne.history[1].createdAt));

  await exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role authenticated;");
  let denied = false;
  try {
    await one("select public.admin_ai_analytics($1, $2)", [last30Range.from, last30Range.to]);
  } catch {
    denied = true;
  }
  check("authenticated users cannot call analytics", denied);
  await exec("reset role;");

  const admin = await import("../server/ai/admin");
  const app = express();
  app.use("/api/ai/admin", express.json({ limit: "32kb" }), admin.default);
  listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener!.once("listening", () => resolve()));
  const origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/api/ai/admin`;

  const call = async (route: string, init?: RequestInit) => {
    const response = await realFetch(`${origin}${route}`, init);
    let body: any = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  };

  let http = await call("/analytics?preset=last7");
  check("analytics requires an administrator", http.status === 401, http.status);

  rpcBody = null;
  http = await call("/analytics?preset=last7&provider=openai&model=gpt-a&action=complex_task&search=Alice&limit=10&offset=5", {
    headers: { Authorization: "Bearer phase63-admin-token-123456" },
  });
  check("analytics returns normalized data", http.status === 200 && http.body?.summary?.totalRequests === 4, http.body);
  check("analytics keeps cancelled unavailable", http.body?.summary?.cancelledRequests === null && http.body?.summary?.cancelledAvailable === false, http.body?.summary);
  check("analytics preserves actual versus estimated spend", http.body?.summary?.actualSpendAud === 0.7 && http.body?.summary?.estimatedSpendAud === 0.3, http.body?.summary);
  check("analytics exposes filter options", http.body?.filters?.options?.providers?.length === 2 && http.body?.filters?.options?.actions?.length === 2, http.body?.filters);
  check("analytics forwards every filter to the RPC", rpcBody?.p_provider === "openai" && rpcBody?.p_model === "gpt-a" && rpcBody?.p_action === "complex_task" && rpcBody?.p_search === "Alice" && rpcBody?.p_limit === 10 && rpcBody?.p_offset === 5, rpcBody);
  check("analytics uses a UTC range", http.body?.range?.timezone === "UTC" && typeof rpcBody?.p_start === "string" && typeof rpcBody?.p_end === "string", { range: http.body?.range, rpc: rpcBody });
  check("analytics response has no account identifiers", !/@|user_id|email/i.test(JSON.stringify(http.body)), http.body);

  http = await call("/analytics?preset=not-a-preset", {
    headers: { Authorization: "Bearer phase63-admin-token-123456" },
  });
  check("analytics rejects an invalid preset", http.status === 400 && http.body?.code === "bad_analytics_preset", http.body);

  http = await call("/analytics?preset=custom", {
    headers: { Authorization: "Bearer phase63-admin-token-123456" },
  });
  check("analytics rejects a missing custom range", http.status === 400 && http.body?.code === "bad_custom_date", http.body);

  rpcMode = "error";
  http = await call("/analytics?preset=last7", {
    headers: { Authorization: "Bearer phase63-admin-token-123456" },
  });
  check("analytics reports an unavailable RPC", http.status === 503 && http.body?.code === "analytics_unavailable", http.body);
} catch (error) {
  fail += 1;
  console.error("SUITE FAILED:", error);
} finally {
  if (listener) await new Promise<void>((resolve) => listener!.close(() => resolve()));
  globalThis.fetch = realFetch;
  await db.close();
  fs.rmSync(workdir, { recursive: true, force: true });
  console.log("");
  if (fail === 0) {
    console.log(`PASS ${pass} / ${pass + fail}`);
    console.log("AI_ADMIN_ANALYTICS_TESTS_OK");
  } else {
    console.error(`PASS ${pass} / ${pass + fail}`);
    process.exitCode = 1;
  }
}