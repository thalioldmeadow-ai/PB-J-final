/**
 * Phase 6.2 tests for the Supabase-backed admin overview.
 *
 * The SQL checks run the real migrations in PGlite and verify aggregate counts
 * and actual-versus-estimated spend. The HTTP checks exercise the Express admin
 * route with the break-glass credential and a mocked Supabase RPC response.
 *
 * Run with: npm run ai:admin:supabase:test
 */

import assert from "node:assert/strict";
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
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-admin-supabase-"));
process.chdir(workdir);
process.env.AI_ADMIN_TOKEN = "phase6-admin-token-123456";
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

const fixture = {
  generatedAt: "2026-11-04T03:00:00.000Z",
  source: "supabase",
  currency: "AUD",
  users: {
    total: 12,
    free: 9,
    plusActive: 3,
    activeToday: null,
    activeLast30Days: null,
    activity: {
      available: false,
      reason: "No app-activity table is populated.",
    },
  },
  ai: {
    totalRequests: 44,
    successfulRequests: 40,
    failedRequests: 4,
    creditsUsed: 88,
    actualSpendTodayAud: 1.25,
    actualSpendMonthAud: 7.5,
    estimatedSpendTodayAud: 0.3,
    estimatedSpendMonthAud: 1.4,
  },
};

const realFetch = globalThis.fetch;
let rpcMode: "ok" | "error" = "ok";
let rpcUrl = "";
globalThis.fetch = async (input: any, init?: any): Promise<Response> => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (url.includes("/rest/v1/rpc/admin_supabase_overview")) {
    rpcUrl = url;
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
  const userFree = await createUser("Free user");
  const userPlus = await createUser("Plus user");
  await rows(
    `update public.wallets
     set plan = 'plus', balance = 1000, allocated = 1000,
         period_start = now(), period_end = now() + interval '30 days',
         subscription_status = 'active', renewal_at = now() + interval '30 days',
         expires_at = now() + interval '30 days'
     where user_id = $1`,
    [userPlus],
  );
  await rows(
    `update public.subscriptions
     set plan = 'plus', status = 'active', purchased_at = now(), expires_at = now() + interval '30 days'
     where user_id = $1`,
    [userPlus],
  );
  await rows(
    `insert into public.ai_usage_events
      (user_id, request_id, provider, model, action, plan, credits, cost_aud, status, estimated_usage, created_at)
     values
      ($1, 'req-free-1', 'test', 'model-a', 'simple_message', 'free', 1, 0.10, 'success', false, now()),
      ($1, 'req-free-2', 'test', 'model-a', 'simple_message', 'free', 0, 0.00, 'failed', false, now()),
      ($1, 'req-free-3', 'test', 'model-a', 'simple_message', 'free', 2, 0.07, 'success', true, now()),
      ($2, 'req-plus-1', 'test', 'model-b', 'complex_task', 'plus', 5, 0.50, 'success', false, now())`,
    [userFree, userPlus],
  );

  const result = await one<{ overview: any }>("select public.admin_supabase_overview() as overview");
  const data = result.overview;
  check("total registered users counts profiles", Number(data.users.total) === 2, data.users);
  check("free users count current free wallets", Number(data.users.free) === 1, data.users);
  check("active Plus users use active unexpired subscriptions", Number(data.users.plusActive) === 1, data.users);
  check("active user counts are explicitly unavailable", data.users.activeToday === null && data.users.activeLast30Days === null, data.users);
  check("activity explains what is missing", data.users.activity.available === false && /activity/i.test(data.users.activity.reason), data.users.activity);
  check("total AI requests are counted", Number(data.ai.totalRequests) === 4, data.ai);
  check("successful and failed requests are separated", Number(data.ai.successfulRequests) === 3 && Number(data.ai.failedRequests) === 1, data.ai);
  check("credits used counts successful requests", Number(data.ai.creditsUsed) === 8, data.ai);
  check("actual spend excludes estimated usage", Number(data.ai.actualSpendTodayAud) === 0.6 && Number(data.ai.actualSpendMonthAud) === 0.6, data.ai);
  check("estimated spend is reported separately", Number(data.ai.estimatedSpendTodayAud) === 0.07 && Number(data.ai.estimatedSpendMonthAud) === 0.07, data.ai);

  await exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role authenticated;");
  let denied = false;
  try {
    await one("select public.admin_supabase_overview()");
  } catch {
    denied = true;
  }
  check("authenticated users cannot call the aggregate RPC", denied);
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

  let http = await call("/overview/supabase");
  check("Supabase overview requires an administrator", http.status === 401, http.status);

  http = await call("/overview/supabase", {
    headers: { Authorization: "Bearer phase6-admin-token-123456" },
  });
  check("Supabase overview returns aggregate data", http.status === 200 && http.body?.source === "supabase", http.body);
  check("Supabase overview calls the aggregate RPC", rpcUrl.endsWith("/rest/v1/rpc/admin_supabase_overview"), rpcUrl);
  check("Supabase overview returns user statistics", http.body?.users?.total === 12 && http.body?.users?.plusActive === 3, http.body?.users);
  check("Supabase overview keeps actual and estimated spend separate", http.body?.ai?.actualSpendTodayAud === 1.25 && http.body?.ai?.estimatedSpendTodayAud === 0.3, http.body?.ai);
  check("Supabase overview exposes no account identifiers", !/@|user_id|email/i.test(JSON.stringify(http.body)), http.body);

  rpcMode = "error";
  http = await call("/overview/supabase", {
    headers: { Authorization: "Bearer phase6-admin-token-123456" },
  });
  check("Supabase overview reports an upstream failure", http.status === 503 && http.body?.code === "supabase_overview_unavailable", http.body);
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
    console.log("AI_ADMIN_SUPABASE_TESTS_OK");
  } else {
    console.error(`PASS ${pass} / ${pass + fail}`);
    process.exitCode = 1;
  }
}