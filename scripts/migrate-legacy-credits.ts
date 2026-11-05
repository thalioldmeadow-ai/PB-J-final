/**
 * Guarded legacy-credit importer.
 *
 * Default mode is a dry run. Nothing is written to Supabase unless --apply is
 * supplied. The source JSON file is never deleted or edited; --apply first
 * writes a timestamped backup with mode 0600.
 *
 * Ownership is accepted only from public.profiles.legacy_user_id, which normal
 * users cannot write. A missing mapping is reported, never guessed. A wallet
 * with legacy request/history rows is refused for manual review.
 *
 * Run:
 *   npm run supabase:migrate-credits
 *   npm run supabase:migrate-credits -- --apply
 */

import fs from "fs";
import path from "path";
import type { LegacyMigrationPlan, LegacyMigrationRow } from "../server/ai/legacyCreditMigration";

try {
  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  }
} catch {
  // A host may inject variables directly; a missing .env is not an error here.
}

const { getSupabaseAdminClient, supabaseEnvironmentStatus } = await import(
  "../server/supabaseClient"
);
const { planLegacyCreditMigration, redactMigrationPlan } = await import(
  "../server/ai/legacyCreditMigration"
);

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  console.log(`Guarded legacy credit importer

Usage:
  npm run supabase:migrate-credits              Dry run; no Supabase writes
  npm run supabase:migrate-credits -- --apply   Back up JSON, then import eligible wallets
  npm run supabase:migrate-credits -- --file path/to/ai-credits.json

Eligibility:
  * exactly one public.profiles.legacy_user_id matches the old wallet id;
  * the wallet has no legacy request/history rows;
  * neither the source wallet nor the profile has already been imported.

The source JSON is never deleted or edited. Unmatched wallets stay in legacy
storage and are reported for manual ownership verification.`);
  process.exit(0);
}
const apply = args.has("--apply");
const sourceArgIndex = process.argv.indexOf("--file");
const sourceFile =
  sourceArgIndex > -1 && process.argv[sourceArgIndex + 1]
    ? path.resolve(process.argv[sourceArgIndex + 1])
    : path.join(process.cwd(), "data", "ai-credits.json");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const fail = (message: string, code = 1): never => {
  console.error(`FAIL: ${message}`);
  process.exit(code);
};

if (!fs.existsSync(sourceFile)) fail(`legacy credit file not found: ${sourceFile}`);

let raw: unknown;
try {
  raw = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
} catch {
  fail("the legacy credit file is not valid JSON");
}
if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
  fail("the legacy credit file has an unexpected shape");
}

const status = supabaseEnvironmentStatus();
if (status.missing.length > 0) {
  fail(`missing Supabase environment variable(s): ${status.missing.join(", ")}`);
}

const admin = getSupabaseAdminClient();

const profilesResult = await admin
  .from("profiles")
  .select("id,legacy_user_id")
  .not("legacy_user_id", "is", null)
  .limit(10_000);
if (profilesResult.error) {
  fail(
    `could not read verified profile mappings (${profilesResult.error.code || "unknown"}): ${profilesResult.error.message}`,
  );
}

const importsResult = await admin
  .from("legacy_credit_imports")
  .select("source_key,user_id")
  .limit(10_000);
if (importsResult.error) {
  fail(
    `could not read legacy import ledger (${importsResult.error.code || "unknown"}): ${importsResult.error.message}. Apply the Phase 5 migration first.`,
  );
}

const profiles = (profilesResult.data || [])
  .map((row: any) => ({
    id: String(row.id || ""),
    legacyUserId: String(row.legacy_user_id || ""),
  }))
  .filter((row) => row.id && row.legacyUserId);

const imports = (importsResult.data || []).map((row: any) => ({
  sourceKey: String(row.source_key || ""),
  userId: String(row.user_id || ""),
}));

const plan = planLegacyCreditMigration(raw as Record<string, unknown>, profiles, imports);

const outcomes: Array<{
  sourceKey: string;
  status: string;
  userId?: string;
  balance?: number;
  detail?: string;
}> = [];

