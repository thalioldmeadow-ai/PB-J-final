/**
 * RevenueCat subscription adapter.
 *
 * RevenueCat owns the purchase and store lifecycle. This server owns the
 * resulting permission: every event is mapped onto the existing credit ledger,
 * and the browser cannot write an entitlement. Sandbox is the default; live
 * payments stay disabled until the owner explicitly turns them on later.
 *
 * Only server-side environment values are read here. The secret key is used for
 * verification and is never returned by an API route or written to the ledger.
 */

import { createHash, timingSafeEqual } from "crypto";
import {
  BillingEnvironment,
  CreditPlanId,
  SubscriptionStatus,
  applyRevenueCatEntitlement,
  billingEventHistory,
  creditSummary,
  findCreditAccountByRevenueCatIds,
} from "../ai/credits";

export type BillingPeriod = "monthly" | "annual" | "lifetime" | "unknown";

export interface PlusProduct {
  id: string;
  period: BillingPeriod;
  label: string;
}

interface RevenueCatConfig {
  environment: BillingEnvironment;
  sandbox: boolean;
  livePaymentsEnabled: boolean;
  plusEntitlement: string;
  products: PlusProduct[];
  productIds: string[];
  secretKey?: string;
  webhookAuth?: string;
  apiBase: string;
}

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

const text = (value: string | undefined): string => (value || "").trim();

const splitList = (value: string | undefined): string[] =>
  text(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

const loadConfig = (): RevenueCatConfig => {
  const environment: BillingEnvironment =
    text(process.env.REVENUECAT_ENVIRONMENT).toUpperCase() === "PRODUCTION"
      ? "PRODUCTION"
      : "SANDBOX";
  const monthly = text(process.env.REVENUECAT_PRODUCT_PLUS_MONTHLY) || "monthly";
  const annual =
    text(process.env.REVENUECAT_PRODUCT_PLUS_ANNUAL) ||
    text(process.env.REVENUECAT_PRODUCT_PLUS_YEARLY) ||
    "yearly";
  const lifetime = text(process.env.REVENUECAT_PRODUCT_PLUS_LIFETIME) || "lifetime";
  const extra = splitList(process.env.REVENUECAT_PLUS_PRODUCTS);
  const products: PlusProduct[] = [];
  if (monthly) products.push({ id: monthly, period: "monthly", label: "Plus monthly" });
  if (annual) products.push({ id: annual, period: "annual", label: "Plus yearly" });
  if (lifetime) products.push({ id: lifetime, period: "lifetime", label: "Plus lifetime" });
  for (const id of extra) {
    if (!products.some((product) => product.id === id)) {
      products.push({ id, period: "unknown", label: "Plus" });
    }
  }

  return {
    environment,
    sandbox: environment !== "PRODUCTION",
    // Deliberately off by default. The adapter is ready for sandbox testing,
    // not for live charges.
    livePaymentsEnabled:
      environment === "PRODUCTION" && process.env.REVENUECAT_LIVE_PAYMENTS === "true",
    plusEntitlement: text(process.env.REVENUECAT_PLUS_ENTITLEMENT) || "pb_j_pro",
    products,
    productIds: products.map((product) => product.id),
    secretKey: text(process.env.REVENUECAT_SECRET_KEY) || undefined,
    webhookAuth: text(process.env.REVENUECAT_WEBHOOK_AUTH) || undefined,
    apiBase: text(process.env.REVENUECAT_API_BASE) || "https://api.revenuecat.com/v1",
  };
};

/** Safe for the browser and the admin dashboard: no keys, secrets or tokens. */
export const revenueCatPublicConfig = () => {
  const config = loadConfig();
  return {
    provider: "revenuecat" as const,
    environment: config.environment,
    sandbox: config.sandbox,
    livePaymentsEnabled: config.livePaymentsEnabled,
    // The public Web SDK key enables browser checkout, but it is never returned here.
    purchasesEnabled: Boolean(text(process.env.VITE_REVENUECAT_WEB_API_KEY)),
    plusEntitlement: config.plusEntitlement,
    products: config.products,
    verificationConfigured: Boolean(config.secretKey),
    webhookConfigured: Boolean(config.webhookAuth),
    webhookPath: "/api/billing/revenuecat/webhook",
  };
};

/** Constant-time comparison, supporting either a raw value or Bearer prefix. */
export const revenueCatWebhookAuthorized = (header: string | undefined): boolean => {
  const config = loadConfig();
  if (!config.webhookAuth) return false;
  const provided = text(header);
  const value = provided.toLowerCase().startsWith("bearer ")
    ? provided.slice(7).trim()
    : provided;
  const expected = Buffer.from(config.webhookAuth);
  const actual = Buffer.from(value);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
};

const isoFromMs = (value: unknown): string | undefined => {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return new Date(ms).toISOString();
};

const isoFromDate = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
};

