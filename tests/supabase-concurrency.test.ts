/**
 * Real two-connection concurrency test.
 *
 * This is intentionally separate from the embedded test because a single
 * PGlite connection cannot exercise row-lock contention. It runs only when
 * SUPABASE_TEST_DB_URL points at a disposable Postgres/Supabase database that
 * already has the Phase 1 migrations applied.
 *
 * Run with:
 *   SUPABASE_TEST_DB_URL="postgresql://..." npm run supabase:concurrency:test
 *
 * The URL is read by node-postgres and is never printed.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const url = process.env.SUPABASE_TEST_DB_URL?.trim();
if (!url) {
  console.log("SKIP  SUPABASE_TEST_DB_URL is not set; real two-connection concurrency test not run.");
  process.exit(0);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const makeRequestId = () => `req-${randomUUID().replace(/-/g, "").slice(0, 16)}`;

const c1 = new Client({ connectionString: url });
const c2 = new Client({ connectionString: url });

let failed = false;

try {
  await Promise.all([c1.connect(), c2.connect()]);

  const userId = randomUUID();
  await c1.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)",
    [userId, `concurrency-${userId.slice(0, 8)}@example.test`, JSON.stringify({ display_name: "Concurrency" })],
  );

  // Same request id: the second connection must wait, then observe the first
  // reservation as a duplicate instead of deducting a second credit.
  const sameRequest = makeRequestId();
  await c1.query("begin");
  await c1.query("select * from public.reserve_credits($1, $2, $3)", [
    userId,
    sameRequest,
    "simple_message",
  ]);

  await c2.query("begin");
  const samePromise = c2.query("select * from public.reserve_credits($1, $2, $3)", [
    userId,
    sameRequest,
    "simple_message",
  ]);

  const sameBlocked = await Promise.race([
    samePromise.then(() => false),
    sleep(350).then(() => true),
  ]);

  await c1.query("commit");
  const sameResult = await samePromise;
  await c2.query("commit");

  const sameRow = sameResult.rows[0] as { duplicate: boolean; balance: string };
  assert.equal(sameBlocked, true, "second connection should wait on the wallet row lock");
  assert.equal(sameRow.duplicate, true, "same request id must return the existing reservation");
  assert.equal(Number(sameRow.balance), 99, "same request id must not deduct twice");
  console.log("  ok  same request waits and is idempotent");

  // Different request ids: the lock serializes both deductions, so the balance
  // is 98 rather than both transactions reading the original 99.
  const requestA = makeRequestId();
  const requestB = makeRequestId();
  await c1.query("begin");
  const first = await c1.query("select * from public.reserve_credits($1, $2, $3)", [
    userId,
    requestA,
    "simple_message",
  ]);
  assert.equal(Number((first.rows[0] as { balance: string }).balance), 98);

  await c2.query("begin");
  const secondPromise = c2.query("select * from public.reserve_credits($1, $2, $3)", [
    userId,
    requestB,
    "simple_message",
  ]);
  const secondBlocked = await Promise.race([
    secondPromise.then(() => false),
    sleep(350).then(() => true),
  ]);
  await c1.query("commit");
  const second = await secondPromise;
  await c2.query("commit");

  const secondRow = second.rows[0] as { duplicate: boolean; balance: string };
  assert.equal(secondBlocked, true, "second connection should wait for the first wallet update");
  assert.equal(secondRow.duplicate, false);
  assert.equal(Number(secondRow.balance), 97, "serialized deductions must not lose an update");
  console.log("  ok  different requests serialize their deductions");

  await c1.query("delete from auth.users where id = $1", [userId]);
  console.log("\n2 passed, 0 failed");
} catch (error) {
  failed = true;
  console.error("FAIL  concurrency test", error);
} finally {
  await c1.query("rollback").catch(() => undefined);
  await c2.query("rollback").catch(() => undefined);
  await c1.end().catch(() => undefined);
  await c2.end().catch(() => undefined);
}

if (failed) process.exitCode = 1;
