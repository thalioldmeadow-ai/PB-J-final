/**
 * Legacy credit migration planner tests.
 *
 * These are pure tests: they do not connect to Supabase and never mutate the
 * live JSON ledger. The fixture shape matches data/ai-credits.json.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  legacyCandidateChecksum,
  planLegacyCreditMigration,
  readLegacyCandidates,
} from "../server/ai/legacyCreditMigration";

let pass = 0;
let fail = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    fail += 1;
    console.error(`FAIL  ${name}`, error);
  }
};

const source = "7d84bc015a65bb83c6ce25040cf6b1e969d5d619";
const profileId = "11111111-1111-4111-8111-111111111111";

const fixture = (overrides: Record<string, unknown> = {}) => ({
  version: 2,
  accounts: {
    [source]: {
      userId: source,
      tokenHash: "a".repeat(64),
      plan: "free",
      balance: 100,
      allocated: 100,
      periodCreditsUsed: 0,
      periodStart: "2026-11-02T07:15:58.003Z",
      periodEnd: "2026-11-03T07:15:58.003Z",
      subscriptionStatus: "active",
      subscriptionStartedAt: "2026-11-02T07:15:58.003Z",
      renewalAt: "2026-11-03T07:15:58.003Z",
      expiresAt: "2026-11-03T07:15:58.003Z",
      createdAt: "2026-11-02T07:15:58.003Z",
      updatedAt: "2026-11-02T07:15:58.003Z",
      ...overrides,
    },
  },
  requests: {},
  history: [],
});

check("the live 100-credit wallet is read without its token hash", () => {
  const raw = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", "ai-credits.json"), "utf8"),
  );
  const { candidates, rejected } = readLegacyCandidates(raw);
  assert.equal(rejected.length, 0);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceKey, source);
  assert.equal(candidates[0].balance, 100);
  assert.equal(candidates[0].allocated, 100);
  assert.equal(candidates[0].plan, "free");
  assert.equal(candidates[0].historyCount, 0);
  assert.equal("tokenHash" in candidates[0], false);
  assert.equal(JSON.stringify(candidates[0]).includes("a".repeat(64)), false);
});

check("no verified profile mapping means unmatched, never guessed", () => {
  const plan = planLegacyCreditMigration(fixture(), [], []);
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].status, "unmatched");
  assert.equal(plan.rows[0].profileId, undefined);
  assert.equal(plan.summary.unmatched, 1);
  assert.equal(plan.summary.ready, 0);
});

check("a verified legacy_user_id mapping is ready and preserves the exact balance", () => {
  const plan = planLegacyCreditMigration(
    fixture(),
    [{ id: profileId, legacyUserId: source }],
    [],
  );
  assert.equal(plan.rows[0].status, "ready");
  assert.equal(plan.rows[0].profileId, profileId);
  assert.equal(plan.rows[0].balance, 100);
  assert.equal(plan.rows[0].allocated, 100);
  assert.equal(plan.summary.ready, 1);
});

check("a replayed migration is idempotent", () => {
  const plan = planLegacyCreditMigration(
    fixture(),
    [{ id: profileId, legacyUserId: source }],
    [{ sourceKey: source, userId: profileId }],
  );
  assert.equal(plan.rows[0].status, "already_imported");
  assert.equal(plan.summary.already_imported, 1);
});

check("one profile cannot import a second legacy wallet", () => {
  const otherSource = "b".repeat(40);
  const raw = fixture();
  (raw.accounts as Record<string, unknown>)[otherSource] = {
    ...(raw.accounts as Record<string, any>)[source],
    userId: otherSource,
  };
  const plan = planLegacyCreditMigration(
    raw,
    [
      { id: profileId, legacyUserId: source },
      { id: profileId, legacyUserId: otherSource },
    ],
    [{ sourceKey: source, userId: profileId }],
  );
  assert.equal(plan.rows.find((row) => row.sourceKey === otherSource)?.status, "source_conflict");
});

check("history or request rows are refused for manual review", () => {
  const raw = fixture();
  raw.history = [
    {
      id: "h1",
      userId: source,
      action: "simple_message",
      credits: 1,
      createdAt: "2026-11-02T08:00:00.000Z",
      status: "succeeded",
      requestId: "req-history",
      plan: "free",
    },
  ];
  const plan = planLegacyCreditMigration(
    raw,
    [{ id: profileId, legacyUserId: source }],
    [],
  );
  assert.equal(plan.rows[0].status, "history_requires_review");
  assert.equal(plan.summary.history_requires_review, 1);
});

check("invalid balances are rejected rather than imported", () => {
  const plan = planLegacyCreditMigration(fixture({ balance: -1 }), [], []);
  assert.equal(plan.rows.length, 0);
  assert.equal(plan.rejected[0].reason, "invalid_balance");
  assert.equal(plan.summary.invalid, 1);
});

check("the checksum does not depend on the secret token hash", () => {
  const a = fixture();
  const b = fixture({ tokenHash: "b".repeat(64) });
  const accountA = (a.accounts as Record<string, any>)[source];
  const accountB = (b.accounts as Record<string, any>)[source];
  assert.equal(
    legacyCandidateChecksum(source, accountA, 0, 0),
    legacyCandidateChecksum(source, accountB, 0, 0),
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
