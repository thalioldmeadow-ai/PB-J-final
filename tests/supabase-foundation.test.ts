/**
 * Phase 1 database-foundation tests.
 *
 * Runs the real migration files against an embedded PostgreSQL-compatible
 * engine. The Supabase auth schema and roles are bootstrapped here because a
 * hosted project already provides them.
 *
 * This does not connect to a hosted Supabase project and does not touch the
 * live JSON ledgers. The optional two-connection concurrency test is in
 * tests/supabase-concurrency.test.ts and requires SUPABASE_TEST_DB_URL.
 *
 * Run with: npm run supabase:test
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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

const db = new PGlite();

const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
  const result = await db.query(sql, params);
  return result.rows as T[];
};

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> => {
  const result = await rows<T>(sql, params);
  return result[0];
};

const exec = (sql: string) => db.exec(sql);

const asRoot = async () => {
  await exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
};

const asService = async () => {
  await exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role service_role;");
};

const asUser = async (userId: string) => {
  assert.match(userId, /^[0-9a-f-]{36}$/i);
  await exec(
    `reset role; select set_config('request.jwt.claim.sub', '${userId}', false); set role authenticated;`,
  );
};

const createUser = async (label: string): Promise<string> => {
  await asRoot();
  const id = randomUUID();
  await rows("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)", [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
    JSON.stringify({ display_name: label }),
  ]);
  return id;
};

const requestId = () => `req-${randomUUID().replace(/-/g, "").slice(0, 16)}`;

const wallet = async (userId: string) =>
  one<{ balance: string; allocated: string; plan: string; subscription_status: string }>(
    "select balance, allocated, plan, subscription_status from public.wallets where user_id = $1",
    [userId],
  );

const expectReject = async (name: string, fn: () => Promise<unknown>) => {
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  check(name, rejected);
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
  returns uuid
  language sql
  stable
  as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

try {
  await exec(bootstrap);

  const migrationDir = path.join(process.cwd(), "supabase", "migrations");
  const migrations = fs
    .readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const migration of migrations) {
    await exec(fs.readFileSync(path.join(migrationDir, migration), "utf8"));
  }
  check("all migration files apply", migrations.length === 9, migrations);

  const tables = await rows<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  check(
    "all required tables exist",
    [
      "profiles",
      "admin_users",
      "admin_audit_log",
      "wallets",
      "credit_actions",
      "credit_plans",
      "credit_requests",
      "credit_transactions",
      "subscriptions",
      "billing_customer_aliases",
      "revenuecat_events",
      "ai_usage_events",
      "ai_usage_daily",
      "ai_spend_counters",
      "ai_spend_reservations",
      "ai_safety_daily",
      "ai_settings",
      "legacy_credit_imports",
      "ai_spend_rejections",
      "vault_records",
    ].every((name) => tables.some((row) => row.tablename === name)),
    tables.map((row) => row.tablename),
  );

  const plans = await rows("select id, credits_per_period, period_days, requests_per_day, tokens_per_day from public.credit_plans order by id");
  check("existing Free and Plus settings are seeded", plans.length === 2
    && plans[0].id === "free"
    && Number(plans[0].credits_per_period) === 100
    && Number(plans[0].period_days) === 1
    && Number(plans[0].requests_per_day) === 20
    && Number(plans[0].tokens_per_day) === 60000
    && plans[1].id === "plus"
    && Number(plans[1].credits_per_period) === 1000
    && Number(plans[1].period_days) === 30
    && Number(plans[1].requests_per_day) === 120
    && Number(plans[1].tokens_per_day) === 300000, plans);

  const actions = await rows("select key, cost from public.credit_actions order by key");
  check("existing action prices are seeded", actions.length === 4
    && Number(actions.find((row: any) => row.key === "simple_message")?.cost) === 1
    && Number(actions.find((row: any) => row.key === "daily_plan")?.cost) === 3
    && Number(actions.find((row: any) => row.key === "detailed_analysis")?.cost) === 5
    && Number(actions.find((row: any) => row.key === "complex_task")?.cost) === 10, actions);

  const userA = await createUser("Alice");
  const userB = await createUser("Bob");

  const created = await one<any>(
    "select p.display_name, w.plan, w.balance, w.allocated from public.profiles p join public.wallets w on w.user_id = p.id where p.id = $1",
    [userA],
  );
  check("registration creates profile and Free wallet", Boolean(created)
    && created.display_name === "Alice"
    && created.plan === "free"
    && Number(created.balance) === 100
    && Number(created.allocated) === 100, created);

  const createdSubscription = await one<any>(
    "select plan, status, environment, revenuecat_customer_id, revenuecat_product_id from public.subscriptions where user_id = $1",
    [userA],
  );
  const subscriptionCount = await one<{ count: string }>(
    "select count(*)::text as count from public.subscriptions where user_id = $1",
    [userA],
  );
  const adminCount = await one<{ count: string }>(
    "select count(*)::text as count from public.admin_users where user_id = $1",
    [userA],
  );
  check("registration creates exactly one Free subscription and no administrator",
    subscriptionCount.count === "1"
    && createdSubscription.plan === "free"
    && createdSubscription.status === "active"
    && createdSubscription.environment === "SANDBOX"
    && createdSubscription.revenuecat_customer_id === null
    && createdSubscription.revenuecat_product_id === null
    && adminCount.count === "0", { createdSubscription, subscriptionCount, adminCount });

  await asService();
  const ensured1 = await one<any>("select * from public.ensure_wallet($1)", [userA]);
  const ensured2 = await one<any>("select * from public.ensure_wallet($1)", [userA]);
  const walletCount = await one<{ count: string }>(
    "select count(*)::text as count from public.wallets where user_id = $1",
    [userA],
  );
  check("wallet creation is idempotent", ensured1.user_id === userA
    && ensured2.user_id === userA
    && walletCount.count === "1", { ensured1, ensured2, walletCount });

  await asService();
  const req1 = requestId();
  const first = await one<any>("select * from public.reserve_credits($1, $2, 'simple_message')", [userA, req1]);
  const duplicate = await one<any>("select * from public.reserve_credits($1, $2, 'simple_message')", [userA, req1]);
  const afterDuplicate = await wallet(userA);
  const reservationCount = await one<{ count: string }>(
    "select count(*)::text as count from public.credit_requests where user_id = $1 and request_id = $2",
    [userA, req1],
  );
  check("duplicate reservation is idempotent", first.duplicate === false
    && duplicate.duplicate === true
    && Number(afterDuplicate.balance) === 99
    && reservationCount.count === "1", { first, duplicate, afterDuplicate, reservationCount });

  const settlement = await one<any>("select * from public.settle_credits($1, $2)", [userA, req1]);
  const settlementAgain = await one<any>("select * from public.settle_credits($1, $2)", [userA, req1]);
  const afterSettle = await wallet(userA);
  check("settlement is idempotent and does not deduct twice", Number(settlement.balance) === 99
    && settlementAgain.duplicate === true
    && Number(afterSettle.balance) === 99, { settlement, settlementAgain, afterSettle });

  const refundReq = requestId();
  await one("select * from public.reserve_credits($1, $2, 'daily_plan')", [userA, refundReq]);
  const refunded = await one<any>("select * from public.refund_credits($1, $2)", [userA, refundReq]);
  const refundedAgain = await one<any>("select * from public.refund_credits($1, $2)", [userA, refundReq]);
  const afterRefund = await wallet(userA);
  check("refund restores the reserved credits once", Number(refunded.balance) === 99
    && refundedAgain.duplicate === true
    && Number(afterRefund.balance) === 99, { refunded, refundedAgain, afterRefund });

  const spendReq = requestId();
  const spend = await one<any>("select * from public.reserve_ai_spend($1, $2, 0.50, 0.60, 10, 10, 100)", [userA, spendReq]);
  await expectReject("daily budget limit blocks a second reservation", async () => {
    await one("select * from public.reserve_ai_spend($1, $2, 0.20, 0.60, 10, 10, 100)", [userA, requestId()]);
  });
  await one(
    "select public.record_ai_usage($1, $2, 'freebuff', 'model-a', 'simple_message', 'free', 10, 20, 1, 0.10, 'USD', 0.10, 0.40, 100, 'success', false)",
    [userA, spendReq],
  );
  const counters = await rows<any>(
    "select period_type, scope, actual_aud, reserved_aud from public.ai_spend_counters order by period_type, scope",
  );
  const usageCount = await one<{ count: string }>(
    "select count(*)::text as count from public.ai_usage_events where user_id = $1 and request_id = $2",
    [userA, spendReq],
  );
  check("usage recording consumes the spend reservation once", spend.duplicate === false
    && usageCount.count === "1"
    && counters.every((row: any) => Number(row.actual_aud) === 0.40 && Number(row.reserved_aud) === 0)
    && (await one<any>("select count(*)::text as count from public.ai_usage_daily where user_id = $1", [userA])).count === "1",
  { spend, counters, usageCount });

  const legacyId = "a".repeat(40);
  await asRoot();
  await rows("update public.profiles set legacy_user_id = $2 where id = $1", [userA, legacyId]);
  await asService();
  const rc = await one<any>(
    "select * from public.apply_revenuecat_event($1, 'INITIAL_PURCHASE', $2, array[$2], 'plus', 'active', 'SANDBOX', 'plus_monthly', 'plus', now(), now() + interval '30 days', null, false, null, true, now(), '{}'::jsonb)",
    ["event-phase1-001", legacyId],
  );
  const rcAgain = await one<any>(
    "select * from public.apply_revenuecat_event($1, 'INITIAL_PURCHASE', $2, array[$2], 'plus', 'active', 'SANDBOX', 'plus_monthly', 'plus', now(), now() + interval '30 days', null, false, null, true, now(), '{}'::jsonb)",
    ["event-phase1-001", legacyId],
  );
  const rcWallet = await wallet(userA);
  const rcSubscription = await one<any>("select plan, status from public.subscriptions where user_id = $1", [userA]);
  check("RevenueCat event is idempotent and grants Plus once", rc.matched === true
    && rcAgain.duplicate === true
    && rcWallet.plan === "plus"
    && Number(rcWallet.balance) === 1000
    && rcSubscription.plan === "plus"
    && rcSubscription.status === "active", { rc, rcAgain, rcWallet, rcSubscription });

  await asUser(userB);
  const visibleWallets = await rows<any>("select user_id from public.wallets");
  const visibleProfiles = await rows<any>("select id from public.profiles");
  check("RLS isolates wallets and profiles", visibleWallets.length === 1
    && visibleWallets[0].user_id === userB
    && visibleProfiles.length === 1
    && visibleProfiles[0].id === userB, { visibleWallets, visibleProfiles });

  await expectReject("user cannot update a wallet balance", async () => {
    await exec("update public.wallets set balance = 999999");
  });
  await expectReject("user cannot insert a credit transaction", async () => {
    await rows(
      "insert into public.credit_transactions (user_id, kind, credits_delta, balance_after, idempotency_key) values ($1, 'admin_adjustment', 100, 100, $2)",
      [userB, requestId()],
    );
  });
  await expectReject("user cannot execute financial RPCs", async () => {
    await one("select * from public.reserve_credits($1, $2, 'simple_message')", [userB, requestId()]);
  });
  await expectReject("user cannot read admin users", async () => {
    await rows("select * from public.admin_users");
  });
  await expectReject("user cannot read admin audit log", async () => {
    await rows("select * from public.admin_audit_log");
  });

  const ownVault = await one<any>(
    "insert into public.vault_records (user_id, collection, record_id, ciphertext) values ($1, 'journal', 'r1', 'ciphertext') returning id, user_id",
    [userB],
  );
  const otherVaultCount = await one<{ count: string }>(
    "select count(*)::text as count from public.vault_records where user_id = $1",
    [userA],
  );
  check("vault records are encrypted blobs and user-isolated", Boolean(ownVault)
    && ownVault.user_id === userB
    && otherVaultCount.count === "0", { ownVault, otherVaultCount });

  await expectReject("user cannot insert a vault row for another user", async () => {
    await rows(
      "insert into public.vault_records (user_id, collection, record_id, ciphertext) values ($1, 'journal', 'r2', 'ciphertext')",
      [userA],
    );
  });

  await asRoot();
  await rows("insert into public.admin_users (user_id) values ($1)", [userB]);
  await asUser(userB);
  const adminSelf = await one<any>("select public.is_admin() as allowed");
  await asUser(userA);
  const adminOther = await one<any>("select public.is_admin() as allowed");
  await asService();
  const adminServer = await one<any>("select public.is_admin_for($1) as allowed", [userB]);
  await asUser(userB);
  const auditDenied = await (async () => {
    try {
      await rows("select * from public.admin_audit_log");
      return false;
    } catch {
      return true;
    }
  })();
  check("admin check is limited to the admin user", adminSelf.allowed === true
    && adminOther.allowed === false
    && adminServer.allowed === true
    && auditDenied === true, { adminSelf, adminOther, auditDenied });

  await asService();
  const auditId = await one<any>(
    `select public.record_admin_audit(
       p_admin_user_id => $1,
       p_actor_type => 'admin_user',
       p_actor_id => $3::text,
       p_action => 'settings.change',
       p_target_user_ref => $2,
       p_success => true,
       p_metadata => '{"field":"test"}'::jsonb
     ) as id`,
    [userB, legacyId, userB],
  );
  await asRoot();
  const auditRow = await one<any>("select * from public.admin_audit_log where id = $1", [auditId.id]);
  check("admin audit records actor, target and success", auditRow.actor_type === "admin_user"
    && auditRow.actor_id === userB
    && auditRow.target_user_ref === legacyId
    && auditRow.success === true
    && auditRow.metadata.field === "test", auditRow);

  await asUser(userB);
  await expectReject("authenticated users cannot call the audit RPC", async () => {
    await one(
      "select public.record_admin_audit(p_admin_user_id => $1, p_actor_type => 'admin_user', p_actor_id => $1::text, p_action => 'forged')",
      [userB],
    );
  });
  await asRoot();
  await expectReject("admin audit rows cannot be updated", async () => {
    await exec("update public.admin_audit_log set action = 'tampered'");
  });
  await expectReject("admin audit rows cannot be deleted", async () => {
    await exec("delete from public.admin_audit_log");
  });
  const auditCount = await one<{ count: string }>("select count(*)::text as count from public.admin_audit_log");
  check("the audit row survives mutation attempts", auditCount.count === "1", auditCount);

  await asRoot();
  const t = await one<{ count: string }>("select count(*)::text as count from public.wallets");
  check("test users did not leak into a second wallet per account", t.count === "2", t);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} catch (error) {
  console.error("FATAL", error);
  process.exitCode = 1;
} finally {
  await db.close();
}