const eventIds = (event: Record<string, unknown>): string[] => {
  const ids = [
    event.app_user_id,
    event.original_app_user_id,
    ...(Array.isArray(event.aliases) ? event.aliases : []),
  ];
  return unique(ids.filter((value): value is string => typeof value === "string"));
};

const productIsPlus = (
  event: Record<string, unknown>,
  config: RevenueCatConfig,
): boolean => {
  const entitlements = Array.isArray(event.entitlement_ids)
    ? event.entitlement_ids.filter((value): value is string => typeof value === "string")
    : typeof event.entitlement_id === "string"
      ? [event.entitlement_id]
      : [];
  if (entitlements.includes(config.plusEntitlement)) return true;
  const product = typeof event.product_id === "string" ? event.product_id : "";
  return Boolean(product) && config.productIds.includes(product);
};

const subscriptionStatus = (type: string): SubscriptionStatus => {
  if (type === "CANCELLATION") return "canceled";
  if (type === "BILLING_ISSUE") return "past_due";
  if (type === "REFUND") return "refunded";
  if (type === "EXPIRATION") return "expired";
  return "active";
};

export interface RevenueCatEventResult {
  accepted: boolean;
  ignored?: string;
  matched?: boolean;
  duplicate?: boolean;
  customerId?: string;
  verified?: boolean;
}

/**
 * Process one authenticated webhook. Unknown wallets are acknowledged and
 * logged; the browser still cannot create or upgrade a wallet from here.
 */
