/**
 * System tests for the AI operator dashboard.
 *
 * These exercise the persisted overrides, the admin token comparison, the
 * extended content-free ledger and the overview payload. HTTP authorisation is
 * checked separately against a running server, because these tests never bind
 * a port.
 *
 * Run with: npm run ai:admin:test
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

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-admin-"));
process.chdir(workdir);
process.env.FREEBUFF_API_KEY = "test-freebuff-key-value";
process.env.FREEBUFF_MODEL = "test-model";
process.env.FREEBUFF_MODELS = "test-large,test-small";
delete process.env.OPENAI_API_KEY;
delete process.env.HUGGINGFACE_API_KEY;
process.env.OPENAI_ENABLED = "false";
delete process.env.AI_DEFAULT_MODEL;
delete process.env.AI_BACKUP_MODEL;
delete process.env.AI_ADMIN_TOKEN;

const overrides = await import("../server/ai/overrides");
const configModule = await import("../server/ai/config");
const usage = await import("../server/ai/usage");
const admin = await import("../server/ai/admin");
const adminClient = await import("../src/lib/aiAdmin");

const model = {
  id: "test-model",
  provider: "freebuff" as const,
  label: "Test model",
  price: { inputPerMillion: 1, outputPerMillion: 2, source: "test" },
  capabilities: { streaming: true, tools: true, structuredOutputs: true },
};

// --- overrides validation -------------------------------------------------

const cleaned = overrides.cleanOverrides({
  providers: { freebuff: false, gemini: true },
  defaultModel: "freebuff:test-model",
  backupModel: "not a ref!!",
  limits: { costPerMonthUsd: -5, requestsPerDay: 999_999, tokensPerDay: "nope" },
  providerLimits: { freebuff: 0, openai: 50, unknown: 3 },
});

check("unknown provider is dropped", !("gemini" in (cleaned.providers || {})));
check("known provider switch is kept", cleaned.providers?.freebuff === false);
check("valid model ref is kept", cleaned.defaultModel === "freebuff:test-model");
check("malformed model ref is dropped", cleaned.backupModel === undefined);
check("negative cost clamps to zero", cleaned.limits?.costPerMonthUsd === 0);
check("huge request limit clamps", cleaned.limits?.requestsPerDay === 100_000);
check("non-numeric limit is ignored", cleaned.limits?.tokensPerDay === undefined);
check("provider limit clamps to one", cleaned.providerLimits?.freebuff === 1);
check("unknown provider limit is dropped", !("unknown" in (cleaned.providerLimits || {})));

const audCleaned = overrides.cleanOverrides({
  limits: { monthlyBudgetAud: -5, monthlyHardLimitAud: 40, dailyLimitAud: 2 },
});
check("negative AUD budget clamps to zero", audCleaned.limits?.monthlyBudgetAud === 0);
check("AUD monthly hard limit is kept", audCleaned.limits?.monthlyHardLimitAud === 40);
check("AUD daily limit is kept", audCleaned.limits?.dailyLimitAud === 2);

check("AUD formatter prefixes A$", adminClient.aud(12.5) === "A$12.50");
check("AUD formatter keeps sub-cent precision", adminClient.aud(0.0042) === "A$0.0042");
check("legacy USD formatter remains available", adminClient.money(12.5) === "$12.50");

// --- admin token ----------------------------------------------------------

check("admin is off without a token", overrides.adminConfigured() === false);
process.env.AI_ADMIN_TOKEN = "test-admin-token-123456";
check("admin is on with a token", overrides.adminConfigured() === true);
check("correct token matches", overrides.adminTokenMatches("test-admin-token-123456"));
check("wrong token is rejected", overrides.adminTokenMatches("test-admin-token") === false);
check("empty token is rejected", overrides.adminTokenMatches("") === false);
check("undefined token is rejected", overrides.adminTokenMatches(undefined) === false);

// --- persistence and config wiring ---------------------------------------

overrides.saveOverrides({
  providers: { freebuff: false },
  limits: { costPerMonthUsd: 7, costPerDayUsd: 0.5 },
  providerLimits: { freebuff: 5 },
});
overrides.resetOverridesCache();
const reloaded = overrides.loadOverrides();
check("overrides persist to disk", reloaded.limits?.costPerMonthUsd === 7);
check("override timestamp is written", typeof reloaded.updatedAt === "string");

let config = configModule.loadAiConfig();
const freebuff = config.providers.find((provider) => provider.id === "freebuff");
check("dashboard can disable a configured provider", freebuff?.enabled === false);
check("disabled provider explains why", freebuff?.disabledReason === "Disabled in the AI dashboard");
check("monthly limit override applies", config.limits.costPerMonthUsd === 7);
check("daily limit override applies", config.limits.costPerDayUsd === 0.5);
check("provider daily override applies", freebuff?.limits.requestsPerDay === 5);
check("assistant reports itself offline with no enabled provider", config.enabled === false);

overrides.saveOverrides({
  limits: { monthlyBudgetAud: 20, monthlyHardLimitAud: 25, dailyLimitAud: 2.5 },
});
overrides.resetOverridesCache();
const audReloaded = overrides.loadOverrides();
check("AUD budget overrides persist to disk", audReloaded.limits?.monthlyBudgetAud === 20);
check("AUD hard limit overrides persist to disk", audReloaded.limits?.monthlyHardLimitAud === 25);
config = configModule.loadAiConfig();
check("AUD monthly target override applies", config.limits.monthlyBudgetAud === 20);
check("AUD monthly hard limit override applies", config.limits.monthlyHardLimitAud === 25);
check("AUD daily limit override applies", config.limits.dailyLimitAud === 2.5);

overrides.saveOverrides({
  providers: { freebuff: true },
  defaultModel: "freebuff:test-small",
  backupModel: "freebuff:test-large",
});
overrides.resetOverridesCache();
config = configModule.loadAiConfig();
check("dashboard can re-enable a provider", config.providers.find((p) => p.id === "freebuff")?.enabled === true);
check("primary model selection applies", config.defaultModel?.id === "test-small");
check("backup model selection applies", config.backupModel?.id === "test-large");
check("assistant is online again", config.enabled === true);

// --- ledger and performance ----------------------------------------------

fs.rmSync(path.join(workdir, "data", "ai-usage.json"), { force: true });
usage.resetLedgerCache();
usage.recordUsage({
  model,
  inputTokens: 1_000,
  outputTokens: 500,
  clientId: "client-a",
  userKey: "a".repeat(40),
  latencyMs: 120,
  fellBack: true,
});
usage.recordFailure({ provider: "freebuff", model: "test-model", rateLimited: true });
usage.recordSafety("blocked", "csam");
usage.recordSafety("moderation", "self-harm");
usage.recordSafety("reported", "report-unsafe");
usage.recordSafety("blocked", "this is a private message");

let summary = usage.summariseUsage();
check("requests are counted", summary.today.requests === 1);
check("latency is recorded", summary.performance.avgLatencyMs === 120);
check("fallback is recorded", summary.performance.fallbacks === 1);
check("failures are recorded", summary.performance.failures === 1);
check("rate limits are recorded", summary.performance.rateLimited === 1);
check("error rate is derived", summary.performance.errorRate > 0.4);
check("daily history has a row", summary.history.length === 1 && summary.history[0].requests === 1);
check("blocked requests are counted", summary.safety.blockedRequests === 2);
check("moderation events are counted", summary.safety.moderationEvents === 1);
check("reports are counted", summary.safety.reportedResponses === 1);
check("flag names are stored", summary.safety.byFlag.csam === 1);
check("unsafe flag text is not stored", !("this is a private message" in summary.safety.byFlag));
check("cache hits start at zero", summary.cacheHits === 0);

const zeroCost = usage.checkLimits({
  requestsPerDay: 100,
  tokensPerDay: 100_000,
  costPerDayUsd: 0,
  costPerMonthUsd: 100,
});
check("daily cost limit blocks requests", zeroCost.allowed === false && zeroCost.reason === "daily-budget");

const monthly = usage.checkLimits({
  requestsPerDay: 100,
  tokensPerDay: 100_000,
  costPerDayUsd: 100,
  costPerMonthUsd: 0,
});
check("monthly budget blocks requests", monthly.allowed === false && monthly.reason === "monthly-budget");

const providerLimit = usage.checkProviderLimit("freebuff", 1);
check("provider daily limit blocks", providerLimit.allowed === false);

// --- overview payload -----------------------------------------------------

const overview = admin.buildOverview();
const serialised = JSON.stringify(overview);
check("overview lists every provider", overview.providers.length === 3);
check("overview includes usage", overview.usage.today.requests === 1);
check("overview includes performance", typeof overview.usage.performance.avgLatencyMs === "number");
check("overview includes safety counters", overview.usage.safety.blockedRequests === 2);
check("overview includes provider limits without dropping saved overrides", overview.providers.find((p) => p.id === "freebuff")?.limits.requestsPerDay === 5);
check("overview shows the selected primary", overview.defaultModel === "freebuff:test-small");
check("overview reports AUD budget currency", overview.budget.currency === "AUD");
check("overview budget uses the AUD monthly target", overview.budget.monthlyBudgetAud === 20);
check("overview budget uses the AUD hard limit", overview.budget.monthlyHardLimitAud === 25);
check("overview budget uses the AUD daily limit", overview.budget.dailyLimitAud === 2.5);
check(
  "overview monthly spend matches the AUD ledger",
  overview.budget.currentMonthAud === overview.usage.thisMonth.costAud,
  { budget: overview.budget.currentMonthAud, ledger: overview.usage.thisMonth.costAud },
);
check(
  "overview daily spend matches the AUD ledger",
  overview.budget.currentDayAud === overview.usage.today.costAud,
  { budget: overview.budget.currentDayAud, ledger: overview.usage.today.costAud },
);
check("overview exposes AUD totals", typeof overview.usage.totals.costAud === "number");
check("overview exposes AUD averages", typeof overview.usage.totals.averageCostPerRequestAud === "number" && typeof overview.usage.totals.averageCostPerUserAud === "number");
check("overview preserves USD averages for older clients", typeof overview.usage.totals.averageCostPerRequest === "number" && typeof overview.usage.totals.averageCostPerUser === "number");
check(
  "AUD spend is converted once at the exposed USD rate",
  Math.abs(overview.usage.thisMonth.costAud - Number((overview.usage.thisMonth.costUsd * overview.currency.rates.USD).toFixed(4))) < 1e-9,
  { aud: overview.usage.thisMonth.costAud, usd: overview.usage.thisMonth.costUsd, rate: overview.currency.rates.USD },
);
check("overview never contains the API key", !serialised.includes("test-freebuff-key-value"));
check("overview never contains an authorization header", !/authorization/i.test(serialised));
check("overview has no conversation field", !/"conversations?"/.test(serialised));
check("overview marks key presence only", overview.providers.find((p) => p.id === "freebuff")?.keyPresent === true);

// --- HTTP authorisation ---------------------------------------------------

const app = express();
app.use("/api/ai/admin", express.json({ limit: "32kb" }), admin.default);
const listener = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => listener.once("listening", () => resolve()));
const origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/api/ai/admin`;

const call = async (route: string, init?: RequestInit) => {
  const response = await fetch(`${origin}${route}`, init);
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
};

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let http = await call("/overview");
check("overview without a token is rejected", http.status === 401, http.status);

http = await call("/overview", { headers: bearer("wrong-token") });
check("overview with a wrong token is rejected", http.status === 401, http.status);

http = await call("/overview", { headers: bearer("test-admin-token-123456") });
check("overview with the right token is allowed", http.status === 200, http.status);
check("the token is never echoed", !JSON.stringify(http.body).includes("test-admin-token-123456"));

http = await call("/settings", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ limits: { costPerDayUsd: 3 } }),
});
check("a settings write without a token is rejected", http.status === 401, http.status);

http = await call("/settings", {
  method: "POST",
  headers: { ...bearer("test-admin-token-123456"), "Content-Type": "application/json" },
  body: JSON.stringify({ defaultModel: "freebuff:does-not-exist" }),
});
check("an unknown model is refused", http.status === 400 && http.body?.code === "unknown_model", http.body);

http = await call("/settings", {
  method: "POST",
  headers: { ...bearer("test-admin-token-123456"), "Content-Type": "application/json" },
  body: JSON.stringify({ providers: { openai: true } }),
});
check(
  "a provider without a key cannot be enabled",
  http.status === 400 && http.body?.code === "provider_not_configured",
  http.body,
);

http = await call("/settings", {
  method: "POST",
  headers: { ...bearer("test-admin-token-123456"), "Content-Type": "application/json" },
  body: JSON.stringify({ limits: { costPerDayUsd: 3 }, confirm: true, reason: "test limit change" }),
});
check("an authorised change is saved", http.status === 200 && http.body?.ok === true, http.status);
check("the saved change is in the response", http.body?.overview?.limits?.costPerDayUsd === 3);

http = await call("/settings", {
  method: "POST",
  headers: { ...bearer("test-admin-token-123456"), "Content-Type": "application/json" },
  body: JSON.stringify({
    limits: { monthlyBudgetAud: 30, monthlyHardLimitAud: 40, dailyLimitAud: 3.5 },
    confirm: true,
    reason: "test AUD budget change",
  }),
});
check("AUD budget settings save", http.status === 200 && http.body?.ok === true, http.body);
check("saved AUD monthly target is returned", http.body?.overview?.limits?.monthlyBudgetAud === 30);
check("saved AUD monthly hard limit is returned", http.body?.overview?.limits?.monthlyHardLimitAud === 40);
check("saved AUD daily limit is returned", http.body?.overview?.limits?.dailyLimitAud === 3.5);
check("saved budget payload is in AUD", http.body?.overview?.budget?.currency === "AUD");

http = await call("/unknown", { headers: bearer("test-admin-token-123456") });
check("unknown admin routes return JSON 404", http.status === 404, http.status);

delete process.env.AI_ADMIN_TOKEN;
http = await call("/overview");
check("without a server token the dashboard is unavailable", http.status === 503, http.status);
process.env.AI_ADMIN_TOKEN = "test-admin-token-123456";

await new Promise<void>((resolve) => listener.close(() => resolve()));

console.log("");
if (fail === 0) {
  console.log(`PASS ${pass} / ${pass + fail}`);
  console.log("AI_ADMIN_TESTS_OK");
} else {
  console.error(`PASS ${pass} / ${pass + fail}`);
  process.exitCode = 1;
}

fs.rmSync(workdir, { recursive: true, force: true });
