/**
 * Phase 6.6 spending and safety checks.
 *
 * Run with: npm run ai:admin:spending:test
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import express from "express";

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

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-spending-"));
process.chdir(workdir);
process.env.NODE_ENV = "test";
process.env.FREEBUFF_API_KEY = "test-freebuff-key-value";
process.env.FREEBUFF_ENABLED = "true";
process.env.FREEBUFF_MODELS = "small";
process.env.FREEBUFF_MODEL = "small";
process.env.FREEBUFF_INPUT_PRICE_PER_MILLION = "1";
process.env.FREEBUFF_OUTPUT_PRICE_PER_MILLION = "2";
process.env.AI_DEFAULT_MODEL = "freebuff:small";
process.env.AI_VALIDATE_MODELS = "false";
process.env.AI_CACHE_ENABLED = "false";
process.env.AI_STREAMING = "false";
process.env.AI_DAILY_LIMIT_AUD = "5";
process.env.AI_MONTHLY_HARD_LIMIT_AUD = "10";
process.env.AI_MONTHLY_BUDGET_AUD = "8";
process.env.AI_ADMIN_TOKEN = "spending-admin-token-123456";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;

const overrides = await import("../server/ai/overrides");
const configModule = await import("../server/ai/config");
const usage = await import("../server/ai/usage");
const spend = await import("../server/ai/spendProtection");
const service = await import("../server/ai/service");
const admin = await import("../server/ai/admin");
const auth = await import("../server/auth");
const aiRoutes = await import("../server/ai/routes");

const ref = "freebuff:small";

// --- defaults and persistence ------------------------------------------------
let config = configModule.loadAiConfig();
check("default thresholds are the suggested 50/75/90", JSON.stringify(config.warningThresholds) === "[50,75,90]");
check("existing per-user monthly limit is converted, not invented", config.limits.perUserMonthlyLimitAud > 0);
check("no model limit is enabled by default", Object.keys(config.modelLimits).length === 0);

const app = express();
app.use("/api/ai/admin", express.json({ limit: "32kb" }), admin.default);
app.use("/api/ai", express.json({ limit: "3mb" }), aiRoutes.default);
const listener = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => listener.once("listening", () => resolve()));
const baseOrigin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
const origin = `${baseOrigin}/api/ai/admin`;
const bearer = { Authorization: "Bearer spending-admin-token-123456" };

const call = async (route: string, body?: unknown, method = "POST") => {
  const response = await fetch(`${origin}${route}`, {
    method,
    headers: { ...bearer, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let json: any = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, body: json };
};

let http = await call("/spending", undefined, "GET");
check("spending view is admin-only readable", http.status === 200 && http.body?.source === "local", http.body);

http = await call("/spending/settings", { limits: { dailyLimitAud: 2.5 }, reason: "test", confirm: false });
check("critical spending changes require confirmation", http.status === 400 && http.body?.code === "confirmation_required", http.body);

http = await call("/spending/settings", { limits: { dailyLimitAud: 2.5 }, reason: "", confirm: true });
check("critical spending changes require a reason", http.status === 400 && http.body?.code === "reason_required", http.body);

http = await call("/spending/settings", {
  limits: {
    monthlyBudgetAud: 4,
    monthlyHardLimitAud: 5,
    dailyLimitAud: 2.5,
    perUserDailyLimitAud: 0.5,
    perUserMonthlyLimitAud: 1.5,
    requestsPerDay: 200,
    tokensPerDay: 90000,
    requestsPerDayPerUser: 50,
    tokensPerDayPerUser: 50000,
  },
  warningThresholds: [50, 80],
  modelLimits: { [ref]: { dailyAud: 1, monthlyAud: 2 } },
  reason: "Phase 6.6 focused test",
  confirm: true,
});
check("confirmed spending settings save", http.status === 200 && http.body?.ok === true, http.body);
check("saved threshold is returned", JSON.stringify(http.body?.spending?.limits?.warningThresholds) === "[50,80]");
check("saved per-user monthly limit is returned", http.body?.spending?.limits?.perUserMonthlyLimitAud === 1.5);
check("saved per-model limit is returned", http.body?.spending?.limits?.modelLimits?.[ref]?.monthlyAud === 2);

overrides.resetOverridesCache();
config = configModule.loadAiConfig();
check("config reads the saved thresholds", JSON.stringify(config.warningThresholds) === "[50,80]");
check("config reads the saved model limit", config.modelLimits[ref]?.dailyAud === 1);

const auditPath = path.join(workdir, "data", "admin-audit.json");
const auditEntries = JSON.parse(fs.readFileSync(auditPath, "utf8")).entries as Array<any>;
check(
  "limit changes are audited with actor, reason and outcome",
  auditEntries.some(
    (entry) =>
      entry.action === "ai.spending.settings.change" &&
      entry.success === true &&
      entry.actorId &&
      entry.metadata?.reason === "Phase 6.6 focused test",
  ),
  auditEntries.slice(-3),
);

// The legacy settings route cannot silently change critical settings or the
// emergency switch.
http = await call("/settings", { limits: { dailyLimitAud: 1 } });
check("legacy settings route also requires confirmation for limits", http.status === 400 && http.body?.code === "confirmation_required", http.body);
http = await call("/settings", { emergencyPaused: true });
check("emergency state cannot bypass its audited route", http.status === 400 && http.body?.code === "use_emergency_control", http.body);

// --- atomic local reservations ---------------------------------------------
usage.resetLedgerCache();
const first = await spend.reserveProtectedSpend({
  maxCostAud: 0.6,
  dailyLimitAud: 1,
  monthlyHardLimitAud: 10,
});
const second = await spend.reserveProtectedSpend({
  maxCostAud: 0.6,
  dailyLimitAud: 1,
  monthlyHardLimitAud: 10,
});
check("first concurrent reservation passes", first.allowed);
check("second concurrent reservation sees the first outstanding amount", !second.allowed && second.reason === "daily-budget", second);
await first.release();
const third = await spend.reserveProtectedSpend({
  maxCostAud: 0.6,
  dailyLimitAud: 1,
  monthlyHardLimitAud: 10,
});
check("released headroom can be reserved again", third.allowed);
await third.release();

// --- backend enforcement on a direct call ----------------------------------
overrides.saveOverrides(
  { limits: { dailyLimitAud: 0.0001, monthlyHardLimitAud: 10 }, emergencyPaused: false },
  false,
);
overrides.resetOverridesCache();
usage.resetLedgerCache();
let directCode = "";
try {
  await service.chat({ message: "plan my day", userKey: "f".repeat(40), requestId: "direct-budget-01" });
} catch (error) {
  directCode = error instanceof service.AiError ? error.code : "wrong-error";
}
check("direct service calls cannot bypass the daily limit", directCode === "daily-budget", directCode);

const directUser = "a".repeat(40);
const directCookie = `serene_session=${auth.createTestSession(directUser)}`;
await fetch(`${baseOrigin}/api/ai/credits/register`, {
  method: "POST",
  headers: { Cookie: directCookie, "Content-Type": "application/json" },
  body: "{}",
});
const directResponse = await fetch(`${baseOrigin}/api/ai/chat`, {
  method: "POST",
  headers: { Cookie: directCookie, "Content-Type": "application/json", "x-ai-request-id": "direct-api-budget-01" },
  body: JSON.stringify({ message: "plan my day", history: [], context: {} }),
});
const directBody = (await directResponse.json()) as any;
check(
  "a direct HTTP API call cannot bypass the daily limit",
  directResponse.status === 429 && directBody?.code === "daily-budget",
  { status: directResponse.status, body: directBody },
);

// --- emergency pause leaves an in-flight request alone ----------------------
overrides.saveOverrides(
  { limits: { dailyLimitAud: 10, monthlyHardLimitAud: 100 }, emergencyPaused: false },
  false,
);
overrides.resetOverridesCache();
usage.resetLedgerCache();
const realFetch = globalThis.fetch;
let releaseFetch: (() => void) | null = null;
let markStarted: (() => void) | null = null;
const started = new Promise<void>((resolve) => {
  markStarted = resolve;
});
const held = new Promise<Response>((resolve) => {
  releaseFetch = () =>
    resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Finished after the pause." } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
});
(globalThis as any).fetch = async () => {
  markStarted?.();
  return held;
};

const inFlight = service.chat({
  message: "keep going",
  userKey: "e".repeat(40),
  requestId: "in-flight-pause-01",
});
await started;
overrides.saveOverrides(
  {
    emergencyPaused: true,
    emergencyReason: "Focused in-flight test",
    emergencyAt: new Date().toISOString(),
    emergencyBy: "test-admin",
  },
  false,
);
releaseFetch?.();
const finished = await inFlight;
(globalThis as any).fetch = realFetch;
check("an in-flight request is not cancelled by emergency pause", finished.reply === "Finished after the pause.", finished.reply);

let blockedCode = "";
try {
  await service.chat({ message: "new request", userKey: "e".repeat(40), requestId: "after-pause-01" });
} catch (error) {
  blockedCode = error instanceof service.AiError ? error.code : "wrong-error";
}
check("new requests are blocked while paused", blockedCode === "ai_disabled", blockedCode);

// --- emergency route and status ---------------------------------------------
http = await call("/spending/emergency", { paused: false, reason: "resume for test", confirm: true });
check("emergency resume requires and accepts confirmation", http.status === 200 && http.body?.spending?.status?.paused === false, http.body);
http = await call("/spending/emergency", { paused: true, reason: "pause for test", confirm: true });
check("emergency pause updates system status", http.status === 200 && http.body?.spending?.status?.pausedByEmergency === true, http.body);
http = await call("/spending/emergency", { paused: false, reason: "resume for test", confirm: true });
check("emergency resumes after the check", http.status === 200 && http.body?.spending?.status?.enabled === true, http.body);

await new Promise<void>((resolve) => listener.close(() => resolve()));

console.log("");
if (fail === 0) {
  console.log(`PASS ${pass} / ${pass + fail}`);
  console.log("AI_SPENDING_SAFETY_TESTS_OK");
} else {
  console.error(`PASS ${pass} / ${pass + fail}`);
  process.exitCode = 1;
}

fs.rmSync(workdir, { recursive: true, force: true });
