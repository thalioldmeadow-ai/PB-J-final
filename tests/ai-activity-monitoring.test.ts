/**
 * Phase 6.7 user activity and security monitoring checks.
 *
 * Run with: npm run ai:admin:monitoring:test
 *
 * The suite uses the local, server-only ledger. It verifies real-record
 * aggregation, basic alert thresholds, search/date filters, audit-backed review
 * notes, admin-only access and the absence of automatic account action.
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

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-monitoring-"));
process.chdir(workdir);
process.env.NODE_ENV = "test";
process.env.AI_ADMIN_TOKEN = "monitoring-admin-token-123456";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;

const usage = await import("../server/ai/usage");
const credits = await import("../server/ai/credits");
const admin = await import("../server/ai/admin");

const userId = "a1b2c3d4".repeat(5);
const otherUserId = "f1e2d3c4".repeat(5);
const now = new Date().toISOString();

credits.ensureCreditAccount(userId);
credits.ensureCreditAccount(otherUserId);
// One settled credit transaction for the recent-transactions view.
const reserved = credits.reserveCredits({
  userId,
  action: "simple_message",
  requestId: "monitoring-credit-request-01",
});
credits.settleCredits({ userId, requestId: "monitoring-credit-request-01" });
const before = credits.creditSummary(userId);

usage.resetLedgerCache();
for (let index = 0; index < 100; index += 1) {
  usage.recordRequest({
    requestId: `monitoring-request-${String(index).padStart(4, "0")}`,
    userId,
    provider: "freebuff",
    model: "small",
    action: "simple_message",
    plan: "free",
    inputTokens: 10,
    outputTokens: 5,
    credits: index === 0 ? reserved.credits : 0,
    costUsd: 0,
    costAud: 0,
    durationMs: 10,
    status: index < 30 ? "failed" : "success",
    timestamp: now,
  });
}

const app = express();
app.use("/api/ai/admin", express.json({ limit: "32kb" }), admin.default);
const listener = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => listener.once("listening", () => resolve()));
const base = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/api/ai/admin`;
const bearer = { Authorization: "Bearer monitoring-admin-token-123456" };

const call = async (route: string, body?: unknown) => {
  const response = await fetch(`${base}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(route.includes("unauthenticated") ? {} : bearer),
    },
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

let response = await fetch(`${base}/monitoring`, { method: "GET" });
check("monitoring rejects requests without admin authentication", response.status === 401, response.status);
response = await fetch(`${base}/monitoring`, { headers: bearer });
const firstBody = await response.json();
check("activity view is admin-only readable", response.status === 200 && firstBody?.source === "local", firstBody);

let view = await call("/monitoring?preset=last30");
check("registered accounts include all local wallets", view.body?.summary?.totalAccounts === 2, view.body?.summary);
check("account search returns the matching record", view.body?.users?.[0]?.userId === userId, view.body?.users?.[0]);
check("AI requests and failures are aggregated per user", view.body?.users?.[0]?.requests === 100 && view.body?.users?.[0]?.failedRequests === 30, view.body?.users?.[0]);
check("high request volume is flagged", view.body?.alerts?.some((alert: any) => alert.rule === "high_ai_request_volume"), view.body?.alerts);
check("repeated failures are flagged", view.body?.alerts?.some((alert: any) => alert.rule === "repeated_failed_requests"), view.body?.alerts);
check("rules identify threshold estimates and unavailable auth monitoring", view.body?.rules?.some((rule: any) => rule.kind === "threshold") && view.body?.rules?.some((rule: any) => rule.kind === "estimate") && view.body?.rules?.some((rule: any) => rule.rule === "suspicious_authentication_activity" || rule.key === "suspicious_authentication_activity"), view.body?.rules);
check("recent credit transactions are visible", view.body?.recentTransactions?.length >= 1, view.body?.recentTransactions);

view = await call(`/monitoring?preset=last30&search=${encodeURIComponent(userId.slice(0, 8))}`);
check("user search filters the account list", view.body?.totalUsers === 1 && view.body?.users?.[0]?.userId === userId, view.body?.users);
view = await call("/monitoring?preset=last30&severity=high");
check("severity filter returns only high alerts", view.body?.alerts?.length > 0 && view.body.alerts.every((alert: any) => alert.severity === "high"), view.body?.alerts);
view = await call("/monitoring?preset=custom&from=2099-01-01&to=2099-01-02");
check("date filter excludes activity outside the range", view.body?.summary?.totalRequests === 0 && view.body?.alerts?.length === 0, { summary: view.body?.summary, alerts: view.body?.alerts });

view = await call("/monitoring?preset=last30");
const alert = view.body?.alerts?.find((entry: any) => entry.rule === "high_ai_request_volume")!;
check("an alert exposes related request records", alert?.relatedRequests?.length > 0, alert?.relatedRequests);
const note = "Checked with the operator. No account action taken.";
let result = await call("/monitoring/alerts/review", { alertKey: alert.key, status: "reviewed", note });
check("an administrator can mark an alert reviewed with a note", result.status === 200 && result.body?.automaticAction === false, result.body);

view = await call("/monitoring?preset=last30");
const reviewed = view.body?.alerts?.find((entry: any) => entry.key === alert.key);
check("review state and note survive reload", reviewed?.status === "reviewed" && reviewed?.note === note, reviewed);
check("review records the administrator identity", Boolean(reviewed?.reviewedBy), reviewed);

const auditPath = path.join(workdir, "data", "admin-audit.json");
const audit = JSON.parse(fs.readFileSync(auditPath, "utf8")).entries as Array<any>;
check(
  "review and note are written to the audit log",
  audit.some(
    (entry) =>
      entry.action === "monitoring.alert.review" &&
      entry.success === true &&
      entry.metadata?.alertKey === alert.key &&
      entry.metadata?.note === note &&
      entry.metadata?.automaticAction === false,
  ),
  audit.slice(0, 3),
);

result = await call("/monitoring/alerts/review", { alertKey: alert.key, status: "reviewed", note: "x".repeat(1001) });
check("overlong investigation notes are rejected", result.status === 400 && result.body?.code === "note_too_long", result.body);
result = await call("/monitoring/alerts/review", { alertKey: "not-an-alert", status: "reviewed" });
check("malformed alert keys are rejected", result.status === 400 && result.body?.code === "bad_alert_key", result.body);

const after = credits.creditSummary(userId);
check("reviewing an alert does not change the wallet balance", before.balance === after.balance, { before, after });
check("reviewing an alert does not suspend or change the user plan", after.plan.id === "free" && after.subscription.status === "active", after);
check("the alert workflow never exposes an automatic ban action", reviewed?.automaticAction === undefined && result.body?.automaticAction !== true, result.body);

await new Promise<void>((resolve) => listener.close(() => resolve()));

console.log("");
if (fail === 0) {
  console.log(`PASS ${pass} / ${pass + fail}`);
  console.log("AI_ACTIVITY_MONITORING_TESTS_OK");
} else {
  console.error(`PASS ${pass} / ${pass + fail}`);
  process.exitCode = 1;
}

fs.rmSync(workdir, { recursive: true, force: true });