const applyRow = async (row: LegacyMigrationRow) => {
  if (row.status !== "ready" || !row.profileId) {
    outcomes.push({
      sourceKey: row.sourceKey,
      status: row.status,
      userId: row.profileId,
      balance: row.balance,
      detail: row.reason,
    });
    return;
  }

  if (!apply) {
    outcomes.push({
      sourceKey: row.sourceKey,
      status: "would_import",
      userId: row.profileId,
      balance: row.balance,
      detail: "dry run; pass --apply to write",
    });
    return;
  }

  const authUser = await admin.auth.admin.getUserById(row.profileId);
  if (authUser.error || !authUser.data.user) {
    outcomes.push({
      sourceKey: row.sourceKey,
      status: "auth_user_missing",
      userId: row.profileId,
      balance: row.balance,
      detail: "verified profile has no Supabase Auth user",
    });
    return;
  }

  const result = await admin.rpc("import_legacy_wallet", {
    p_source_key: row.sourceKey,
    p_user_id: row.profileId,
    p_balance: row.balance,
    p_allocated: row.allocated,
    p_plan: row.plan,
    p_checksum: row.checksum,
    p_history_count: 0,
    p_metadata: {
      sourceFile: path.basename(sourceFile),
      sourceVersion: (raw as Record<string, unknown>).version ?? null,
      importedBy: "scripts/migrate-legacy-credits.ts",
      sourcePlan: row.plan,
    },
  });

  if (result.error) {
    outcomes.push({
      sourceKey: row.sourceKey,
      status: "import_failed",
      userId: row.profileId,
      balance: row.balance,
      detail: `${result.error.code || "unknown"}: ${result.error.message}`,
    });
    return;
  }

  const imported = Array.isArray(result.data) ? result.data[0] : result.data;
  outcomes.push({
    sourceKey: row.sourceKey,
    status: imported?.duplicate ? "already_imported" : "imported",
    userId: row.profileId,
    balance: Number(imported?.balance ?? row.balance),
    detail: imported?.duplicate
      ? "idempotent replay; no balance was changed"
      : "balance set to the legacy value exactly once",
  });
};

if (apply) {
  const backupDir = path.join(process.cwd(), "backups");
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backupFile = path.join(backupDir, `ai-credits-${stamp}.json`);
  if (fs.existsSync(backupFile)) fail("refusing to overwrite an existing backup");
  fs.writeFileSync(backupFile, fs.readFileSync(sourceFile), { mode: 0o600 });
  fs.chmodSync(backupFile, 0o600);
  console.log(`Backup written: ${path.relative(process.cwd(), backupFile)}`);
}

for (const row of plan.rows) {
  await applyRow(row);
}

const report = {
  ...redactMigrationPlan(plan),
  mode: apply ? "apply" : "dry-run",
  sourceFile: path.basename(sourceFile),
  outcomes,
};
const reportDir = path.join(process.cwd(), "reports");
fs.mkdirSync(reportDir, { recursive: true });
const reportFile = path.join(reportDir, `phase5-credit-migration-${stamp}.json`);
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

console.log("\nLegacy credit migration");
console.log("=======================");
console.log(`Mode: ${apply ? "APPLY" : "DRY RUN (no changes)"}`);
console.log(`Source: ${path.relative(process.cwd(), sourceFile)}`);
console.log(`Verified profile mappings: ${profiles.length}`);
console.log(`Existing imports: ${imports.length}`);
if (plan.rejected.length > 0) {
  console.log(`Invalid legacy accounts: ${plan.rejected.length}`);
  for (const rejected of plan.rejected) {
    console.log(`  ${rejected.sourceKey}: ${rejected.reason}`);
  }
}
for (const row of plan.rows) {
  console.log(
    `  ${row.sourceKey.slice(0, 12)}… ${row.status} ${row.balance} credits${
      row.profileId ? ` -> ${row.profileId}` : ""
    }${row.reason ? ` (${row.reason})` : ""}`,
  );
}
for (const outcome of outcomes) {
  console.log(
    `  outcome ${outcome.status}${outcome.detail ? `: ${outcome.detail}` : ""}`,
  );
}
console.log(`Report: ${path.relative(process.cwd(), reportFile)}`);
console.log(
  `Summary: ready=${plan.summary.ready} unmatched=${plan.summary.unmatched} already=${plan.summary.already_imported} historyReview=${plan.summary.history_requires_review} conflicts=${plan.summary.source_conflict}`,
);
if (plan.summary.unmatched > 0) {
  console.log(
    "\nUnmatched wallets remain only in the legacy JSON file. Do not assign them without verified ownership.",
  );
}
if (apply && outcomes.some((entry) => entry.status === "import_failed")) {
  process.exitCode = 1;
}
