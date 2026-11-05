/**
 * Staged Supabase connection probe.
 *
 * Reads credentials from the server environment, uses the installed
 * @supabase/supabase-js client, and prints only statuses, the project ref and
 * schema readiness. It never prints a URL key, service key or row data.
 *
 * Run with: npm run supabase:connection
 */

import fs from "fs";
import path from "path";

try {
  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  }
} catch {
  // A host may inject variables directly; a missing file is not an error here.
}

const { getSupabaseAdminClient, getSupabaseAnonClient, supabaseEnvironmentStatus } =
  await import("../server/supabaseClient");

const REQUIRED_TABLES = [
  { name: "profiles", column: "id" },
  { name: "admin_users", column: "user_id" },
  { name: "admin_audit_log", column: "id" },
  { name: "credit_actions", column: "key" },
  { name: "credit_plans", column: "id" },
  { name: "wallets", column: "user_id" },
  { name: "credit_requests", column: "id" },
  { name: "credit_transactions", column: "id" },
  { name: "subscriptions", column: "user_id" },
  { name: "billing_customer_aliases", column: "alias" },
  { name: "revenuecat_events", column: "event_id" },
  { name: "ai_usage_events", column: "id" },
  { name: "ai_usage_daily", column: "day" },
  { name: "ai_spend_counters", column: "period_type" },
  { name: "ai_spend_reservations", column: "id" },
  { name: "ai_safety_daily", column: "day" },
  { name: "ai_settings", column: "id" },
  { name: "legacy_credit_imports", column: "source_key" },
  { name: "ai_spend_rejections", column: "id" },
  { name: "vault_records", column: "id" },
] as const;

const status = supabaseEnvironmentStatus();
const migrationDir = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = fs.existsSync(migrationDir)
  ? fs.readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort()
  : [];

console.log("Supabase connection probe");
console.log("=========================");
console.log(
  `Environment: ${Object.entries(status.variables)
    .map(([name, present]) => `${name}=${present ? "present" : "missing"}`)
    .join(" ")}`,
);
console.log(`Project host: ${status.projectHost || "not configured"}`);
console.log(`Project ref: ${status.projectRef || "not configured"}`);
console.log(
  `Auth activation: ${status.authActivationEnabled ? "enabled" : "disabled (staged connection)"}`,
);
console.log(`Local migrations: ${migrationFiles.length} file(s)`);
for (const file of migrationFiles) console.log(`  - ${file}`);

if (status.missing.length > 0) {
  console.error(`\nFAIL: missing environment variable(s): ${status.missing.join(", ")}`);
  process.exitCode = 1;
} else {
  let adminAuthOk = false;
  let anonKeyOk = false;
  let serviceRestOk = false;

  try {
    const admin = getSupabaseAdminClient();
    const result = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (result.error) {
      console.error(`\nFAIL: service-role Auth request failed: ${result.error.message}`);
      process.exitCode = 1;
    } else {
      adminAuthOk = true;
      console.log("\nAuth admin API: reachable with the service-role key");
    }

    const anon = getSupabaseAnonClient();
    const anonResult = await anon.auth.signInWithPassword({
      email: "connection-probe@example.invalid",
      password: "not-a-real-password",
    });
    const anonMessage = (anonResult.error?.message || "").toLowerCase();
    if (
      anonMessage.includes("invalid api key") ||
      anonMessage.includes("no api key") ||
      anonMessage.includes("unauthorized")
    ) {
      console.error("\nFAIL: anon key was rejected by Supabase Auth");
      process.exitCode = 1;
    } else {
      anonKeyOk = true;
      console.log("Anon Auth endpoint: reachable with the anon key");
    }

    const plans = await admin.from("credit_plans").select("id,credits_per_period,period_days");
    if (plans.error) {
      console.error(
        `\nMigration schema: credit_plans query failed (${plans.error.code || "unknown"}: ${plans.error.message})`,
      );
    } else {
      serviceRestOk = plans.data?.some((plan) => plan.id === "free") === true;
      console.log(
        `Service REST: reachable (${plans.data?.length ?? 0} credit plan row(s); free seed ${serviceRestOk ? "present" : "missing"})`,
      );
    }

    const missingTables: string[] = [];
    const schemaErrors: string[] = [];
    for (const table of REQUIRED_TABLES) {
      const result = await admin.from(table.name).select(table.column).limit(1);
      if (result.error) {
        const message = (result.error.message || "").toLowerCase();
        if (
          result.error.code === "42P01" ||
          message.includes("does not exist") ||
          message.includes("could not find the table")
        ) {
          missingTables.push(table.name);
        } else {
          schemaErrors.push(`${table.name} (${result.error.code || "unknown"}: ${result.error.message})`);
        }
      }
    }

    const schemaReady = missingTables.length === 0 && schemaErrors.length === 0 && serviceRestOk;
    if (schemaReady) {
      console.log(`Migration schema: ready (${REQUIRED_TABLES.length} public tables found)`);
    } else {
      if (missingTables.length > 0) {
        console.error(
          `\nMigration schema: not applied; missing ${missingTables.length} table(s): ${missingTables.join(", ")}`,
        );
      }
      for (const error of schemaErrors) console.error(`\nFAIL: schema check ${error}`);
      if (!serviceRestOk) console.error("\nMigration schema: seed check failed (free plan missing or unreadable)");
      console.error("Review the hosted schema before applying: npx supabase db push --remote");
      process.exitCode = 2;
    }

    console.log("\nSummary");
    console.log(`  service-role Auth: ${adminAuthOk ? "PASS" : "FAIL"}`);
    console.log(`  anon key:         ${anonKeyOk ? "PASS" : "FAIL"}`);
    console.log(`  service REST:     ${serviceRestOk ? "PASS" : "FAIL"}`);
    console.log(`  migrations:       ${schemaReady ? "READY" : "NOT READY"}`);
    if (schemaReady && adminAuthOk && anonKeyOk) {
      console.log("SUPABASE_CONNECTION_OK");
    }
  } catch (error) {
    console.error(
      `\nFAIL: ${error instanceof Error ? error.message : "Supabase connection failed."}`,
    );
    process.exitCode = 1;
  }
}
