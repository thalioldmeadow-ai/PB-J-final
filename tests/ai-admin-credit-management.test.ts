/**
 * Phase 6.4 administrator credit-management tests.
 *
 * The database checks run the real migration chain in PGlite and exercise the
 * service-role RPCs that back the dashboard. The HTTP checks run the real
 * Express admin router with Supabase mocked at the fetch boundary.
 *
 * Run with: npm run ai:admin:credit:test
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
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-credit-admin-"));
process.chdir(workdir);
process.env.AI_ADMIN_TOKEN = "phase64-admin-token-123456";
process.env.SUPABASE_URL = "https://phase64-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "phase64-service-role-key";
delete process.env.SUPABASE_ANON_KEY;

const db = new PGlite();
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[];
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
  (await rows<T>(sql, params))[0];
const exec = (sql: string) => db.exec(sql);
const asRoot = () => exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
const asService = () =>
  exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role service_role;");
const asUser = (userId: string) =>
  exec(`reset role; select set_config('request.jwt.claim.sub', '${userId}', false); set role authenticated;`);
const requestId = () => `req-${randomUUID().replace(/-/g, "").slice(0, 18)}`;

const expectReject = async (name: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
    check(name, false);
  } catch {
    check(name, true);
  }
};

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

try {
  await exec(bootstrap);
  const migrationDir = path.join(projectRoot, "supabase", "migrations");
  const migrations = fs.readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort();
  for (const migration of migrations) {
    await exec(fs.readFileSync(path.join(migrationDir, migration), "utf8"));
  }
  check("all migration files apply", migrations.length === 9, migrations);

  const createUser = async (label: string): Promise<string> => {
    await asRoot();
    const id = randomUUID();
    await rows("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)", [
      id,
      `${label.toLowerCase()}-${id.slice(0, 8)}@example.test`,
      JSON.stringify({ display_name: label }),
    ]);
    return id;
  };
  const wallet = async (userId: string) =>
    one<{ balance: string; allocated: string; plan: string }>(
      "select balance, allocated, plan from public.wallets where user_id = $1",
      [userId],
    );
  const management = async (search: string | null = null) =>
    (await one<{ data: any }>("select public.admin_credit_management($1::text, 25, 0) as data", [search])).data;
  const detail = async (userId: string) =>
    (await one<{ data: any }>("select public.admin_credit_user_detail($1::uuid, 50) as data", [userId])).data;
  const settings = async (
    actions: Record<string, number>,
    plans: Record<string, { creditsPerPeriod: number; periodDays: number }>,
    actorType: "admin_user" | "break_glass",
    adminUserId: string | null,
    actorId: string,
    req: string,
  ) =>
    (
      await one<{ data: any }>(
        `select public.admin_credit_settings_update(
          $1::uuid, $2::text, $3::text, $4::jsonb, $5::jsonb, $6::text
        ) as data`,
        [adminUserId, actorType, actorId, JSON.stringify(actions), JSON.stringify(plans), req],
      )
    ).data;
  const adjust = async (
    actorType: "admin_user" | "break_glass",
    adminUserId: string | null,
    actorId: string,
    userId: string,
    delta: number,
    reason: string,
    req: string,
  ) =>
    (
      await one<{ data: any }>(
        `select public.admin_credit_adjustment(
          $1::uuid, $2::text, $3::text, $4::uuid, $5::numeric, $6::text, $7::text
        ) as data`,
        [adminUserId, actorType, actorId, userId, delta, reason, req],
      )
    ).data;

  const alice = await createUser("Alice");
  const bob = await createUser("Bob");
  const spender = await createUser("Spender");
  const admin = await createUser("Admin");
  await asRoot();
  await rows("insert into public.admin_users (user_id) values ($1)", [admin]);
  await asService();

  const initial = await management();
  const initialCosts = Object.fromEntries(initial.config.actions.map((action: any) => [action.key, Number(action.cost)]));
  const initialPlans = Object.fromEntries(
    initial.config.plans.map((plan: any) => [plan.id, { credits: Number(plan.creditsPerPeriod), days: Number(plan.periodDays) }]),
  );
  check(
    "credit management exposes the seeded action costs",
    initialCosts.simple_message === 1 &&
      initialCosts.daily_plan === 3 &&
      initialCosts.detailed_analysis === 5 &&
      initialCosts.complex_task === 10,
    initialCosts,
  );
  check(
    "credit management exposes the seeded allocations and frequencies",
    initialPlans.free.credits === 100 &&
      initialPlans.free.days === 1 &&
      initialPlans.plus.credits === 1000 &&
      initialPlans.plus.days === 30,
    initialPlans,
  );
  check("credit management reports wallets and totals", initial.total >= 4 && initial.summary.wallets >= 4, initial.summary);

  const aliceRecord = (await management("Alice")).users.find((user: any) => user.userId === alice);
  const byShortId = (await management(alice.slice(0, 8))).users;
  check(
    "wallet search matches display names",
    Boolean(aliceRecord) && aliceRecord.balance === 100 && aliceRecord.plan === "free",
    aliceRecord,
  );
  check("wallet search matches a UUID prefix", byShortId.some((user: any) => user.userId === alice), byShortId);

  const oldReserveReq = requestId();
  await one("select * from public.reserve_credits($1, $2, 'simple_message')", [spender, oldReserveReq]);
  const oldTransaction = await one<any>(
    "select credits_delta, balance_before, balance_after from public.credit_transactions where user_id = $1 and request_id = $2 and kind = 'reserve'",
    [spender, oldReserveReq],
  );
  check(
    "a historical spend is recorded before settings change",
    Number(oldTransaction.credits_delta) === -1 &&
      Number(oldTransaction.balance_before) === 100 &&
      Number(oldTransaction.balance_after) === 99,
    oldTransaction,
  );

  const settingsReq = requestId();
  const updatedConfig = await settings(
    { simple_message: 2, complex_task: 11 },
    { free: { creditsPerPeriod: 120, periodDays: 2 }, plus: { creditsPerPeriod: 1500, periodDays: 31 } },
    "admin_user",
    admin,
    admin,
    settingsReq,
  );
  const afterSettings = await management();
  const afterCosts = Object.fromEntries(afterSettings.config.actions.map((action: any) => [action.key, Number(action.cost)]));
  const afterPlans = Object.fromEntries(
    afterSettings.config.plans.map((plan: any) => [plan.id, { credits: Number(plan.creditsPerPeriod), days: Number(plan.periodDays) }]),
  );
  check(
    "administrators can change action costs",
    afterCosts.simple_message === 2 && afterCosts.complex_task === 11 && afterCosts.daily_plan === 3,
    afterCosts,
  );
  check(
    "administrators can change allocations and allocation frequency",
    afterPlans.free.credits === 120 && afterPlans.free.days === 2 && afterPlans.plus.credits === 1500 && afterPlans.plus.days === 31,
    afterPlans,
  );
  check("settings return the normalized configuration", Number(updatedConfig.plans.find((plan: any) => plan.id === "free").creditsPerPeriod) === 120, updatedConfig);
  check("existing wallet balances are not topped up by an allocation change", Number((await wallet(alice)).balance) === 100, await wallet(alice));
  check("existing allocated balances are unchanged by a plan edit", Number((await wallet(alice)).allocated) === 100, await wallet(alice));
  const oldTransactionAfter = await one<any>(
    "select credits_delta, balance_before, balance_after from public.credit_transactions where user_id = $1 and request_id = $2 and kind = 'reserve'",
    [spender, oldReserveReq],
  );
  check(
    "price changes do not rewrite historical transactions",
    Number(oldTransactionAfter.credits_delta) === -1 &&
      Number(oldTransactionAfter.balance_before) === 100 &&
      Number(oldTransactionAfter.balance_after) === 99,
    oldTransactionAfter,
  );
  const settingsAudit = await one<any>(
    "select actor_type, admin_user_id, action, metadata from public.admin_audit_log where action = 'credits.settings.change' order by created_at desc limit 1",
  );
  check(
    "settings changes are audited with the administrator and before/after values",
    settingsAudit.actor_type === "admin_user" &&
      settingsAudit.admin_user_id === admin &&
      settingsAudit.metadata?.before?.actions?.simple_message?.cost === 1 &&
      settingsAudit.metadata?.after?.actions?.simple_message === 2,
    settingsAudit,
  );

  const newUser = await createUser("New After Settings");
  check("a new wallet uses the updated allocation", Number((await wallet(newUser)).balance) === 120, await wallet(newUser));

  const addReq = requestId();
  const added = await adjust("admin_user", admin, admin, alice, 25, "Goodwill credit for a support issue", addReq);
  check(
    "an administrator can add credits with before and after balances",
    added.duplicate === false && Number(added.balanceBefore) === 100 && Number(added.balanceAfter) === 125 && Number(added.balance) === 125,
    added,
  );
  const addTransaction = await one<any>(
    "select kind, credits_delta, balance_before, balance_after, metadata from public.credit_transactions where user_id = $1 and idempotency_key = $2",
    [alice, `admin:${addReq}`],
  );
  check(
    "an add records the reason, administrator and exact balances",
    addTransaction.kind === "admin_adjustment" &&
      Number(addTransaction.credits_delta) === 25 &&
      Number(addTransaction.balance_before) === 100 &&
      Number(addTransaction.balance_after) === 125 &&
      addTransaction.metadata?.reason === "Goodwill credit for a support issue" &&
      addTransaction.metadata?.adminUserId === admin,
    addTransaction,
  );
  const addAudit = await one<any>(
    "select actor_type, admin_user_id, target_user_id, metadata from public.admin_audit_log where action = 'credits.adjust' and target_user_id = $1 order by created_at desc limit 1",
    [alice],
  );
  check(
    "an add writes an administrator audit row",
    addAudit.actor_type === "admin_user" &&
      addAudit.admin_user_id === admin &&
      addAudit.target_user_id === alice &&
      Number(addAudit.metadata?.delta) === 25,
    addAudit,
  );

  const addedAgain = await adjust("admin_user", admin, admin, alice, 25, "Goodwill credit for a support issue", addReq);
  const duplicateTransactions = await one<{ count: string }>(
    "select count(*)::text as count from public.credit_transactions where user_id = $1 and idempotency_key = $2",
    [alice, `admin:${addReq}`],
  );
  const duplicateAudits = await one<{ count: string }>(
    "select count(*)::text as count from public.admin_audit_log where action = 'credits.adjust' and target_user_id = $1",
    [alice],
  );
  check(
    "a repeated request is idempotent and does not duplicate the adjustment",
    addedAgain.duplicate === true &&
      Number(addedAgain.balanceAfter) === 125 &&
      Number(duplicateTransactions.count) === 1 &&
      Number(duplicateAudits.count) === 1,
    { addedAgain, duplicateTransactions, duplicateAudits },
  );

  const removeReq = requestId();
  const removed = await adjust("admin_user", admin, admin, alice, -30, "Correction after duplicate grant", removeReq);
  check(
    "an administrator can remove credits without going negative",
    removed.duplicate === false && Number(removed.balanceBefore) === 125 && Number(removed.balanceAfter) === 95,
    removed,
  );
  const beforeNegative = await wallet(alice);
  await expectReject("a removal cannot take a balance below zero", () =>
    adjust("admin_user", admin, admin, alice, -1000, "Attempted over-removal", requestId()),
  );
  check("a rejected removal leaves the balance unchanged", (await wallet(alice)).balance === beforeNegative.balance, {
    before: beforeNegative,
    after: await wallet(alice),
  });
  await expectReject("an adjustment requires a reason", () =>
    adjust("admin_user", admin, admin, alice, 1, "x", requestId()),
  );
  const aliceFinal = await detail(alice);
  check(
    "user detail returns current totals and recent transactions",
    Number(aliceFinal.user.balance) === 95 &&
      aliceFinal.user.totalReceivedCredits >= 125 &&
      aliceFinal.transactions.length === 2 &&
      aliceFinal.transactions.every((transaction: any) => transaction.reason),
    aliceFinal,
  );

  const breakGlassReq = requestId();
  const breakGlass = await adjust(
    "break_glass",
    null,
    "break_glass:phase64test",
    bob,
    5,
    "Emergency support credit",
    breakGlassReq,
  );
  const breakGlassAudit = await one<any>(
    "select actor_type, admin_user_id, actor_id, target_user_id from public.admin_audit_log where action = 'credits.adjust' and target_user_id = $1 order by created_at desc limit 1",
    [bob],
  );
  check(
    "the break-glass administrator path is supported and audited",
    Number(breakGlass.balanceAfter) === 105 &&
      breakGlassAudit.actor_type === "break_glass" &&
      breakGlassAudit.admin_user_id === null &&
      breakGlassAudit.actor_id === "break_glass:phase64test",
    breakGlassAudit,
  );
  await expectReject("an unknown administrator actor cannot adjust credits", () =>
    adjust("admin_user", randomUUID(), randomUUID(), bob, 1, "Unauthorized attempt", requestId()),
  );

  await asUser(alice);
  await expectReject("an authenticated normal user cannot read credit management", () =>
    one("select public.admin_credit_management(null, 25, 0)"),
  );
  await expectReject("an authenticated normal user cannot call the adjustment RPC", () =>
    one(
      "select public.admin_credit_adjustment(null, 'break_glass', 'user-attempt', $1::uuid, 1, 'Unauthorized', $2::text)",
      [alice, requestId()],
    ),
  );
  await asRoot();

  const overviewFixture = {
    generatedAt: "2026-11-04T03:00:00.000Z",
    source: "supabase",
    config: {
      actions: [
        { key: "simple_message", label: "Simple AI message", description: "A short reply.", cost: 2 },
        { key: "daily_plan", label: "Daily plan generation", description: "A plan.", cost: 3 },
      ],
      plans: [
        {
          id: "free",
          label: "Free",
          creditsPerPeriod: 120,
          periodDays: 2,
          requestsPerDay: 20,
          tokensPerDay: 60000,
          memoryLimit: 6,
          historyLimit: 8,
          historyCharLimit: 4000,
          maxAttachments: 0,
          advancedFeatures: false,
        },
      ],
      updatedAt: "2026-11-04T02:00:00.000Z",
    },
    summary: { wallets: 4, heldCredits: 395, allocatedCredits: 500, totalSpentCredits: 105 },
    total: 1,
    users: [
      {
        userId: alice,
        userShortId: alice.slice(0, 8),
        displayName: "Alice",
        plan: "free",
        planLabel: "Free",
        subscriptionStatus: "active",
        balance: 95,
        allocated: 125,
        totalReceivedCredits: 125,
        totalSpentCredits: 30,
        transactionCount: 2,
        periodCreditsUsed: 0,
        periodStart: "2026-11-04T00:00:00.000Z",
        periodEnd: "2026-11-06T00:00:00.000Z",
        renewalAt: "2026-11-06T00:00:00.000Z",
        expiresAt: "2026-11-06T00:00:00.000Z",
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-04T00:00:00.000Z",
        lastUsedAt: null,
      },
    ],
  };
  const detailFixture = {
    generatedAt: "2026-11-04T03:00:00.000Z",
    user: overviewFixture.users[0],
    transactions: [
      {
        id: randomUUID(),
        kind: "admin_adjustment",
        creditsDelta: -30,
        balanceBefore: 125,
        balanceAfter: 95,
        reason: "Correction after duplicate grant",
        requestId: "test-remove-request",
        adminUserId: admin,
        createdAt: "2026-11-04T02:00:00.000Z",
      },
    ],
  };

  const realFetch = globalThis.fetch;
  const rpcCalls: Array<{ name: string; body: any }> = [];
  let failRpc: string | null = null;
  let failMessage = "function unavailable";
  globalThis.fetch = async (input: any, init?: any): Promise<Response> => {
    const url = typeof input === "string" ? input : input?.url || "";
    if (url.includes("/rest/v1/rpc/")) {
      const name = url.split("/rest/v1/rpc/")[1]?.split("?")[0] || "";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      rpcCalls.push({ name, body });
      if (name === failRpc) {
        return new Response(JSON.stringify({ message: failMessage }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const payload =
        name === "admin_credit_management"
          ? overviewFixture
          : name === "admin_credit_user_detail"
            ? detailFixture
            : name === "admin_credit_settings_update"
              ? overviewFixture.config
              : {
                  balance: 90,
                  balanceBefore: 95,
                  balanceAfter: 90,
                  duplicate: false,
                  transactionId: randomUUID(),
                };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return realFetch(input, init);
  };

  const adminRouter = await import("../server/ai/admin");
  const app = express();
  app.use("/api/ai/admin", express.json({ limit: "32kb" }), adminRouter.default);
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", () => resolve()));
  const origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/api/ai/admin`;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const jsonHeaders = (token: string) => ({ ...bearer(token), "Content-Type": "application/json" });
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

  try {
    let http = await call("/credits/supabase");
    check("credit management requires an administrator", http.status === 401, http.status);
    http = await call("/credits/supabase", { headers: bearer("ordinary-user-token") });
    check("an ordinary user cannot access credit management", http.status === 401, http.status);

    rpcCalls.length = 0;
    http = await call("/credits/supabase?search=Alice&limit=10&offset=5", {
      headers: bearer("phase64-admin-token-123456"),
    });
    check("credit management returns the normalized overview", http.status === 200 && http.body?.users?.[0]?.balance === 95, http.body);
    check(
      "credit management forwards search and pagination",
      rpcCalls[0]?.name === "admin_credit_management" &&
        rpcCalls[0]?.body?.p_search === "Alice" &&
        rpcCalls[0]?.body?.p_limit === 10 &&
        rpcCalls[0]?.body?.p_offset === 5,
      rpcCalls[0],
    );

    rpcCalls.length = 0;
    http = await call(`/credits/supabase/users/${alice}`, {
      headers: bearer("phase64-admin-token-123456"),
    });
    check(
      "user credit detail is returned with its transaction history",
      http.status === 200 && http.body?.user?.userId === alice && http.body?.transactions?.[0]?.reason === "Correction after duplicate grant",
      http.body,
    );
    check("user detail forwards the normalized UUID", rpcCalls[0]?.body?.p_user_id === alice, rpcCalls[0]);

    http = await call("/credits/supabase/users/not-a-uuid", {
      headers: bearer("phase64-admin-token-123456"),
    });
    check("an invalid credit user is rejected before the RPC", http.status === 400 && http.body?.code === "bad_user_id", http.body);

    rpcCalls.length = 0;
    http = await call("/credits/supabase/settings", {
      method: "POST",
      headers: jsonHeaders("phase64-admin-token-123456"),
      body: JSON.stringify({
        actions: { simple_message: 2 },
        plans: { free: { creditsPerPeriod: 120, periodDays: 2 } },
      }),
    });
    check("an administrator can save credit settings through the API", http.status === 200 && http.body?.ok === true, http.body);
    check(
      "settings forward the break-glass actor and values",
      rpcCalls[0]?.name === "admin_credit_settings_update" &&
        rpcCalls[0]?.body?.p_actor_type === "break_glass" &&
        rpcCalls[0]?.body?.p_admin_user_id === null &&
        rpcCalls[0]?.body?.p_actions?.simple_message === 2 &&
        rpcCalls[0]?.body?.p_plans?.free?.creditsPerPeriod === 120 &&
        typeof rpcCalls[0]?.body?.p_request_id === "string",
      rpcCalls[0],
    );

    http = await call("/credits/supabase/settings", {
      method: "POST",
      headers: jsonHeaders("phase64-admin-token-123456"),
      body: JSON.stringify({}),
    });
    check("an empty settings change is rejected", http.status === 400 && http.body?.code === "no_credit_changes", http.body);

    rpcCalls.length = 0;
    const adjustmentRequest = "test-adjustment-request-1";
    http = await call("/credits/supabase/adjustments", {
      method: "POST",
      headers: jsonHeaders("phase64-admin-token-123456"),
      body: JSON.stringify({
        userId: alice,
        delta: -5,
        reason: "Support correction",
        requestId: adjustmentRequest,
      }),
    });
    check("an administrator can add or remove credits through the API", http.status === 200 && http.body?.ok === true, http.body);
    check(
      "adjustments forward the actor, amount, reason and idempotency key",
      rpcCalls[0]?.name === "admin_credit_adjustment" &&
        rpcCalls[0]?.body?.p_actor_type === "break_glass" &&
        rpcCalls[0]?.body?.p_user_id === alice &&
        rpcCalls[0]?.body?.p_delta === -5 &&
        rpcCalls[0]?.body?.p_reason === "Support correction" &&
        rpcCalls[0]?.body?.p_request_id === adjustmentRequest,
      rpcCalls[0],
    );

    failRpc = "admin_credit_adjustment";
    failMessage = "adjustment_would_make_balance_negative";
    http = await call("/credits/supabase/adjustments", {
      method: "POST",
      headers: jsonHeaders("phase64-admin-token-123456"),
      body: JSON.stringify({ userId: alice, delta: -500, reason: "Too much", requestId: requestId() }),
    });
    check("a negative-balance rejection is mapped to 400", http.status === 400 && http.body?.code === "adjustment_would_make_balance_negative", http.body);

    failRpc = "admin_credit_management";
    failMessage = "function unavailable";
    http = await call("/credits/supabase", { headers: bearer("phase64-admin-token-123456") });
    check("an unavailable credit RPC returns 503", http.status === 503 && http.body?.code === "credit_management_unavailable", http.body);

    failRpc = "admin_credit_settings_update";
    http = await call("/credits/supabase/settings", {
      method: "POST",
      headers: jsonHeaders("phase64-admin-token-123456"),
      body: JSON.stringify({ actions: { simple_message: 4 } }),
    });
    check("an unavailable settings RPC returns 503", http.status === 503 && http.body?.code === "credit_management_unavailable", http.body);
  } finally {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    globalThis.fetch = realFetch;
  }
} catch (error) {
  fail += 1;
  console.error("SUITE FAILED:", error);
} finally {
  await db.close();
  fs.rmSync(workdir, { recursive: true, force: true });
  console.log("");
  if (fail === 0) {
    console.log(`PASS ${pass} / ${pass + fail}`);
    console.log("AI_ADMIN_CREDIT_TESTS_OK");
  } else {
    console.error(`PASS ${pass} / ${pass + fail}`);
    process.exitCode = 1;
  }
}
