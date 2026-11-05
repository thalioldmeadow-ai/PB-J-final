/**
 * RevenueCat lifecycle tests. Sandbox only: every request is local or mocked,
 * and no live RevenueCat or store credential is used.
 *
 * Run with: npm run billing:test
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

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-billing-"));
process.chdir(workdir);
process.env.NODE_ENV = "test";

process.env.REVENUECAT_ENVIRONMENT = "SANDBOX";
process.env.REVENUECAT_LIVE_PAYMENTS = "false";
process.env.REVENUECAT_PLUS_ENTITLEMENT = "plus";
process.env.REVENUECAT_PRODUCT_PLUS_MONTHLY = "serene_plus_monthly";
process.env.REVENUECAT_PRODUCT_PLUS_ANNUAL = "serene_plus_annual";
process.env.REVENUECAT_WEBHOOK_AUTH = "sandbox-webhook-secret";
process.env.REVENUECAT_SECRET_KEY = "rc_sandbox_secret";
process.env.REVENUECAT_API_BASE = "https://api.revenuecat.test/v1";

const realFetch = globalThis.fetch;
let subscriberPayload: any = {};
let revenueCatCalls = 0;

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

(globalThis as any).fetch = async (input: any, init?: any): Promise<Response> => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (!url.startsWith("https://api.revenuecat.test/v1/subscribers/")) {
    return realFetch(input, init);
  }
  revenueCatCalls += 1;
  const auth = init?.headers?.Authorization;
  if (auth !== "Bearer rc_sandbox_secret") return json(401, { error: "bad key" });
  return json(200, { subscriber: subscriberPayload });
};

const credits = await import("../server/ai/credits");
const billingRoutes = await import("../server/billing/routes");
const auth = await import("../server/auth");

const app = express();
app.use("/api/billing", express.json({ limit: "128kb" }), billingRoutes.default);
const listener = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => listener.once("listening", () => resolve()));
const port = (listener.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}/api/billing`;

const call = async (url: string, init?: RequestInit) => {
  const response = await realFetch(url, init);
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
};

const userA = "a".repeat(40);
const tokenA = "1".repeat(64);
const userB = "b".repeat(40);
const tokenB = "2".repeat(64);
const unknownUser = "f".repeat(40);

credits.registerCreditAccount({ userId: userA, token: tokenA });
credits.registerCreditAccount({ userId: userB, token: tokenB });

const future = (days: number) => Date.now() + days * 86_400_000;
let eventSequence = 0;

const makeEvent = (overrides: Record<string, unknown> = {}) => {
  eventSequence += 1;
  return {
    api_version: "1.0",
    event: {
      id: `evt-${eventSequence}`,
      type: "INITIAL_PURCHASE",
      app_user_id: userA,
      original_app_user_id: userA,
      aliases: [userA],
      product_id: "serene_plus_monthly",
      entitlement_ids: ["plus"],
      entitlement_id: "plus",
      environment: "SANDBOX",
      purchased_at_ms: Date.now(),
      expiration_at_ms: future(30),
      event_timestamp_ms: Date.now(),
      ...overrides,
    },
  };
};

const webhook = (payload: any, auth = "sandbox-webhook-secret") =>
  call(`${base}/revenuecat/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(payload),
  });

const wallet = (userId = userA, token = tokenA) => ({
  "Content-Type": "application/json",
  Cookie: `serene_session=${auth.createTestSession(userId)}`,
});

const summary = (userId = userA, token = tokenA) => credits.creditSummary(userId);

try {
  // --- public config and webhook authentication ---------------------------

  let response = await call(`${base}/revenuecat/config`);
  check("billing config is public", response.status === 200, response.body);
  check("billing defaults to sandbox", response.body?.billing?.sandbox === true);
  check("billing does not enable purchases", response.body?.billing?.purchasesEnabled === false);
  check("billing exposes the Plus product", response.body?.billing?.products?.some((entry: any) => entry.id === "serene_plus_monthly"));
  check("billing config never includes the secret", !JSON.stringify(response.body).includes("rc_sandbox_secret"));

  response = await webhook(makeEvent(), "");
  check("webhook rejects a missing secret", response.status === 401, response.status);
  response = await webhook(makeEvent(), "wrong-secret");
  check("webhook rejects a wrong secret", response.status === 401, response.status);

  // --- purchase and entitlement mapping -----------------------------------

  const purchaseEvent = makeEvent();
  response = await webhook(purchaseEvent);
  check("purchase webhook is accepted", response.status === 200 && response.body?.matched === true, response.body);
  let account = summary();
  check("purchase activates Plus", account.plan.id === "plus" && account.subscription.status === "active", account);
  check("purchase grants the Plus allocation", account.balance === 1000 && account.total === 1000, account.balance);
  check("purchase stores the RevenueCat customer id", credits.findCreditAccountByRevenueCatIds([userA])?.revenueCatCustomerId === userA);
  check("Plus gets extended limits", account.entitlements.memoryLimit === 30 && account.entitlements.maxAttachments === 4);

  credits.reserveCredits({ userId: userA, action: "simple_message", requestId: "req-billing-0001" });
  check("a request spends a credit", summary().balance === 999);

  const duplicate = purchaseEvent;
  response = await webhook(duplicate);
  response = await webhook(duplicate);
  check("a replayed webhook is acknowledged", response.status === 200 && response.body?.duplicate === true, response.body);
  check("a replayed purchase does not refill credits", summary().balance === 999, summary().balance);

  response = await webhook(makeEvent({ id: "evt-renewal", type: "RENEWAL", expiration_at_ms: future(60) }));
  check("renewal is accepted", response.status === 200 && response.body?.matched === true);
  account = summary();
  check("renewal refreshes the Plus allocation", account.balance === 1000, account.balance);
  check("renewal stays active", account.subscription.status === "active");

  // --- cancellation keeps access through the paid period ------------------

  response = await webhook(
    makeEvent({ id: "evt-cancel", type: "CANCELLATION", cancel_reason: "UNSUBSCRIBE" }),
  );
  account = summary();
  check("cancellation webhook is accepted", response.status === 200, response.body);
  check("cancellation reports canceled", account.subscription.status === "canceled", account.subscription);
  check("cancellation keeps Plus until expiry", account.entitlements.tier === "plus" && account.entitlements.active === true, account.entitlements);
  check("cancellation is marked at period end", account.subscription.cancelAtPeriodEnd === true);
  check("cancellation does not remove access early", account.balance === 1000);

  // A refund delivered as CANCELLATION/CUSTOMER_SUPPORT must not keep Plus.
  response = await webhook(
    makeEvent({ id: "evt-cancel-refund", type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT" }),
  );
  account = summary();
  check("refund cancellation is accepted", response.status === 200, response.body);
  check("refund cancellation removes Plus immediately", account.entitlements.tier === "free", account.entitlements);
  check("refund cancellation reports refunded", account.subscription.status === "refunded", account.subscription);

  // --- billing issue grace period -----------------------------------------

  // Re-grant Plus so the billing-issue path starts from a paid subscription.
  await webhook(makeEvent({ id: "evt-before-billing", type: "RENEWAL", expiration_at_ms: future(30) }));

  response = await webhook(
    makeEvent({
      id: "evt-billing",
      type: "BILLING_ISSUE",
      expiration_at_ms: Date.now() - 3_600_000,
      grace_period_expiration_at_ms: future(2),
    }),
  );
  account = summary();
  check("billing issue is accepted", response.status === 200, response.body);
  check("billing issue reports payment due", account.subscription.status === "past_due", account.subscription);
  check("billing issue keeps access during grace", account.entitlements.tier === "plus" && account.subscription.inGracePeriod === true, account.subscription);

  // --- expiration and refund downgrade to Free ----------------------------

  response = await webhook(
    makeEvent({ id: "evt-expire", type: "EXPIRATION", expiration_reason: "BILLING_ERROR", expiration_at_ms: Date.now() - 1_000 }),
  );
  account = summary();
  check("expiration webhook is accepted", response.status === 200, response.body);
  check("expiration downgrades to Free", account.plan.id === "free" && account.entitlements.tier === "free", account);
  check("expiration restores the Free allocation", account.balance === 100, account.balance);
  check("expiration reports expired", account.subscription.status === "expired", account.subscription);

  response = await webhook(makeEvent({ id: "evt-refund", type: "REFUND", expiration_at_ms: Date.now() - 1_000 }));
  account = summary();
  check("refund webhook is accepted", response.status === 200, response.body);
  check("refund removes Plus", account.entitlements.tier === "free", account.entitlements);
  check("refund reports refunded", account.subscription.status === "refunded", account.subscription);

  // --- unrelated products and production events cannot grant access --------

  response = await webhook(
    makeEvent({ id: "evt-other-product", entitlement_ids: ["other"], entitlement_id: "other", product_id: "other_product" }),
  );
  check("an unrelated product is ignored", response.status === 200 && Boolean(response.body?.ignored), response.body);
  response = await webhook(makeEvent({ id: "evt-production", environment: "PRODUCTION" }));
  check("a production event is ignored in sandbox", response.status === 200 && response.body?.ignored === "production event in sandbox", response.body);
  check("production cannot grant Plus in sandbox", summary().entitlements.tier === "free");

  // --- unknown wallet ------------------------------------------------------

  response = await webhook(
    makeEvent({
      id: "evt-unknown",
      app_user_id: unknownUser,
      original_app_user_id: unknownUser,
      aliases: [unknownUser],
    }),
  );
  check("an unknown wallet is acknowledged", response.status === 200 && response.body?.matched === false, response.body);
  check("an unknown webhook cannot create a wallet", credits.findCreditAccountByRevenueCatIds([unknownUser]) === undefined);

  // --- authoritative server verification and sync --------------------------

  subscriberPayload = {
    entitlements: {
      plus: {
        expires_date: new Date(future(20)).toISOString(),
        purchase_date: new Date().toISOString(),
        product_identifier: "serene_plus_monthly",
        grace_period_expires_date: null,
      },
    },
    subscriptions: {
      serene_plus_monthly: {
        expires_date: new Date(future(20)).toISOString(),
        billing_issues_detected_at: null,
        unsubscribe_detected_at: null,
      },
    },
    management_url: "https://example.test/manage",
  };
  response = await call(`${base}/revenuecat/sync`, {
    method: "POST",
    headers: wallet(),
    body: JSON.stringify({}),
  });
  account = summary();
  check("wallet sync verifies with RevenueCat", response.status === 200 && response.body?.verification?.plan === "plus", response.body);
  check("server verification restores Plus", account.entitlements.tier === "plus" && account.subscription.status === "active", account);
  check("verification stores the management URL", account.subscription.managementUrl === "https://example.test/manage");
  check("verification uses the secret server-side", revenueCatCalls > 0, revenueCatCalls);

  subscriberPayload = {
    entitlements: { plus: { expires_date: new Date(Date.now() - 1_000).toISOString() } },
    subscriptions: {},
  };
  response = await call(`${base}/revenuecat/sync`, { method: "POST", headers: wallet(), body: "{}" });
  check("verification downgrades an expired entitlement", response.body?.verification?.plan === "free" && summary().entitlements.tier === "free", response.body);

  response = await call(`${base}/revenuecat/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  check("sync requires the wallet credential", response.status === 401, response.status);

  // --- transfer ------------------------------------------------------------

  subscriberPayload = {
    entitlements: {
      plus: {
        expires_date: new Date(future(15)).toISOString(),
        purchase_date: new Date().toISOString(),
        product_identifier: "serene_plus_monthly",
      },
    },
    subscriptions: { serene_plus_monthly: { expires_date: new Date(future(15)).toISOString() } },
  };
  response = await webhook({
    api_version: "1.0",
    event: {
      id: "evt-transfer",
      type: "TRANSFER",
      app_user_id: userB,
      transferred_from: [userA],
      transferred_to: [userB],
      environment: "SANDBOX",
      event_timestamp_ms: Date.now(),
    },
  });
  check("transfer webhook is accepted", response.status === 200, response.body);
  check("transfer removes the source entitlement", summary(userA, tokenA).entitlements.tier === "free");
  check("transfer verifies and grants the destination", summary(userB, tokenB).entitlements.tier === "plus", summary(userB, tokenB).entitlements);

  const transferSource = "e".repeat(40);
  const transferSourceToken = "5".repeat(64);
  credits.registerCreditAccount({ userId: transferSource, token: transferSourceToken });
  response = await webhook(
    makeEvent({
      id: "evt-transfer-source-plus",
      app_user_id: transferSource,
      original_app_user_id: transferSource,
      aliases: [transferSource],
      environment: "SANDBOX",
    }),
  );
  check(
    "the transfer source can start with Plus",
    response.status === 200 && summary(transferSource, transferSourceToken).entitlements.tier === "plus",
    response.body,
  );
  response = await webhook({
    api_version: "1.0",
    event: {
      id: "evt-transfer-unlinked-destination",
      type: "TRANSFER",
      app_user_id: transferSource,
      transferred_from: [transferSource],
      transferred_to: ["9".repeat(40)],
      environment: "SANDBOX",
      event_timestamp_ms: Date.now(),
    },
  });
  check(
    "an unverified transfer leaves the source entitlement intact",
    summary(transferSource, transferSourceToken).entitlements.tier === "plus",
    response.body,
  );

  // --- legacy wallet remains Free and usable -------------------------------

  const legacy = "c".repeat(40);
  const legacyToken = "3".repeat(64);
  const legacySummary = credits.registerCreditAccount({ userId: legacy, token: legacyToken });
  check("a new wallet still starts Free", legacySummary.plan.id === "free" && legacySummary.balance === 100);
  check("a Free wallet has an RC customer id by default", credits.findCreditAccountByRevenueCatIds([legacy])?.revenueCatCustomerId === legacy);

  // --- environment isolation ----------------------------------------------

  const envUser = "d".repeat(40);
  const envToken = "4".repeat(64);
  credits.registerCreditAccount({ userId: envUser, token: envToken });
  process.env.REVENUECAT_ENVIRONMENT = "PRODUCTION";
  process.env.REVENUECAT_LIVE_PAYMENTS = "true";
  try {
    response = await webhook(
      makeEvent({
        id: "evt-sandbox-in-production",
        app_user_id: envUser,
        original_app_user_id: envUser,
        aliases: [envUser],
        environment: "SANDBOX",
        expiration_at_ms: future(30),
      }),
    );
    check(
      "a sandbox event is ignored in production",
      response.status === 200 && response.body?.ignored === "sandbox event in production",
      response.body,
    );
    check(
      "a sandbox event cannot grant Plus in production",
      summary(envUser, envToken).entitlements.tier === "free",
      summary(envUser, envToken).entitlements,
    );
  } finally {
    process.env.REVENUECAT_ENVIRONMENT = "SANDBOX";
    process.env.REVENUECAT_LIVE_PAYMENTS = "false";
  }
} catch (error) {
  fail += 1;
  console.error("SUITE FAILED:", error);
} finally {
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  console.log("");
  if (fail === 0) {
    console.log(`PASS ${pass} / ${pass + fail}`);
    console.log("BILLING_REVENUECAT_TESTS_OK");
  } else {
    console.error(`PASS ${pass} / ${pass + fail}`);
    process.exitCode = 1;
  }
  fs.rmSync(workdir, { recursive: true, force: true });
}