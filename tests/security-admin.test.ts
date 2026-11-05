/**
 * Phase 3 administrator-security tests.
 *
 * Exercises the real Express admin router: missing/wrong credentials, user
 * session and request-field bypass attempts, the temporary break-glass token,
 * Supabase token verification, admin_users checks, and audit records.
 *
 * Supabase Auth and the admin_users lookup are mocked at the HTTP boundary.
 * No hosted Supabase project is contacted and no real credential is used.
 *
 * Run with: npm run security:test
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
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

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-security-admin-"));
process.chdir(workdir);
process.env.NODE_ENV = "test";
process.env.FREEBUFF_API_KEY = "security-admin-test-key";
process.env.FREEBUFF_MODEL = "security-test-model";
process.env.FREEBUFF_MODELS = "security-test-model";
process.env.FREEBUFF_ENABLED = "true";
delete process.env.OPENAI_API_KEY;
delete process.env.HUGGINGFACE_API_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;

const ADMIN_TOKEN = "security-admin-break-glass-token-123";
process.env.AI_ADMIN_TOKEN = ADMIN_TOKEN;

const admin = await import("../server/ai/admin");
const audit = await import("../server/security/adminAudit");

const app = express();
app.use("/api/ai/admin", express.json({ limit: "32kb" }), admin.default);
const listener = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => listener.once("listening", () => resolve()));
const base = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/api/ai/admin`;
const realFetch = globalThis.fetch;

const call = async (route: string, init?: RequestInit) => {
  const response = await realFetch(`${base}${route}`, init);
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
};

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const jsonHeaders = (token?: string) => ({
  ...(token ? bearer(token) : {}),
  "Content-Type": "application/json",
});

const auditEntries = () => audit.listLocalAdminAudit(100);

try {
  // --- break-glass and request-field bypasses ------------------------------

  let response = await call("/overview");
  check("unauthenticated overview is rejected", response.status === 401, response.status);

  response = await call("/overview", {
    headers: { Cookie: "serene_session=ordinary-user-session" },
  });
  check("an ordinary app session cannot open the admin API", response.status === 401, response.status);

  response = await call("/overview?admin=true&token=" + ADMIN_TOKEN, {
    headers: { "x-serene-user": "a".repeat(40), "x-admin": "true" },
  });
  check("query and header role claims do not grant admin", response.status === 401, response.status);

  response = await call("/overview", {
    headers: { ...jsonHeaders(), "x-serene-role": "admin" },
  });
  check("an x-serene-role header does not grant admin", response.status === 401, response.status);

  response = await call("/overview", { headers: bearer("wrong-admin-token") });
  check("a wrong break-glass token is rejected", response.status === 401, response.status);

  response = await call("/overview", { headers: bearer(ADMIN_TOKEN) });
  check("the break-glass bearer token is accepted", response.status === 200, response.status);
  check("the admin response is private", response.body?.usage !== undefined, response.body);

  response = await call("/overview", { headers: { "x-admin-token": ADMIN_TOKEN } });
  check("the x-admin-token break-glass header is accepted", response.status === 200, response.status);

  response = await call("/users/ai", {
    method: "POST",
    headers: jsonHeaders(ADMIN_TOKEN),
    body: JSON.stringify({ userId: "b".repeat(40), enabled: false }),
  });
  check("an authorised break-glass change succeeds", response.status === 200 && response.body?.ok === true, response.body);

  response = await call("/settings", {
    method: "POST",
    headers: jsonHeaders(ADMIN_TOKEN),
    body: JSON.stringify({ defaultModel: "freebuff:does-not-exist" }),
  });
  check("an invalid admin change is refused", response.status === 400 && response.body?.code === "unknown_model", response.body);

  response = await call("/settings", {
    method: "POST",
    headers: jsonHeaders(ADMIN_TOKEN),
    body: JSON.stringify({ providers: { openai: true } }),
  });
  check("an unconfigured provider cannot be enabled", response.status === 400 && response.body?.code === "provider_not_configured", response.body);

  response = await call("/credits/plan", {
    method: "POST",
    headers: jsonHeaders(ADMIN_TOKEN),
    body: JSON.stringify({ userId: "not-a-user", plan: "plus" }),
  });
  check("an invalid target user is refused", response.status === 400, response.body);

  const local = auditEntries();
  const change = local.find((entry) => entry.action === "users.ai.change" && entry.success);
  const failedSettings = local.find(
    (entry) => entry.action === "ai.settings.change" && entry.errorCode === "unknown_model",
  );
  const failedPlan = local.find((entry) => entry.action === "credits.plan.change" && !entry.success);
  check("the successful admin change is audited", Boolean(change), { local });
  check("a failed admin change is audited", Boolean(failedSettings), { local });
  check("the failed target-user change is audited", Boolean(failedPlan), { local });
  check("the audit identifies the admin path without the token", change?.actorType === "break_glass"
    && change.actorId.startsWith("break_glass:")
    && !JSON.stringify(local).includes(ADMIN_TOKEN), change);
  check("the audit records the target and metadata", change?.targetUserId === "b".repeat(40)
    && change.metadata.enabled === false, change);
  check("failed audit rows carry a safe error code", failedSettings?.errorCode === "unknown_model"
    && failedPlan?.errorCode === "bad_user_id", { failedSettings, failedPlan });

  const auditFile = path.join(workdir, "data", "admin-audit.json");
  const auditMode = fs.statSync(auditFile).mode & 0o777;
  check("the local audit file is owner-only", auditMode === 0o600, auditMode.toString(8));
  check("the audit file never contains the break-glass token", !fs.readFileSync(auditFile, "utf8").includes(ADMIN_TOKEN));

  // --- mocked Supabase administrator path ---------------------------------

  delete process.env.AI_ADMIN_TOKEN;
  process.env.SUPABASE_URL = "https://phase3-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key-value";
  process.env.SUPABASE_ANON_KEY = "test-anon-key-value";

  const adminId = randomUUID();
  const userId = randomUUID();
  let auditRpcCalls = 0;

  const supabaseFetch = async (input: any, init?: any): Promise<Response> => {
    const url = typeof input === "string" ? input : input?.url || "";
    if (!url.startsWith(process.env.SUPABASE_URL!)) return realFetch(input, init);

    const headers = new Headers(init?.headers as HeadersInit | undefined);
    const auth = headers.get("authorization") || "";

    if (url.endsWith("/auth/v1/user")) {
      if (auth === "Bearer admin.jwt.token") {
        return new Response(JSON.stringify({ id: adminId, email: "admin@example.test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (auth === "Bearer ordinary.jwt.token") {
        return new Response(
          JSON.stringify({
            id: userId,
            email: "user@example.test",
            user_metadata: { role: "admin", is_admin: true },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ message: "invalid token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/rest/v1/admin_users")) {
      const rows = url.includes(encodeURIComponent(adminId)) ? [{ user_id: adminId }] : [];
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/rest/v1/rpc/record_admin_audit")) {
      auditRpcCalls += 1;
      return new Response(null, { status: 204 });
    }

    return new Response(JSON.stringify({ message: "unexpected test request" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  };
  (globalThis as any).fetch = supabaseFetch;

  response = await call("/overview");
  check("Supabase mode still rejects a missing token", response.status === 401, response.status);

  response = await call("/overview", { headers: bearer("expired.jwt.token") });
  check("an invalid or expired Supabase token is rejected", response.status === 401, response.status);

  response = await call("/overview", { headers: bearer("ordinary.jwt.token") });
  check("a normal Supabase user cannot access admin", response.status === 403, response.status);

  response = await call("/overview?role=admin", {
    headers: { ...bearer("ordinary.jwt.token"), "x-admin": "true" },
  });
  check("query and header claims cannot promote a normal user", response.status === 403, response.status);

  response = await call("/overview", { headers: { "x-admin-token": "ordinary.jwt.token" } });
  check("user_metadata cannot promote a normal user", response.status === 403, response.status);

  response = await call("/overview", { headers: bearer("admin.jwt.token") });
  check("a trusted admin_users member can access admin", response.status === 200, response.status);

  response = await call("/settings", {
    method: "POST",
    headers: jsonHeaders("admin.jwt.token"),
    body: JSON.stringify({ limits: { costPerDayUsd: 2 }, confirm: true, reason: "security test change" }),
  });
  check("a trusted administrator can make an authorised change", response.status === 200 && response.body?.ok === true, response.body);
  check("the Supabase audit RPC is called for the change", auditRpcCalls > 0, auditRpcCalls);

  response = await call("/settings", {
    method: "POST",
    headers: jsonHeaders("ordinary.jwt.token"),
    body: JSON.stringify({ limits: { costPerDayUsd: 3 } }),
  });
  check("a normal user cannot make an admin change", response.status === 403, response.status);

  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  response = await call("/overview");
  check("admin is unavailable when no credential source is configured", response.status === 503, response.status);
} catch (error) {
  fail += 1;
  console.error("SUITE FAILED:", error);
} finally {
  (globalThis as any).fetch = realFetch;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  console.log("");
  if (fail === 0) {
    console.log(`PASS ${pass} / ${pass + fail}`);
    console.log("SECURITY_ADMIN_TESTS_OK");
  } else {
    console.error(`PASS ${pass} / ${pass + fail}`);
    process.exitCode = 1;
  }
  fs.rmSync(workdir, { recursive: true, force: true });
}
