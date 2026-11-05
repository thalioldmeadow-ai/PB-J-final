/**
 * Phase 5 database tests.
 *
 * Runs the real migration chain against embedded PostgreSQL. This validates the
 * SQL functions and RLS, not a hosted Supabase deployment. No live JSON ledger
 * is read or changed.
 *
 * Run with: npm run supabase:phase5:test
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
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows as T[];
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await rows<T>(sql, params))[0];
const exec = (sql: string) => db.exec(sql);
const asRoot = () => exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
const asService = () =>
  exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role service_role;");
const asUser = (userId: string) =>
  exec(
    `reset role; select set_config('request.jwt.claim.sub', '${userId}', false); set role authenticated;`,
  );
const requestId = () => `req-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const expectReject = async (name: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
    check(name, false);
  } catch {
    check(name, true);
  }
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

const wallet = async (userId: string) =>
  one<{ balance: string; allocated: string; plan: string }>(
    "select balance, allocated, plan from public.wallets where user_id = $1",
    [userId],
  );

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
  const migrations = fs
    .readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    await exec(fs.readFileSync(path.join(migrationDir, migration), "utf8"));
  }
  check("all migrations apply", migrations.length === 9, migrations);

  const userA = await createUser("Alice");
  const userB = await createUser("Admin");
  const userC = await createUser("Imported");
  const userD = await createUser("Active");
  const userE = await createUser("History");

  await asRoot();
  await rows("insert into public.admin_users (user_id) values ($1)", [userB]);
  await asService();

  const reqA = requestId();
  const reserved = await one<any>("select * from public.reserve_credits($1, $2, 'simple_message')", [
    userA,
    reqA,
  ]);
  const reserveTx = await one<any>(
    "select kind, credits_delta, balance_before, balance_after from public.credit_transactions where user_id = $1 and request_id = $2 and kind = 'reserve'",
    [userA, reqA],
  );
  check(
    "reservation records previous and new balance",
    reserved.duplicate === false &&
      Number(reserved.balance) === 99 &&
      Number(reserveTx.credits_delta) === -1 &&
      Number(reserveTx.balance_before) === 100 &&
      Number(reserveTx.balance_after) === 99,
    { reserved, reserveTx },
  );

  await one("select * from public.settle_credits($1, $2)", [userA, reqA]);
  const settleTx = await one<any>(
    "select credits_delta, balance_before, balance_after from public.credit_transactions where user_id = $1 and request_id = $2 and kind = 'settle'",
    [userA, reqA],
  );
  check(
    "settlement records a zero-delta transaction with matching balances",
    Number(settleTx.credits_delta) === 0 &&
      Number(settleTx.balance_before) === 99 &&
      Number(settleTx.balance_after) === 99,
    settleTx,
  );

  const reqUncertain = requestId();
  await one("select * from public.reserve_credits($1, $2, 'daily_plan')", [
    userA,
    reqUncertain,
  ]);
  const marked = await one<any>(
    "select * from public.mark_credit_request_uncertain($1, $2, 'provider_timeout')",
    [userA, reqUncertain],
  );
  const uncertainStatus = await one<any>(
    "select status, error_code, completed_at from public.credit_requests where user_id = $1 and request_id = $2",
    [userA, reqUncertain],
  );
  await expectReject("an uncertain request cannot be settled normally", () =>
    one("select * from public.settle_credits($1, $2)", [userA, reqUncertain]),
  );
  await expectReject("an uncertain request cannot be refunded automatically", () =>
    one("select * from public.refund_credits($1, $2)", [userA, reqUncertain]),
  );
  const reconciled = await one<any>(
    "select * from public.admin_reconcile_credit_request($1, $2, $3, 'failed', 'Provider timed out; confirmed no useful response')",
    [userB, userA, reqUncertain],
  );
  const reconciledAgain = await one<any>(
    "select * from public.admin_reconcile_credit_request($1, $2, $3, 'failed', 'Provider timed out; confirmed no useful response')",
    [userB, userA, reqUncertain],
  );
  const refundTx = await one<any>(
    "select credits_delta, balance_before, balance_after from public.credit_transactions where user_id = $1 and request_id = $2 and kind = 'refund'",
    [userA, reqUncertain],
  );
  check(
    "uncertain credits stay reserved until an explicit administrator reconciliation",
    Number(marked.balance) === 96 &&
      uncertainStatus.status === "uncertain" &&
      uncertainStatus.completed_at === null &&
      Number(reconciled.balance) === 99 &&
      reconciledAgain.duplicate === true &&
      Number(refundTx.balance_before) === 96 &&
      Number(refundTx.balance_after) === 99,
    { marked, uncertainStatus, reconciled, reconciledAgain, refundTx },
  );

  const adjustReq = requestId();
  const adjusted = await one<any>(
    "select * from public.admin_adjust_credits($1, $2, 5, 'Goodwill credit for support ticket', $3)",
    [userB, userA, adjustReq],
  );
  const adjustedAgain = await one<any>(
    "select * from public.admin_adjust_credits($1, $2, 5, 'Goodwill credit for support ticket', $3)",
    [userB, userA, adjustReq],
  );
  const adjustmentTx = await one<any>(
    "select credits_delta, balance_before, balance_after, metadata from public.credit_transactions where user_id = $1 and idempotency_key = $2",
    [userA, `admin:${adjustReq}`],
  );
  const adjustmentAudit = await one<any>(
    "select action, target_user_id, success from public.admin_audit_log where action = 'credits.adjust' and target_user_id = $1",
    [userA],
  );
  check(
    "administrator adjustment is audited, reasoned and idempotent",
    adjusted.duplicate === false &&
      adjustedAgain.duplicate === true &&
      Number(adjusted.balance) === 104 &&
      adjustedAgain.balance === adjusted.balance &&
      Number(adjustmentTx.credits_delta) === 5 &&
      Number(adjustmentTx.balance_before) === 99 &&
      Number(adjustmentTx.balance_after) === 104 &&
      adjustmentTx.metadata.reason === "Goodwill credit for support ticket" &&
      adjustmentAudit.success === true,
    { adjusted, adjustedAgain, adjustmentTx, adjustmentAudit },
  );
  await expectReject("an adjustment cannot take a wallet below zero", () =>
    one(
      "select * from public.admin_adjust_credits($1, $2, -1000, 'Too large a correction', $3)",
      [userB, userA, requestId()],
    ),
  );
  await expectReject("an adjustment reason is required", () =>
    one(
      "select * from public.admin_adjust_credits($1, $2, 1, 'x', $3)",
      [userB, userA, requestId()],
    ),
  );

  const legacySource = "c".repeat(40);
  const imported = await one<any>(
    "select * from public.import_legacy_wallet($1, $2, 100, 100, 'free', $3, 0, '{}'::jsonb)",
    [legacySource, userC, "a".repeat(64)],
  );
  const importedAgain = await one<any>(
    "select * from public.import_legacy_wallet($1, $2, 100, 100, 'free', $3, 0, '{}'::jsonb)",
    [legacySource, userC, "a".repeat(64)],
  );
  const importedTx = await one<any>(
    "select credits_delta, balance_before, balance_after from public.credit_transactions where user_id = $1 and kind = 'legacy_import'",
    [userC],
  );
  check(
    "legacy import sets the exact balance once and is idempotent",
    imported.duplicate === false &&
      importedAgain.duplicate === true &&
      Number(imported.balance) === 100 &&
      Number(importedAgain.balance) === 100 &&
      Number(importedTx.credits_delta) === 0 &&
      Number(importedTx.balance_before) === 100 &&
      Number(importedTx.balance_after) === 100,
    { imported, importedAgain, importedTx },
  );

  await expectReject("a legacy source cannot be assigned to a second profile", () =>
    one(
      "select * from public.import_legacy_wallet($1, $2, 100, 100, 'free', $3, 0, '{}'::jsonb)",
      [legacySource, userD, "a".repeat(64)],
    ),
  );

  await asService();
  await one("select * from public.reserve_credits($1, $2, 'simple_message')", [
    userD,
    requestId(),
  ]);
  await expectReject("a wallet with existing activity is not overwritten", () =>
    one(
      "select * from public.import_legacy_wallet($1, $2, 100, 100, 'free', $3, 0, '{}'::jsonb)",
      ["d".repeat(40), userD, "a".repeat(64)],
    ),
  );
  await expectReject("legacy history requires manual review", () =>
    one(
      "select * from public.import_legacy_wallet($1, $2, 100, 100, 'free', $3, 1, '{}'::jsonb)",
      ["e".repeat(40), userE, "a".repeat(64)],
    ),
  );

  const spendReq = requestId();
  const spend = await one<any>(
    "select * from public.reserve_ai_spend($1, $2, 0.50, 0.60, 10, 10, 100)",
    [userA, spendReq],
  );
  const spendUncertain = await one<any>(
    "select * from public.mark_ai_spend_uncertain($1, $2, 'Provider timed out')",
    [userA, spendReq],
  );
  const releaseUncertain = await one<any>("select public.release_ai_spend($1, $2) as released", [
    userA,
    spendReq,
  ]);
  const reconciledSpend = await one<any>(
    "select * from public.admin_reconcile_ai_spend($1, $2, $3, 0.20, 'Invoice confirmed actual usage')",
    [userB, userA, spendReq],
  );
  const reconciledSpendAgain = await one<any>(
    "select * from public.admin_reconcile_ai_spend($1, $2, $3, 0.20, 'Invoice confirmed actual usage')",
    [userB, userA, spendReq],
  );
  const counters = await one<any>(
    "select actual_aud, reserved_aud from public.ai_spend_counters where period_type = 'day' and scope = 'user' and scope_id = $1",
    [userA],
  );
  check(
    "an uncertain spend reservation is not released and reconciles exactly once",
    spend.duplicate === false &&
      spendUncertain.status === "uncertain" &&
      releaseUncertain.released === false &&
      reconciledSpend.duplicate === false &&
      reconciledSpendAgain.duplicate === true &&
      Number(counters.actual_aud) === 0.2 &&
      Number(counters.reserved_aud) === 0,
    { spend, spendUncertain, releaseUncertain, reconciledSpend, reconciledSpendAgain, counters },
  );

  const rejectReq = requestId();
  const rejectionId = await one<any>(
    "select public.record_ai_spend_rejection($1, $2, 'daily-budget', 0.60, 0.70) as id",
    [userA, rejectReq],
  );
  const rejectionAgain = await one<any>(
    "select public.record_ai_spend_rejection($1, $2, 'daily-budget', 0.60, 0.70) as id",
    [userA, rejectReq],
  );
  check(
    "spending rejections are recorded idempotently",
    rejectionId.id && rejectionId.id === rejectionAgain.id,
    { rejectionId, rejectionAgain },
  );

  const reqExpire = requestId();
  await one("select * from public.reserve_credits($1, $2, 'simple_message')", [
    userA,
    reqExpire,
  ]);
  await rows(
    "update public.credit_requests set reservation_expires_at = now() - interval '1 minute' where user_id = $1 and request_id = $2",
    [userA, reqExpire],
  );
  const expired = await one<any>("select public.expire_stale_credit_requests(10) as count");
  const expiredRow = await one<any>(
    "select status from public.credit_requests where user_id = $1 and request_id = $2",
    [userA, reqExpire],
  );
  check(
    "stale pending credits become uncertain instead of being auto-refunded",
    Number(expired.count) >= 1 && expiredRow.status === "uncertain",
    { expired, expiredRow },
  );
  await one(
    "select * from public.admin_reconcile_credit_request($1, $2, $3, 'failed', 'Expired without a provider response')",
    [userB, userA, reqExpire],
  );

  const overview = await one<any>("select public.admin_financial_overview() as overview");
  check(
    "admin financial overview exposes credits, spending and reconciliation counts",
    Boolean(overview.overview?.credits) &&
      Number(overview.overview.credits.held) > 0 &&
      Number(overview.overview.credits.spent) >= 0 &&
      overview.overview.spending.byProvider.freebuff === undefined &&
      Number(overview.overview.rejections.thisMonth) === 1 &&
      Number(overview.overview.requests.failedThisMonth) >= 2 &&
      Number(overview.overview.requests.refundedThisMonth) >= 2 &&
      overview.overview.reservations !== undefined,
    overview,
  );

  await asUser(userA);
  await expectReject("a normal user cannot read legacy import records", () =>
    rows("select * from public.legacy_credit_imports"),
  );
  await expectReject("a normal user cannot read spend rejections", () =>
    rows("select * from public.ai_spend_rejections"),
  );
  await expectReject("a normal user cannot call the admin adjustment RPC", () =>
    one(
      "select * from public.admin_adjust_credits($1, $2, 10, 'Unauthorized adjustment', $3)",
      [userA, userA, requestId()],
    ),
  );
  await expectReject("a normal user cannot reconcile an uncertain request", () =>
    one(
      "select * from public.admin_reconcile_credit_request($1, $2, $3, 'failed', 'Unauthorized')",
      [userA, userA, reqExpire],
    ),
  );

  const finalWallet = await wallet(userA);
  check("the test wallet remains internally consistent", Number(finalWallet.balance) >= 0, finalWallet);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} catch (error) {
  console.error("FATAL", error);
  process.exitCode = 1;
} finally {
  await db.close();
}
