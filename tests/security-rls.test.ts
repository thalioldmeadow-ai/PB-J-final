/**
 * Phase 3 RLS and database-permission tests.
 *
 * Runs the real migrations against an embedded PostgreSQL-compatible engine,
 * then acts as User A, User B, an anonymous visitor, the authenticated role and
 * the service role. It verifies ownership isolation, financial-write denial,
 * admin-table protection, encrypted-vault ownership, and append-only audit
 * behaviour.
 *
 * This does not connect to hosted Supabase. Run with: npm run security:test
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
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[];
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
  (await rows<T>(sql, params))[0];
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
const asAnon = async () => {
  await exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;");
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

const rid = () => `req-${randomUUID().replace(/-/g, "").slice(0, 16)}`;

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
  const migrationDir = path.join(process.cwd(), "supabase", "migrations");
  const migrations = fs.readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort();
  for (const migration of migrations) {
    await exec(fs.readFileSync(path.join(migrationDir, migration), "utf8"));
  }
  check("all migration files apply", migrations.length === 9, migrations);

  const userA = await createUser("Alice");
  const userB = await createUser("Bob");
  const legacyTarget = "c".repeat(40);
  const vaultBId = randomUUID();

  // Give User B records in every user-owned table. Service-role writes model
  // the trusted server operations, not normal browser access.
  await asService();
  const reqB = rid();
  await one("select * from public.reserve_credits($1, $2, 'simple_message')", [userB, reqB]);
  await one("select * from public.settle_credits($1, $2)", [userB, reqB]);
  await rows(
    "insert into public.subscriptions (user_id, plan) values ($1, 'free') on conflict (user_id) do update set updated_at = now()",
    [userB],
  );
  await rows(
    "insert into public.ai_usage_events (user_id, request_id, provider, model, action, plan) values ($1, $2, 'test', 'test-model', 'simple_message', 'free')",
    [userB, rid()],
  );
  await rows(
    "insert into public.ai_usage_daily (day, user_id, provider, model, action, plan) values (current_date, $1, 'test', 'test-model', 'simple_message', 'free')",
    [userB],
  );
  await rows(
    "insert into public.ai_spend_counters (period_type, period_key, scope, scope_id) values ('day', to_char(current_date, 'YYYY-MM-DD'), 'user', $1)",
    [userB],
  );
  await rows(
    "insert into public.vault_records (id, user_id, collection, record_id, ciphertext) values ($1, $2, 'journal', 'b-entry', 'encrypted-for-bob')",
    [vaultBId, userB],
  );
  await asRoot();

  const ownData: Array<[string, string]> = [
    ["profiles", "select * from public.profiles where id = $1"],
    ["wallets", "select * from public.wallets where user_id = $1"],
    ["credit_requests", "select * from public.credit_requests where user_id = $1"],
    ["credit_transactions", "select * from public.credit_transactions where user_id = $1"],
    ["subscriptions", "select * from public.subscriptions where user_id = $1"],
    ["ai_usage_events", "select * from public.ai_usage_events where user_id = $1"],
    ["ai_usage_daily", "select * from public.ai_usage_daily where user_id = $1"],
    ["vault_records", "select * from public.vault_records where user_id = $1"],
  ];

  await asUser(userA);
  for (const [table, sql] of ownData) {
    const result = await rows(sql, [userB]);
    check(`User A cannot read User B's ${table}`, result.length === 0, result);
  }
  check("User A can read their own profile", (await rows("select * from public.profiles where id = $1", [userA])).length === 1);
  check("User A can read their own wallet", (await rows("select * from public.wallets where user_id = $1", [userA])).length === 1);

  const ownProfile = await one<any>(
    "update public.profiles set display_name = 'Alice Updated' where id = $1 returning display_name",
    [userA],
  );
  check("User A can update safe profile fields", ownProfile?.display_name === "Alice Updated", ownProfile);

  await expectReject("User A cannot change a protected profile ownership field", async () => {
    await exec(`update public.profiles set legacy_user_id = '${legacyTarget}' where id = '${userA}'`);
  });
  await expectReject("User A cannot update a wallet balance", async () => {
    await exec("update public.wallets set balance = 999999");
  });
  await expectReject("User A cannot update their plan", async () => {
    await exec("update public.wallets set plan = 'plus'");
  });
  await expectReject("User A cannot insert a credit request", async () => {
    await rows(
      "insert into public.credit_requests (user_id, request_id, action, credits, plan) values ($1, $2, 'simple_message', 0, 'free')",
      [userA, rid()],
    );
  });
  await expectReject("User A cannot insert a credit transaction", async () => {
    await rows(
      "insert into public.credit_transactions (user_id, kind, credits_delta, balance_after, idempotency_key) values ($1, 'admin_adjustment', 100, 100, $2)",
      [userA, rid()],
    );
  });
  await expectReject("User A cannot insert a subscription", async () => {
    await rows("insert into public.subscriptions (user_id, plan) values ($1, 'plus')", [userA]);
  });
  await expectReject("User A cannot insert AI usage", async () => {
    await rows(
      "insert into public.ai_usage_events (user_id, request_id, provider, model, action, plan) values ($1, $2, 'test', 'm', 'a', 'free')",
      [userA, rid()],
    );
  });
  await expectReject("User A cannot insert AI spend counters", async () => {
    await rows(
      "insert into public.ai_spend_counters (period_type, period_key, scope, scope_id) values ('day', '2026-11-04', 'user', $1)",
      [userA],
    );
  });
  await expectReject("User A cannot execute the wallet-creation RPC", async () => {
    await one("select * from public.ensure_wallet($1)", [userA]);
  });
  await expectReject("User A cannot execute the reserve RPC", async () => {
    await one("select * from public.reserve_credits($1, $2, 'simple_message')", [userA, rid()]);
  });
  await expectReject("User A cannot execute the settle RPC", async () => {
    await one("select * from public.settle_credits($1, $2)", [userA, rid()]);
  });
  await expectReject("User A cannot execute the refund RPC", async () => {
    await one("select * from public.refund_credits($1, $2)", [userA, rid()]);
  });
  await expectReject("User A cannot execute the spend-reservation RPC", async () => {
    await one("select * from public.reserve_ai_spend($1, $2, 0.10, 1, 10, 10, 1000)", [userA, rid()]);
  });
  await expectReject("User A cannot execute the usage RPC", async () => {
    await one(
      "select public.record_ai_usage($1, $2, 'test', 'm', 'a', 'free', 1, 1, 0, 0, 'USD', 0, 0, 0, 'success', false)",
      [userA, rid()],
    );
  });

  for (const table of [
    "admin_users",
    "admin_audit_log",
    "billing_customer_aliases",
    "revenuecat_events",
    "ai_spend_counters",
    "ai_spend_reservations",
    "ai_safety_daily",
    "ai_settings",
  ]) {
    await expectReject(`User A cannot read ${table}`, async () => {
      await rows(`select * from public.${table}`);
    });
  }

  const actions = await rows("select key from public.credit_actions");
  const plans = await rows("select id from public.credit_plans");
  check("User A can read safe public pricing", actions.length === 4 && plans.length === 2, { actions, plans });
  await expectReject("User A cannot change action prices", async () => {
    await exec("update public.credit_actions set cost = 0");
  });
  await expectReject("User A cannot change plan limits", async () => {
    await exec("update public.credit_plans set credits_per_period = 999999");
  });
  await expectReject("User A cannot promote themselves to administrator", async () => {
    await rows("insert into public.admin_users (user_id) values ($1)", [userA]);
  });
  await expectReject("User A cannot write an audit row directly", async () => {
    await rows("insert into public.admin_audit_log (action) values ('forged')");
  });

  const ownVault = await one<any>(
    "insert into public.vault_records (user_id, collection, record_id, ciphertext) values ($1, 'journal', 'a-entry', 'encrypted-for-alice') returning id, user_id",
    [userA],
  );
  check("User A can store only their own encrypted vault row", ownVault?.user_id === userA, ownVault);
  const updatedVault = await one<any>(
    "update public.vault_records set ciphertext = 'still-encrypted' where id = $1 returning ciphertext",
    [ownVault.id],
  );
  check("User A can update their own ciphertext", updatedVault?.ciphertext === "still-encrypted", updatedVault);
  await expectReject("User A cannot change a vault row's owner", async () => {
    await exec(`update public.vault_records set user_id = '${userB}' where id = '${ownVault.id}'`);
  });
  const anotherVault = await rows("select * from public.vault_records where id = $1", [vaultBId]);
  check("User A cannot read User B's encrypted vault by id", anotherVault.length === 0, anotherVault);
  const deletedOther = await rows("delete from public.vault_records where id = $1 returning id", [vaultBId]);
  check("User A cannot delete User B's encrypted vault", deletedOther.length === 0, deletedOther);
  const ownDeleted = await rows("delete from public.vault_records where id = $1 returning id", [ownVault.id]);
  check("User A can delete their own vault row", ownDeleted.length === 1, ownDeleted);

  await asRoot();
  const bVaultStillThere = await one<{ count: string }>(
    "select count(*)::text as count from public.vault_records where id = $1",
    [vaultBId],
  );
  check("User B's vault row survived User A's delete attempt", bVaultStillThere.count === "1", bVaultStillThere);

  // Reverse direction: B sees only B.
  await asUser(userB);
  const bProfile = await one<any>("select display_name from public.profiles where id = $1", [userB]);
  const bWallet = await one<any>("select user_id from public.wallets where user_id = $1", [userB]);
  const aProfile = await rows("select id from public.profiles where id = $1", [userA]);
  const aWallet = await rows("select user_id from public.wallets where user_id = $1", [userA]);
  check("User B can read their own profile and wallet", Boolean(bProfile) && bWallet.user_id === userB, { bProfile, bWallet });
  check("User B cannot read User A's profile or wallet", aProfile.length === 0 && aWallet.length === 0, { aProfile, aWallet });
  const changedA = await rows("update public.profiles set display_name = 'Hacked' where id = $1 returning id", [userA]);
  check("User B cannot update User A's profile", changedA.length === 0, changedA);

  await asAnon();
  await expectReject("an anonymous visitor cannot read profiles", async () => {
    await rows("select * from public.profiles");
  });

  // Audit is server-only and append-only.
  await asRoot();
  await rows("insert into public.admin_users (user_id) values ($1)", [userB]);
  await asService();
  const auditId = await one<any>(
    `select public.record_admin_audit(
       p_admin_user_id => $1,
       p_actor_type => 'admin_user',
       p_actor_id => $3::text,
       p_action => 'credits.plan.change',
       p_target_user_ref => $2,
       p_success => true,
       p_metadata => '{"plan":"plus"}'::jsonb
     ) as id`,
    [userB, legacyTarget, userB],
  );
  await asRoot();
  const auditRow = await one<any>("select * from public.admin_audit_log where id = $1", [auditId.id]);
  check("the audit RPC records actor, target and result", auditRow.actor_type === "admin_user"
    && auditRow.actor_id === userB
    && auditRow.target_user_ref === legacyTarget
    && auditRow.success === true
    && auditRow.metadata.plan === "plus", auditRow);

  await asUser(userB);
  await expectReject("an administrator cannot read the audit table directly", async () => {
    await rows("select * from public.admin_audit_log");
  });
  await expectReject("a normal authenticated user cannot call the audit RPC", async () => {
    await one(
      "select public.record_admin_audit(p_admin_user_id => $1, p_actor_type => 'admin_user', p_actor_id => $1::text, p_action => 'forged')",
      [userB],
    );
  });

  await asRoot();
  await expectReject("audit rows cannot be updated", async () => {
    await exec("update public.admin_audit_log set action = 'tampered'");
  });
  await expectReject("audit rows cannot be deleted", async () => {
    await exec("delete from public.admin_audit_log");
  });
  await asService();
  await expectReject("the service role cannot truncate the audit table", async () => {
    await exec("truncate table public.admin_audit_log");
  });
  await asRoot();
  const auditCount = await one<{ count: string }>("select count(*)::text as count from public.admin_audit_log");
  check("the audit row remains after mutation attempts", auditCount.count === "1", auditCount);

  const rls = await rows<{ relname: string; relrowsecurity: boolean }>(
    `select c.relname, c.relrowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`,
  );
  check("RLS is enabled on every public table", rls.length === 20 && rls.every((row) => row.relrowsecurity), rls);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} catch (error) {
  console.error("FATAL", error);
  process.exitCode = 1;
} finally {
  await db.close();
}
