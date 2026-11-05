/**
 * Phase 6.5 model/provider management checks.
 *
 * Run with: npm run ai:admin:models:test
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

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-models-"));
process.chdir(workdir);
process.env.FREEBUFF_API_KEY = "test-freebuff-key-value";
process.env.FREEBUFF_MODELS = "large,small,third";
process.env.FREEBUFF_INPUT_PRICE_PER_MILLION = "1";
process.env.FREEBUFF_OUTPUT_PRICE_PER_MILLION = "2";
delete process.env.OPENAI_API_KEY;
delete process.env.HUGGINGFACE_API_KEY;
process.env.OPENAI_ENABLED = "false";
delete process.env.AI_DEFAULT_MODEL;
delete process.env.AI_BACKUP_MODEL;
delete process.env.AI_ADMIN_TOKEN;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.AI_ADMIN_TOKEN = "test-admin-token-123456";

const overrides = await import("../server/ai/overrides");
const configModule = await import("../server/ai/config");
const service = await import("../server/ai/service");
const admin = await import("../server/ai/admin");
const audit = await import("../server/security/adminAudit");

const ref = (id: string) => `freebuff:${id}`;
const reset = () => overrides.resetOverridesCache();

// --- validation and persistence ------------------------------------------
const cleaned = overrides.cleanOverrides({
  featureModels: {
    planning: "freebuff:small",
    budget: "",
    habits: null,
    unknown_feature: "freebuff:large",
  },
  fallbackModels: ["freebuff:third", "freebuff:third", "bad ref"],
  disabledModels: ["freebuff:small", "freebuff:small"],
});
check("feature refs are cleaned", cleaned.featureModels?.planning === "freebuff:small");
check("empty feature refs clear an assignment", cleaned.featureModels?.budget === null);
check("null feature refs clear an assignment", cleaned.featureModels?.habits === null);
check("unknown features are dropped", !("unknown_feature" in (cleaned.featureModels || {})));
check("fallback refs are deduplicated and invalid refs dropped", cleaned.fallbackModels?.length === 1);

overrides.saveOverrides({
  defaultModel: ref("large"),
  featureModels: { planning: ref("small") },
  fallbackModels: [ref("third")],
  disabledModels: [],
});
reset();
let config = configModule.loadAiConfig();
check("default model is preserved", config.defaultModel?.id === "large");
check("feature model assignment resolves", config.featureModels.planning?.id === "small");
check("fallback model resolves", config.fallbackModels[0]?.id === "third");
check("all configured models are visible", config.providers.find((p) => p.id === "freebuff")?.models.length === 3);
check(
  "models default to enabled",
  config.providers.find((p) => p.id === "freebuff")?.models.every((model) => model.enabled !== false) === true,
);

let chain = service.buildModelChain(config, { message: "hello", mode: "planning" }).map((model) => model.id);
check("feature model is tried first", chain[0] === "small", chain);
check("fallback follows the primary", chain.includes("third"), chain);
check("chain has no duplicates", new Set(chain).size === chain.length, chain);

chain = service.buildModelChain(config, { message: "hello", mode: "budget" }).map((model) => model.id);
check("unassigned feature uses the primary model", chain[0] === "large", chain);

// --- HTTP validation, unavailable model prevention, restore ---------------
const app = express();
app.use("/api/ai/admin", express.json({ limit: "32kb" }), admin.default);
const listener = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => listener.once("listening", () => resolve()));
const origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/api/ai/admin`;
const bearer = { Authorization: "Bearer test-admin-token-123456" };

const call = async (route: string, body?: unknown) => {
  const response = await fetch(`${origin}${route}`, {
    method: "POST",
    headers: { ...bearer, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  let json: any = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, body: json };
};

let http = await call("/settings/test", {
  defaultModel: ref("small"),
  fallbackModels: [ref("large")],
  featureModels: { planning: ref("third") },
  disabledModels: [],
});
check("dry-run accepts a valid selection", http.status === 200 && http.body?.ok === true, http.body);
check("dry-run reports the effective chain", http.body?.chain?.[0] === ref("small"), http.body);
check(
  "dry-run reports a feature-specific chain",
  http.body?.featureChains?.planning?.[0] === ref("third"),
  http.body?.featureChains,
);
check("dry-run does not leak the provider key", !JSON.stringify(http.body).includes("test-freebuff-key-value"));

http = await call("/settings/test", { defaultModel: ref("missing") });
check(
  "dry-run refuses an unknown model",
  http.status === 400 && http.body?.code === "unknown_model",
  http.body,
);

http = await call("/settings", {
  defaultModel: ref("small"),
  featureModels: { planning: ref("third") },
  fallbackModels: [ref("large")],
  disabledModels: [],
});
check("valid model configuration saves", http.status === 200 && http.body?.ok === true, http.body);
check("saved feature assignment is returned", http.body?.overview?.featureModels?.planning === ref("third"));

http = await call("/settings", { disabledModels: [ref("small")] });
check(
  "a model used by the primary cannot be disabled",
  http.status === 400 && http.body?.code === "model_disabled",
  http.body,
);

http = await call("/settings", {
  defaultModel: ref("large"),
  featureModels: { planning: null },
  fallbackModels: [ref("third")],
  disabledModels: [ref("small")],
});
check("unused model can be disabled", http.status === 200 && http.body?.ok === true, http.body);
check(
  "disabled state is returned in the overview",
  http.body?.overview?.providers
    ?.find((provider: any) => provider.id === "freebuff")
    ?.models.find((model: any) => model.id === "small")?.enabled === false,
  http.body?.overview?.providers,
);

reset();
config = configModule.loadAiConfig();
check("disabled model is skipped by the service chain", !service.buildModelChain(config, { message: "hi" }).some((model) => model.id === "small"));

http = await call("/settings", { defaultModel: ref("small") });
check(
  "an unavailable model cannot be selected",
  http.status === 400 && http.body?.code === "model_disabled",
  http.body,
);

http = await call("/settings/restore");
check("restore endpoint succeeds", http.status === 200 && http.body?.ok === true, http.body);
check("restore returns the previous model configuration", http.body?.overview?.defaultModel === ref("small"));
check(
  "restore re-enables the previously disabled model",
  http.body?.overview?.providers
    ?.find((provider: any) => provider.id === "freebuff")
    ?.models.find((model: any) => model.id === "small")?.enabled === true,
);

const auditEntries = audit.listLocalAdminAudit(20);
check(
  "configuration changes are audited",
  auditEntries.some((entry) => entry.action === "ai.settings.change" && entry.success),
);
check(
  "restores are audited",
  auditEntries.some((entry) => entry.action === "ai.settings.restore" && entry.success),
);
check(
  "audit metadata does not contain the provider key",
  !JSON.stringify(auditEntries).includes("test-freebuff-key-value"),
);

await new Promise<void>((resolve) => listener.close(() => resolve()));
console.log("");
if (fail === 0) {
  console.log(`PASS ${pass} / ${pass + fail}`);
  console.log("AI_MODEL_ADMIN_TESTS_OK");
} else {
  console.error(`PASS ${pass} / ${pass + fail}`);
  process.exitCode = 1;
}
fs.rmSync(workdir, { recursive: true, force: true });