export const processRevenueCatWebhook = async (raw: unknown): Promise<RevenueCatEventResult> => {
  const config = loadConfig();
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const event =
    body.event && typeof body.event === "object"
      ? (body.event as Record<string, unknown>)
      : null;
  if (!event) throw new BillingError("That webhook body is not valid.", 400, "bad_webhook");

  const id = typeof event.id === "string" ? event.id : "";
  const type = typeof event.type === "string" ? event.type : "";
  if (!id || !type) throw new BillingError("That webhook is missing its id or type.", 400, "bad_webhook");

  const environment =
    text(typeof event.environment === "string" ? event.environment : "").toUpperCase() ===
    "PRODUCTION"
      ? "PRODUCTION"
      : "SANDBOX";

  // A sandbox deployment must never let a production event grant access, and
  // this build keeps live payments off even if its environment is switched.
  if (environment === "PRODUCTION" && !config.livePaymentsEnabled) {
    return { accepted: true, ignored: "production event in sandbox" };
  }
  // A sandbox event must never grant an entitlement on a production server,
  // and a production event must never be applied by a sandbox server.
  if (environment !== config.environment) {
    return {
      accepted: true,
      ignored: `${environment.toLowerCase()} event in ${config.environment.toLowerCase()}`,
    };
  }
  if (type === "TEST" && !config.sandbox) {
    return { accepted: true, ignored: "test event in production" };
  }

  const ids = eventIds(event);
  const customerId = ids[0] || "";
  if (!customerId) {
    return { accepted: true, ignored: "event has no app user id" };
  }

  const expiresAt = isoFromMs(event.expiration_at_ms);
  const gracePeriodEndsAt = isoFromMs(event.grace_period_expiration_at_ms);
  const purchasedAt = isoFromMs(event.purchased_at_ms);
  const environmentValue: BillingEnvironment = environment;

  if (type === "TRANSFER") {
    // Never revoke the source when we cannot verify that the destination
    // actually received the entitlement. A later sync can finish the transfer.
    if (!config.secretKey) {
      return { accepted: true, ignored: "transfer needs RevenueCat verification" };
    }
    const from = Array.isArray(event.transferred_from)
      ? event.transferred_from.filter((value): value is string => typeof value === "string")
      : [];
    const to = Array.isArray(event.transferred_to)
      ? event.transferred_to.filter((value): value is string => typeof value === "string")
      : [];
    const source = from[0] || customerId;
    const destination = to[0];
    if (!destination) {
      return { accepted: true, ignored: "transfer has no destination", matched: false, customerId: source };
    }
    // Verify and grant the destination first. If RevenueCat is unreachable or
    // the destination is not linked, the source must keep its paid entitlement.
    const verification = await syncRevenueCatCustomer(destination);
    if (verification.matched && source !== destination) {
      applyRevenueCatEntitlement({
        eventId: `${id}:from`,
        eventType: type,
        customerId: source,
        appUserIds: from,
        plan: "free",
        status: "expired",
        environment: environmentValue,
      });
    }
    return {
      accepted: true,
      customerId: destination,
      matched: verification.matched,
      verified: true,
    };
  }

  if (type === "EXPIRATION" || type === "REFUND") {
    // An expiration/refund for an unrelated product must not remove Plus.
    if (!productIsPlus(event, config)) {
      return { accepted: true, ignored: "not a Plus product or entitlement" };
    }
    const result = applyRevenueCatEntitlement({
      eventId: id,
      eventType: type,
      customerId,
      appUserIds: ids,
      plan: "free",
      status: subscriptionStatus(type),
      environment: environmentValue,
      productId: typeof event.product_id === "string" ? event.product_id : undefined,
      entitlementId: config.plusEntitlement,
      expiresAt: expiresAt || new Date().toISOString(),
    });
    return { accepted: true, matched: result.matched, duplicate: result.duplicate, customerId };
  }

  // Other products do not change a Plus entitlement. Check the entitlement or
  // an explicitly configured product before writing anything.
  if (!productIsPlus(event, config) && type !== "TEMPORARY_ENTITLEMENT_GRANT") {
    return { accepted: true, ignored: "not a Plus product or entitlement" };
  }

  // RevenueCat can report a store refund as CANCELLATION with this reason.
  // Treat it as an immediate refund rather than a voluntary period-end cancel.
  const refundCancellation =
    type === "CANCELLATION" && event.cancel_reason === "CUSTOMER_SUPPORT";
  const status: SubscriptionStatus = refundCancellation ? "refunded" : subscriptionStatus(type);
  const result = applyRevenueCatEntitlement({
    eventId: id,
    eventType: type,
    customerId,
    appUserIds: ids,
    plan: status === "expired" || status === "refunded" ? "free" : "plus",
    status,
    environment: environmentValue,
    productId: typeof event.product_id === "string" ? event.product_id : undefined,
    entitlementId: config.plusEntitlement,
    purchasedAt,
    expiresAt,
    gracePeriodEndsAt,
    // CANCELLATION and SUBSCRIPTION_PAUSED keep access until expiry, except a
    // refund cancellation, which removes the paid entitlement now.
    cancelAtPeriodEnd:
      !refundCancellation && (type === "CANCELLATION" || type === "SUBSCRIPTION_PAUSED"),
    resetCredits:
      !refundCancellation &&
      (type === "INITIAL_PURCHASE" ||
        type === "RENEWAL" ||
        type === "UNCANCELLATION" ||
        type === "PRODUCT_CHANGE" ||
        type === "SUBSCRIPTION_EXTENDED" ||
        type === "TEMPORARY_ENTITLEMENT_GRANT" ||
        type === "TEST"),
  });

  return { accepted: true, matched: result.matched, duplicate: result.duplicate, customerId };
};

interface RevenueCatEntitlement {
  expires_date?: string | null;
  grace_period_expires_date?: string | null;
  product_identifier?: string | null;
  purchase_date?: string | null;
}

interface RevenueCatSubscription {
  expires_date?: string | null;
  grace_period_expires_date?: string | null;
  billing_issues_detected_at?: string | null;
  unsubscribe_detected_at?: string | null;
  refunded_at?: string | null;
}

interface RevenueCatSubscriber {
  entitlements?: Record<string, RevenueCatEntitlement>;
  subscriptions?: Record<string, RevenueCatSubscription>;
  management_url?: string | null;
}

const fetchSubscriber = async (customerId: string): Promise<RevenueCatSubscriber> => {
  const config = loadConfig();
  if (!config.secretKey) {
    throw new BillingError(
      "RevenueCat verification needs a server secret key. Add a sandbox secret key and restart.",
      503,
      "billing_not_configured",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      `${config.apiBase.replace(/\/$/, "")}/subscribers/${encodeURIComponent(customerId)}`,
      {
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new BillingError(
        response.status === 404
          ? "RevenueCat has no customer with that id yet."
          : "RevenueCat could not verify that subscription.",
        response.status === 404 ? 404 : 502,
        response.status === 404 ? "billing_customer_not_found" : "billing_verification_failed",
      );
    }
    const body = (await response.json()) as { subscriber?: RevenueCatSubscriber };
    return body.subscriber || {};
  } catch (error) {
    if (error instanceof BillingError) throw error;
    throw new BillingError(
      "RevenueCat could not be reached for verification.",
      502,
      "billing_verification_failed",
    );
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Re-read the authoritative customer from RevenueCat and apply it. This is the
 * recovery path for missed webhooks, transfers and a user tapping "restore".
 */
export const syncRevenueCatCustomer = async (
  customerId: string,
): Promise<{
  matched: boolean;
  duplicate: boolean;
  plan: CreditPlanId;
  status: SubscriptionStatus;
  expiresAt?: string;
}> => {
  const config = loadConfig();
  const id = text(customerId);
  if (!id) throw new BillingError("A RevenueCat customer id is required.", 400, "bad_customer_id");

  const account = findCreditAccountByRevenueCatIds([id]);
  if (!account) {
    throw new BillingError(
      "This wallet is not linked to a RevenueCat customer yet. Open the app once, then retry.",
      404,
      "billing_customer_not_linked",
    );
  }

  const subscriber = await fetchSubscriber(id);
  const entitlement = subscriber.entitlements?.[config.plusEntitlement];
  const expiresAt =
    isoFromDate(entitlement?.expires_date) ||
    isoFromDate(subscriber.subscriptions?.[entitlement?.product_identifier || ""]?.expires_date);
  const gracePeriodEndsAt = isoFromDate(entitlement?.grace_period_expires_date);
  const now = Date.now();
  const periodOpen = !expiresAt || Date.parse(expiresAt) > now;
  const graceOpen = Boolean(gracePeriodEndsAt && Date.parse(gracePeriodEndsAt) > now);
  const active = Boolean(entitlement) && (periodOpen || graceOpen);
  const product = entitlement?.product_identifier || "";
  const subscription = subscriber.subscriptions?.[product];
  const billingIssue = Boolean(subscription?.billing_issues_detected_at);
  const canceled = Boolean(subscription?.unsubscribe_detected_at);
  const status: SubscriptionStatus = active ? (billingIssue ? "past_due" : "active") : "expired";

  const result = applyRevenueCatEntitlement({
    eventId: `sync:${id}:${now}`,
    eventType: "SYNC",
    customerId: id,
    appUserIds: [id, account.revenueCatCustomerId, ...(account.revenueCatAliases || [])].filter(
      (entry): entry is string => Boolean(entry),
    ),
    plan: active ? "plus" : "free",
    status,
    environment: config.environment,
    productId: product || account.revenueCatProductId,
    entitlementId: config.plusEntitlement,
    purchasedAt: isoFromDate(entitlement?.purchase_date),
    expiresAt,
    gracePeriodEndsAt,
    cancelAtPeriodEnd: active && canceled,
    managementUrl: subscriber.management_url || undefined,
    resetCredits: active && account.plan !== "plus",
    receivedAt: new Date(now).toISOString(),
  });

  return {
    matched: result.matched,
    duplicate: result.duplicate,
    plan: active ? "plus" : "free",
    status,
    expiresAt,
  };
};

export const revenueCatBillingHistory = (limit = 100) => billingEventHistory(limit);

/** For tests and diagnostics only: a non-secret fingerprint of the customer id. */
export const customerFingerprint = (customerId: string): string =>
  createHash("sha256").update(customerId).digest("hex").slice(0, 12);

export const billingSummaryForUser = (userId: string) => creditSummary(userId);
// Kept as a named helper so the route layer can report a safe, stable value.
export const isRevenueCatSandbox = (): boolean => loadConfig().sandbox;

// A small export used by admin tooling without exposing the secret.
export const revenueCatConfigured = (): boolean => {
  const config = loadConfig();
  return Boolean(config.secretKey || config.webhookAuth);
};

export const billingEventsForAdmin = revenueCatBillingHistory;

// Route code uses this instead of reaching into wallet internals.
export const findRevenueCatAccount = (ids: string[]) => findCreditAccountByRevenueCatIds(ids);