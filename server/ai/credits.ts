/**
 * Server-authoritative AI credits.
 *
 * This is deliberately separate from the token/cost ledger in usage.ts:
 * credits are a product balance owned by the server, while the usage ledger is
 * an operator view of provider traffic. A browser can never write a balance.
 *
 * The app still has no server-side account system. A credit account is therefore
 * bound to the local account's one-way user hash plus a random credential kept
 * inside the encrypted vault. The server stores only a SHA-256 digest of that
 * credential. A caller cannot spend someone else's balance by guessing a hash,
 * and changing the vault's local storage cannot change the server balance.
 *
 * The store is a single JSON file because the app runs one Express process and
 * already uses that pattern for data/ai-usage.json. Every mutation is synchronous
 * and atomic on disk, and a reservation is taken before the provider call, so
 * two simultaneous requests cannot both spend the same credits.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";

export const CREDIT_ACTION_KEYS = [
  "simple_message",
  "daily_plan",
  "detailed_analysis",
  "complex_task",
] as const;

export type CreditActionKey = (typeof CREDIT_ACTION_KEYS)[number];
export type CreditPlanId = "free" | "plus";
export const CREDIT_PLAN_IDS: CreditPlanId[] = ["free", "plus"];
export const SUBSCRIPTION_STATUSES = ["active", "past_due", "canceled", "expired", "refunded"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type BillingEnvironment = "SANDBOX" | "PRODUCTION";
export type CreditRequestStatus = "pending" | "succeeded" | "failed";

export interface CreditActionConfig {
  label: string;
  description: string;
  cost: number;
}

export interface CreditPlanConfig {
  label: string;
  creditsPerPeriod: number;
  periodDays: number;
  requestsPerDay: number;
  tokensPerDay: number;
  memoryLimit: number;
  historyLimit: number;
  historyCharLimit: number;
  maxAttachments: number;
  advancedFeatures: boolean;
}

export interface CreditConfig {
  actions: Record<CreditActionKey, CreditActionConfig>;
  plans: Record<CreditPlanId, CreditPlanConfig>;
  updatedAt: string;
}

export interface CreditAccount {
  userId: string;
  tokenHash: string;
  plan: CreditPlanId;
  balance: number;
  allocated: number;
  periodCreditsUsed: number;
  periodStart: string;
  periodEnd: string;
  /** Subscription lifecycle, stored with the wallet in the server ledger. */
  subscriptionStatus: SubscriptionStatus;
  subscriptionStartedAt: string;
  renewalAt: string;
  expiresAt: string;
  /** True when a store cancellation leaves access on until the paid period ends. */
  cancelAtPeriodEnd?: boolean;
  gracePeriodEndsAt?: string;
  managementUrl?: string;
  paymentProviderRef?: string;
  /** RevenueCat App User ID. Defaults to the one-way wallet id at registration. */
  revenueCatCustomerId?: string;
  revenueCatAliases?: string[];
  revenueCatEnvironment?: BillingEnvironment;
  revenueCatProductId?: string;
  revenueCatEntitlementId?: string;
  lastBillingEventId?: string;
  lastBillingEventType?: string;
  lastBillingEventAt?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

interface BillingEventRecord {
  id: string;
  type: string;
  customerId: string;
  receivedAt: string;
  matched: boolean;
}

export interface CreditHistoryEntry {
  id: string;
  userId: string;
  action: CreditActionKey;
  actionLabel: string;
  credits: number;
  createdAt: string;
  completedAt?: string;
  status: CreditRequestStatus;
  requestId: string;
  plan: CreditPlanId;
}

interface StoredRequest {
  userId: string;
  action: CreditActionKey;
  credits: number;
  status: CreditRequestStatus;
  createdAt: string;
  completedAt?: string;
  historyId: string;
}

interface CreditStore {
  /** Bumped only for one-time migrations; the JSON shape otherwise stays compatible. */
  version: 2;
  config: CreditConfig;
  accounts: Record<string, CreditAccount>;
  requests: Record<string, StoredRequest>;
  history: CreditHistoryEntry[];
  billingEvents: Record<string, BillingEventRecord>;
  updatedAt: string;
}

export interface SubscriptionInfo {
  tier: CreditPlanId;
  label: string;
  status: SubscriptionStatus;
  startedAt: string;
  renewalAt: string;
  expiresAt: string;
  cancelAtPeriodEnd: boolean;
  inGracePeriod: boolean;
  managementUrl?: string;
  providerRef?: string;
}

export interface SubscriptionEntitlements {
  tier: CreditPlanId;
  status: SubscriptionStatus;
  active: boolean;
  advancedFeatures: boolean;
  requestsPerDay: number;
  tokensPerDay: number;
  memoryLimit: number;
  historyLimit: number;
  historyCharLimit: number;
  maxAttachments: number;
}

export interface CreditPlanOffer {
  id: CreditPlanId;
  label: string;
  creditsPerPeriod: number;
  periodDays: number;
  benefits: string[];
}

export interface CreditSummary {
  plan: { id: CreditPlanId; label: string };
  subscription: SubscriptionInfo;
  entitlements: SubscriptionEntitlements;
  benefits: string[];
  plans: CreditPlanOffer[];
  balance: number;
  total: number;
  periodCreditsUsed: number;
  periodStart: string;
  periodEnd: string;
  resetAt: string;
  actions: { key: CreditActionKey; label: string; description: string; cost: number }[];
}

export interface CreditHistoryRow extends CreditHistoryEntry {
  userShortId: string;
}

export interface AdminCreditAccount {
  userId: string;
  userShortId: string;
  plan: CreditPlanId;
  planLabel: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionStartedAt: string;
  renewalAt: string;
  expiresAt: string;
  paymentProviderRef?: string;
  balance: number;
  total: number;
  periodCreditsUsed: number;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface CreditOverview {
  config: {
    actions: { key: CreditActionKey; label: string; description: string; cost: number }[];
    plans: ({ id: CreditPlanId } & CreditPlanConfig)[];
    updatedAt: string;
  };
  accounts: AdminCreditAccount[];
  history: CreditHistoryRow[];
}

export class CreditError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "CreditError";
  }
}

const MAX_ACCOUNTS = 5_000;
const MAX_HISTORY = 2_000;
const MAX_REQUESTS = 5_000;
const STALE_REQUEST_MS = 10 * 60_000;

const USER_KEY_PATTERN = /^[a-f0-9]{16,64}$/;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "ai-credits.json");

const defaultConfig = (): CreditConfig => ({
  actions: {
    simple_message: {
      label: "Simple AI message",
      description: "A short conversational reply.",
      cost: 1,
    },
    daily_plan: {
      label: "Daily plan generation",
      description: "Building a realistic day or week plan.",
      cost: 3,
    },
    detailed_analysis: {
      label: "Detailed analysis",
      description: "Reviewing records, trends or a budget in depth.",
      cost: 5,
    },
    complex_task: {
      label: "Complex AI task",
      description: "Working with attachments or a larger task.",
      cost: 10,
    },
  },
  plans: {
    free: {
      label: "Free",
      creditsPerPeriod: 100,
      periodDays: 1,
      requestsPerDay: 20,
      tokensPerDay: 60_000,
      memoryLimit: 6,
      historyLimit: 8,
      historyCharLimit: 4_000,
      maxAttachments: 0,
      advancedFeatures: false,
    },
    plus: {
      label: "Plus",
      creditsPerPeriod: 1_000,
      periodDays: 30,
      requestsPerDay: 120,
      tokensPerDay: 300_000,
      memoryLimit: 30,
      historyLimit: 24,
      historyCharLimit: 16_000,
      maxAttachments: 4,
      advancedFeatures: true,
    },
  },
  updatedAt: new Date().toISOString(),
});

const isPlanId = (value: unknown): value is CreditPlanId =>
  value === "free" || value === "plus";

const isSubscriptionStatus = (value: unknown): value is SubscriptionStatus =>
  typeof value === "string" && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);

const isActionKey = (value: unknown): value is CreditActionKey =>
  typeof value === "string" && (CREDIT_ACTION_KEYS as readonly string[]).includes(value);

const nowIso = (): string => new Date().toISOString();

const addDays = (iso: string, days: number): string => {
  const date = new Date(iso);
  const safeDays = Math.max(1, Math.round(days));
  date.setUTCDate(date.getUTCDate() + safeDays);
  return date.toISOString();
};

const clampInt = (value: unknown, min: number, max: number): number | undefined => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

const cleanConfig = (input: unknown): CreditConfig => {
  const base = defaultConfig();
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const actionsRaw =
    raw.actions && typeof raw.actions === "object" ? (raw.actions as Record<string, unknown>) : {};
  const plansRaw =
    raw.plans && typeof raw.plans === "object" ? (raw.plans as Record<string, unknown>) : {};

  for (const key of CREDIT_ACTION_KEYS) {
    const rawAction = actionsRaw[key];
    const source =
      typeof rawAction === "number"
        ? { cost: rawAction }
        : rawAction && typeof rawAction === "object"
          ? (rawAction as Record<string, unknown>)
          : {};
    const cost = clampInt(source.cost, 0, 10_000);
    if (cost !== undefined) base.actions[key].cost = cost;
    if (typeof source.label === "string" && source.label.trim()) {
      base.actions[key].label = source.label.trim().slice(0, 80);
    }
    if (typeof source.description === "string" && source.description.trim()) {
      base.actions[key].description = source.description.trim().slice(0, 160);
    }
  }

  for (const id of CREDIT_PLAN_IDS) {
    const source =
      plansRaw[id] && typeof plansRaw[id] === "object"
        ? (plansRaw[id] as Record<string, unknown>)
        : {};
    const credits = clampInt(source.creditsPerPeriod, 0, 1_000_000);
    const days = clampInt(source.periodDays, 1, 3_650);
    const requests = clampInt(source.requestsPerDay, 1, 100_000);
    const tokens = clampInt(source.tokensPerDay, 1_000, 100_000_000);
    const memory = clampInt(source.memoryLimit, 0, 50);
    const history = clampInt(source.historyLimit, 0, 40);
    const historyChars = clampInt(source.historyCharLimit, 500, 40_000);
    const attachments = clampInt(source.maxAttachments, 0, 4);
    if (credits !== undefined) base.plans[id].creditsPerPeriod = credits;
    if (days !== undefined) base.plans[id].periodDays = days;
    if (requests !== undefined) base.plans[id].requestsPerDay = requests;
    if (tokens !== undefined) base.plans[id].tokensPerDay = tokens;
    if (memory !== undefined) base.plans[id].memoryLimit = memory;
    if (history !== undefined) base.plans[id].historyLimit = history;
    if (historyChars !== undefined) base.plans[id].historyCharLimit = historyChars;
    if (attachments !== undefined) base.plans[id].maxAttachments = attachments;
    if (typeof source.advancedFeatures === "boolean") {
      base.plans[id].advancedFeatures = source.advancedFeatures;
    }
    if (typeof source.label === "string" && source.label.trim()) {
      base.plans[id].label = source.label.trim().slice(0, 80);
    }
  }

  base.updatedAt =
    typeof raw.updatedAt === "string" && raw.updatedAt.trim()
      ? raw.updatedAt.trim()
      : new Date().toISOString();
  return base;
};

const normalizeAccount = (
  userId: string,
  raw: unknown,
  config: CreditConfig,
): CreditAccount | null => {
  if (!USER_KEY_PATTERN.test(userId)) return null;
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<CreditAccount>;
  if (typeof source.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(source.tokenHash)) return null;

  const plan = isPlanId(source.plan) ? source.plan : "free";
  const planConfig = config.plans[plan];
  const allocated =
    clampInt(source.allocated, 0, 1_000_000) ?? planConfig.creditsPerPeriod;
  const balance = clampInt(source.balance, 0, allocated) ?? allocated;
  const used = clampInt(source.periodCreditsUsed, 0, 10_000_000) ?? 0;
  const createdAt =
    typeof source.createdAt === "string" && source.createdAt ? source.createdAt : nowIso();
  const periodStart =
    typeof source.periodStart === "string" && source.periodStart ? source.periodStart : createdAt;
  const periodEnd =
    typeof source.periodEnd === "string" && source.periodEnd
      ? source.periodEnd
      : addDays(periodStart, planConfig.periodDays);

  return {
    userId,
    tokenHash: source.tokenHash,
    plan,
    balance,
    allocated,
    periodCreditsUsed: used,
    periodStart,
    periodEnd,
    subscriptionStatus:
      plan === "free"
        ? "active"
        : isSubscriptionStatus(source.subscriptionStatus)
          ? source.subscriptionStatus
          : "active",
    subscriptionStartedAt:
      typeof source.subscriptionStartedAt === "string" && source.subscriptionStartedAt
        ? source.subscriptionStartedAt
        : createdAt,
    renewalAt:
      typeof source.renewalAt === "string" && source.renewalAt ? source.renewalAt : periodEnd,
    expiresAt:
      typeof source.expiresAt === "string" && source.expiresAt ? source.expiresAt : periodEnd,
    cancelAtPeriodEnd: source.cancelAtPeriodEnd === true,
    gracePeriodEndsAt:
      typeof source.gracePeriodEndsAt === "string" && source.gracePeriodEndsAt
        ? source.gracePeriodEndsAt
        : undefined,
    managementUrl:
      typeof source.managementUrl === "string" && source.managementUrl.trim()
        ? source.managementUrl.trim().slice(0, 500)
        : undefined,
    paymentProviderRef:
      typeof source.paymentProviderRef === "string" && source.paymentProviderRef.trim()
        ? source.paymentProviderRef.trim().slice(0, 120)
        : undefined,
    revenueCatCustomerId:
      typeof source.revenueCatCustomerId === "string" && source.revenueCatCustomerId.trim()
        ? source.revenueCatCustomerId.trim().slice(0, 200)
        : userId,
    revenueCatAliases: Array.isArray(source.revenueCatAliases)
      ? [...new Set(source.revenueCatAliases.filter((entry): entry is string => typeof entry === "string" && entry.length > 0 && entry.length <= 200))].slice(0, 20)
      : [],
    revenueCatEnvironment:
      source.revenueCatEnvironment === "PRODUCTION" || source.revenueCatEnvironment === "SANDBOX"
        ? source.revenueCatEnvironment
        : undefined,
    revenueCatProductId:
      typeof source.revenueCatProductId === "string" && source.revenueCatProductId.trim()
        ? source.revenueCatProductId.trim().slice(0, 120)
        : undefined,
    revenueCatEntitlementId:
      typeof source.revenueCatEntitlementId === "string" && source.revenueCatEntitlementId.trim()
        ? source.revenueCatEntitlementId.trim().slice(0, 120)
        : undefined,
    lastBillingEventId:
      typeof source.lastBillingEventId === "string" ? source.lastBillingEventId.slice(0, 200) : undefined,
    lastBillingEventType:
      typeof source.lastBillingEventType === "string" ? source.lastBillingEventType.slice(0, 80) : undefined,
    lastBillingEventAt:
      typeof source.lastBillingEventAt === "string" ? source.lastBillingEventAt : undefined,
    createdAt,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : createdAt,
    lastUsedAt: typeof source.lastUsedAt === "string" ? source.lastUsedAt : undefined,
  };
};

const normalizeRequest = (raw: unknown): StoredRequest | null => {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<StoredRequest>;
  if (typeof source.userId !== "string" || !USER_KEY_PATTERN.test(source.userId)) return null;
  if (!isActionKey(source.action)) return null;
  if (!["pending", "succeeded", "failed"].includes(String(source.status))) return null;
  if (typeof source.createdAt !== "string" || !source.createdAt) return null;
  if (typeof source.historyId !== "string" || !source.historyId) return null;
  return {
    userId: source.userId,
    action: source.action,
    credits: clampInt(source.credits, 0, 10_000) ?? 0,
    status: source.status as CreditRequestStatus,
    createdAt: source.createdAt,
    completedAt: typeof source.completedAt === "string" ? source.completedAt : undefined,
    historyId: source.historyId,
  };
};

const normalizeHistory = (raw: unknown): CreditHistoryEntry[] => {
  if (!Array.isArray(raw)) return [];
  const rows: CreditHistoryEntry[] = [];
  for (const entry of raw.slice(0, MAX_HISTORY)) {
    if (!entry || typeof entry !== "object") continue;
    const source = entry as Partial<CreditHistoryEntry>;
    if (typeof source.userId !== "string" || !USER_KEY_PATTERN.test(source.userId)) continue;
    if (!isActionKey(source.action)) continue;
    if (!["pending", "succeeded", "failed"].includes(String(source.status))) continue;
    if (typeof source.id !== "string" || !source.id) continue;
    if (typeof source.requestId !== "string" || !source.requestId) continue;
    rows.push({
      id: source.id,
      userId: source.userId,
      action: source.action,
      actionLabel:
        typeof source.actionLabel === "string" && source.actionLabel
          ? source.actionLabel
          : source.action,
      credits: clampInt(source.credits, 0, 10_000) ?? 0,
      createdAt: typeof source.createdAt === "string" ? source.createdAt : nowIso(),
      completedAt: typeof source.completedAt === "string" ? source.completedAt : undefined,
      status: source.status as CreditRequestStatus,
      requestId: source.requestId,
      plan: isPlanId(source.plan) ? source.plan : "free",
    });
  }
  return rows;
};

const normalizeBillingEvents = (raw: unknown): Record<string, BillingEventRecord> => {
  if (!raw || typeof raw !== "object") return {};
  const entries = Object.entries(raw as Record<string, unknown>).slice(0, 2000);
  const rows: Record<string, BillingEventRecord> = {};
  for (const [key, value] of entries) {
    if (!value || typeof value !== "object") continue;
    const source = value as Partial<BillingEventRecord>;
    if (typeof source.id !== "string" || !source.id) continue;
    if (typeof source.type !== "string" || !source.type) continue;
    if (typeof source.customerId !== "string" || !source.customerId) continue;
    rows[key] = {
      id: source.id.slice(0, 200),
      type: source.type.slice(0, 80),
      customerId: source.customerId.slice(0, 200),
      receivedAt: typeof source.receivedAt === "string" ? source.receivedAt : nowIso(),
      matched: source.matched === true,
    };
  }
  return rows;
};

const freshStore = (): CreditStore => ({
  version: 2,
  config: defaultConfig(),
  accounts: {},
  requests: {},
  history: [],
  billingEvents: {},
  updatedAt: nowIso(),
});

const normalizeStore = (raw: unknown): CreditStore => {
  const base = freshStore();
  if (!raw || typeof raw !== "object") return base;
  const source = raw as Partial<CreditStore>;
  const config = cleanConfig(source.config);
  const accounts: Record<string, CreditAccount> = {};
  for (const [userId, entry] of Object.entries(source.accounts || {})) {
    const account = normalizeAccount(userId, entry, config);
    if (account) accounts[userId] = account;
  }

  const requests: Record<string, StoredRequest> = {};
  for (const [key, entry] of Object.entries(source.requests || {})) {
    const request = normalizeRequest(entry);
    if (request) requests[key] = request;
  }

  // Version 1 used a 30-day Free period. Move those wallets onto the new
  // daily Free cycle without wiping history or any app data.
  if ((Number(source.version) || 1) < 2) {
    const freeDefaults = defaultConfig().plans.free;
    config.plans.free.creditsPerPeriod = freeDefaults.creditsPerPeriod;
    config.plans.free.periodDays = freeDefaults.periodDays;
    for (const account of Object.values(accounts)) {
      if (account.plan !== "free") continue;
      const start = Date.parse(account.periodStart);
      const end = Date.parse(account.periodEnd);
      const lengthDays = Number.isFinite(start) && Number.isFinite(end)
        ? (end - start) / 86_400_000
        : 0;
      if (lengthDays <= freeDefaults.periodDays + 1) continue;
      const now = nowIso();
      account.periodStart = now;
      account.periodEnd = addDays(now, freeDefaults.periodDays);
      account.allocated = freeDefaults.creditsPerPeriod;
      account.balance = freeDefaults.creditsPerPeriod;
      account.periodCreditsUsed = 0;
      account.renewalAt = account.periodEnd;
      account.expiresAt = account.periodEnd;
      account.updatedAt = now;
    }
  }

  return {
    version: 2,
    config,
    accounts,
    requests,
    history: normalizeHistory(source.history),
    billingEvents: normalizeBillingEvents(source.billingEvents),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : nowIso(),
  };
};

let cached: CreditStore | null = null;

const persist = (store: CreditStore): void => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(store), { mode: 0o600 });
    fs.renameSync(temp, FILE);
  } catch {
    // A read-only disk must not break the AI call. The balance lives in memory
    // for the process lifetime in that case, just like the usage ledger.
  }
};

const resetToFreeAccount = (
  account: CreditAccount,
  config: CreditConfig,
  status: SubscriptionStatus,
): void => {
  const plan = config.plans.free;
  const now = nowIso();
  account.plan = "free";
  account.subscriptionStatus = status;
  account.balance = plan.creditsPerPeriod;
  account.allocated = plan.creditsPerPeriod;
  account.periodCreditsUsed = 0;
  account.periodStart = now;
  account.periodEnd = addDays(now, plan.periodDays);
  account.renewalAt = account.periodEnd;
  account.expiresAt = account.periodEnd;
  account.cancelAtPeriodEnd = false;
  account.gracePeriodEndsAt = undefined;
  account.updatedAt = now;
};

/** Downgrade stored Plus when its paid period or grace period has run out. */
const reconcileSubscription = (account: CreditAccount, config: CreditConfig): boolean => {
  if (account.plan !== "plus") return false;
  const now = Date.now();
  const periodOpen = !account.expiresAt || isFuture(account.expiresAt, now);
  const graceOpen = isFuture(account.gracePeriodEndsAt, now);
  const shouldExpire =
    account.subscriptionStatus === "expired" ||
    account.subscriptionStatus === "refunded" ||
    (account.subscriptionStatus === "active" && !periodOpen) ||
    (account.subscriptionStatus === "past_due" && !periodOpen && !graceOpen) ||
    (account.subscriptionStatus === "canceled" && (!account.cancelAtPeriodEnd || !periodOpen && !graceOpen));
  if (!shouldExpire) return false;
  resetToFreeAccount(
    account,
    config,
    account.subscriptionStatus === "refunded" ? "refunded" : "expired",
  );
  return true;
};

const refreshAccountPeriod = (account: CreditAccount, config: CreditConfig): boolean => {
  const reconciled = reconcileSubscription(account, config);
  const now = Date.now();
  const end = Date.parse(account.periodEnd);
  if (Number.isFinite(end) && now < end) return reconciled;

  const plan = config.plans[account.plan];
  account.balance = plan.creditsPerPeriod;
  account.allocated = plan.creditsPerPeriod;
  account.periodCreditsUsed = 0;
  account.periodStart = nowIso();
  account.periodEnd = addDays(account.periodStart, plan.periodDays);
  account.renewalAt = account.periodEnd;
  account.expiresAt = account.periodEnd;
  account.updatedAt = nowIso();
  return true;
};

const recoverStaleRequests = (store: CreditStore): boolean => {
  const cutoff = Date.now() - STALE_REQUEST_MS;
  let changed = false;

  for (const [key, request] of Object.entries(store.requests)) {
    if (request.status !== "pending") continue;
    const started = Date.parse(request.createdAt);
    if (!Number.isFinite(started) || started > cutoff) continue;

    const account = store.accounts[request.userId];
    if (account) {
      account.balance = Math.min(account.allocated, account.balance + request.credits);
      account.periodCreditsUsed = Math.max(0, account.periodCreditsUsed - request.credits);
      account.updatedAt = nowIso();
    }
    request.status = "failed";
    request.completedAt = nowIso();
    const history = store.history.find((entry) => entry.id === request.historyId);
    if (history) {
      history.status = "failed";
      history.credits = 0;
      history.completedAt = request.completedAt;
    }
    delete store.requests[key];
    changed = true;
  }

  return changed;
};

const readStore = (): CreditStore => {
  if (cached) {
    if (recoverStaleRequests(cached)) {
      cached.updatedAt = nowIso();
      persist(cached);
    }
    return cached;
  }

  try {
    cached = normalizeStore(JSON.parse(fs.readFileSync(FILE, "utf8")));
  } catch {
    cached = freshStore();
  }
  // Persist the normalised shape so a one-time migration is not repeated on
  // every restart. The write is atomic and ignored on a read-only disk.
  persist(cached);
  if (recoverStaleRequests(cached)) {
    cached.updatedAt = nowIso();
    persist(cached);
  }
  return cached;
};

const writeStore = (store: CreditStore): void => {
  store.updatedAt = nowIso();
  persist(store);
};

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const hashesMatch = (left: string, right: string): boolean => {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
};

export const validCreditToken = (value: unknown): value is string =>
  typeof value === "string" && TOKEN_PATTERN.test(value);

export const validRequestId = (value: unknown): value is string =>
  typeof value === "string" && REQUEST_ID_PATTERN.test(value);

export const validCreditUserId = (value: unknown): value is string =>
  typeof value === "string" && USER_KEY_PATTERN.test(value);

const actionRows = (config: CreditConfig): CreditSummary["actions"] =>
  CREDIT_ACTION_KEYS.map((key) => ({
    key,
    ...config.actions[key],
  }));

const periodLabel = (days: number): string =>
  days === 1 ? "day" : `${days} days`;

const benefitsForPlan = (id: CreditPlanId, plan: CreditPlanConfig): string[] => {
  const benefits = [
    `${plan.creditsPerPeriod.toLocaleString()} credits per ${periodLabel(plan.periodDays)}`,
    id === "plus" ? "Higher AI usage limits" : "Standard AI access",
    id === "plus" ? "Extended AI memory" : "Basic AI memory",
    "Access to all ordinary app features",
  ];
  if (plan.advancedFeatures) benefits.push("Advanced AI features, including file attachments");
  return benefits;
};

const planOffer = (id: CreditPlanId, config: CreditConfig): CreditPlanOffer => {
  const plan = config.plans[id];
  return {
    id,
    label: plan.label,
    creditsPerPeriod: plan.creditsPerPeriod,
    periodDays: plan.periodDays,
    benefits: benefitsForPlan(id, plan),
  };
};

const isFuture = (value: string | undefined, now = Date.now()): boolean => {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > now;
};

const subscriptionOf = (account: CreditAccount, config: CreditConfig): SubscriptionInfo => {
  const plan = config.plans[account.plan];
  const active = planIsActive(account);
  return {
    tier: account.plan,
    label: plan.label,
    // A lapsed store subscription can still be stored as active until the
    // next read; report the effective state rather than the stale flag.
    status:
      !active && account.subscriptionStatus === "active"
        ? "expired"
        : account.subscriptionStatus,
    startedAt: account.subscriptionStartedAt,
    renewalAt: account.renewalAt,
    expiresAt: account.expiresAt,
    cancelAtPeriodEnd: Boolean(account.cancelAtPeriodEnd),
    inGracePeriod: Boolean(
      account.subscriptionStatus === "past_due" && isFuture(account.gracePeriodEndsAt),
    ),
    managementUrl: account.managementUrl,
    providerRef: account.paymentProviderRef,
  };
};

/**
 * Plus access follows the paid period, not just the last webhook label. A
 * cancellation keeps access until expiry; a billing issue keeps access through
 * a grace period or the paid period; an expiration/refund drops to Free.
 */
const planIsActive = (account: CreditAccount): boolean => {
  if (account.plan === "free") return true;
  const now = Date.now();
  const periodOpen = !account.expiresAt || isFuture(account.expiresAt, now);
  if (account.subscriptionStatus === "active") return periodOpen;
  if (account.subscriptionStatus === "past_due") {
    return periodOpen || isFuture(account.gracePeriodEndsAt, now);
  }
  if (account.subscriptionStatus === "canceled") {
    return Boolean(account.cancelAtPeriodEnd) && (periodOpen || isFuture(account.gracePeriodEndsAt, now));
  }
  return false;
};

const entitlementsOf = (account: CreditAccount, config: CreditConfig): SubscriptionEntitlements => {
  const active = planIsActive(account);
  const tier: CreditPlanId = active ? account.plan : "free";
  const plan = config.plans[tier];
  return {
    tier,
    status:
      !active && account.subscriptionStatus === "active"
        ? "expired"
        : account.subscriptionStatus,
    active,
    advancedFeatures: active && plan.advancedFeatures,
    requestsPerDay: plan.requestsPerDay,
    tokensPerDay: plan.tokensPerDay,
    memoryLimit: plan.memoryLimit,
    historyLimit: plan.historyLimit,
    historyCharLimit: plan.historyCharLimit,
    maxAttachments: plan.maxAttachments,
  };
};

const summaryOf = (account: CreditAccount, config: CreditConfig): CreditSummary => {
  const plan = config.plans[account.plan];
  return {
    plan: { id: account.plan, label: plan.label },
    subscription: subscriptionOf(account, config),
    entitlements: entitlementsOf(account, config),
    benefits: benefitsForPlan(account.plan, plan),
    plans: CREDIT_PLAN_IDS.map((id) => planOffer(id, config)),
    balance: account.balance,
    total: account.allocated,
    periodCreditsUsed: account.periodCreditsUsed,
    periodStart: account.periodStart,
    periodEnd: account.periodEnd,
    resetAt: account.periodEnd,
    actions: actionRows(config),
  };
};

const requestKey = (userId: string, requestId: string): string => `${userId}:${requestId}`;

const publicHistory = (rows: CreditHistoryEntry[], limit = 100): CreditHistoryRow[] =>
  rows.slice(0, Math.max(1, Math.min(limit, 500))).map((entry) => ({
    ...entry,
    userShortId: entry.userId.slice(0, 10),
  }));

const accountPlan = (store: CreditStore, account: CreditAccount): CreditPlanConfig =>
  store.config.plans[account.plan] || store.config.plans.free;

/**
 * Create the account on first use, or verify the existing vault credential.
 * Registration is idempotent: a page reload can call it again safely.
 */
export const registerCreditAccount = (input: {
  userId: unknown;
  token: unknown;
}): CreditSummary => {
  if (!validCreditUserId(input.userId)) {
    throw new CreditError("That account id is not valid for AI credits.", 400, "bad_user_id");
  }
  if (!validCreditToken(input.token)) {
    throw new CreditError("The AI credit credential is not valid.", 400, "bad_credit_token");
  }

  const store = readStore();
  const existing = store.accounts[input.userId];
  const tokenHash = hashToken(input.token);

  if (existing) {
    if (!hashesMatch(existing.tokenHash, tokenHash)) {
      throw new CreditError(
        "This account already has a different AI credit credential.",
        401,
        "credit_token_mismatch",
      );
    }
    const rolled = refreshAccountPeriod(existing, store.config);
    if (rolled) writeStore(store);
    return summaryOf(existing, store.config);
  }

  if (Object.keys(store.accounts).length >= MAX_ACCOUNTS) {
    throw new CreditError("The AI credit account limit has been reached.", 429, "credit_accounts_full");
  }

  const plan = store.config.plans.free;
  const createdAt = nowIso();
  const account: CreditAccount = {
    userId: input.userId,
    tokenHash,
    plan: "free",
    balance: plan.creditsPerPeriod,
    allocated: plan.creditsPerPeriod,
    periodCreditsUsed: 0,
    periodStart: createdAt,
    periodEnd: addDays(createdAt, plan.periodDays),
    subscriptionStatus: "active",
    subscriptionStartedAt: createdAt,
    renewalAt: addDays(createdAt, plan.periodDays),
    expiresAt: addDays(createdAt, plan.periodDays),
    revenueCatCustomerId: input.userId,
    revenueCatAliases: [],
    cancelAtPeriodEnd: false,
    createdAt,
    updatedAt: createdAt,
  };
  store.accounts[input.userId] = account;
  writeStore(store);
  return summaryOf(account, store.config);
};

/**
 * Create the one wallet owned by a server-verified account. The browser never
 * supplies this id and never receives a wallet credential: the HttpOnly
 * session is the authority. Calling this repeatedly is idempotent and cannot
 * mint additional credits.
 */
export const ensureCreditAccount = (userId: string): CreditSummary => {
  if (!validCreditUserId(userId)) {
    throw new CreditError("That account id is not valid for AI credits.", 400, "bad_user_id");
  }

  const store = readStore();
  const existing = store.accounts[userId];
  if (existing) {
    if (refreshAccountPeriod(existing, store.config)) writeStore(store);
    return summaryOf(existing, store.config);
  }

  if (Object.keys(store.accounts).length >= MAX_ACCOUNTS) {
    throw new CreditError("The AI credit account limit has been reached.", 429, "credit_accounts_full");
  }

  const plan = store.config.plans.free;
  const createdAt = nowIso();
  const account: CreditAccount = {
    userId,
    // A random, never-disclosed hash keeps the store shape compatible while
    // making legacy token authentication impossible for new wallets.
    tokenHash: hashToken(randomBytes(32).toString("hex")),
    plan: "free",
    balance: plan.creditsPerPeriod,
    allocated: plan.creditsPerPeriod,
    periodCreditsUsed: 0,
    periodStart: createdAt,
    periodEnd: addDays(createdAt, plan.periodDays),
    subscriptionStatus: "active",
    subscriptionStartedAt: createdAt,
    renewalAt: addDays(createdAt, plan.periodDays),
    expiresAt: addDays(createdAt, plan.periodDays),
    revenueCatCustomerId: userId,
    revenueCatAliases: [],
    cancelAtPeriodEnd: false,
    createdAt,
    updatedAt: createdAt,
  };
  store.accounts[userId] = account;
  writeStore(store);
  return summaryOf(account, store.config);
};

/** One-time migration: move a legacy browser-hash wallet to a verified account. */
export const claimCreditAccount = (input: {
  legacyUserId: unknown;
  legacyToken: unknown;
  userId: string;
}): CreditSummary => {
  if (!validCreditUserId(input.legacyUserId)) {
    throw new CreditError("That legacy account id is not valid.", 400, "bad_user_id");
  }
  if (input.legacyUserId === input.userId) {
    return creditSummary(input.userId);
  }

  // Prove ownership of the old wallet before touching it.
  authenticateCreditAccount(input.legacyUserId, input.legacyToken);

  const store = readStore();
  const legacy = store.accounts[input.legacyUserId];
  if (!legacy) {
    throw new CreditError("That legacy wallet could not be found.", 404, "credit_not_found");
  }
  if (store.accounts[input.userId]) {
    throw new CreditError(
      "This account already has an AI wallet. No credits were moved.",
      409,
      "wallet_already_claimed",
    );
  }

  const moved: CreditAccount = {
    ...legacy,
    userId: input.userId,
    tokenHash: hashToken(randomBytes(32).toString("hex")),
    revenueCatCustomerId: legacy.revenueCatCustomerId || input.legacyUserId,
    revenueCatAliases: [
      ...new Set([
        ...(legacy.revenueCatAliases || []),
        legacy.revenueCatCustomerId,
        input.legacyUserId,
        input.userId,
      ].filter((entry): entry is string => Boolean(entry))),
    ].slice(0, 20),
    updatedAt: nowIso(),
  };

  delete store.accounts[input.legacyUserId];
  store.accounts[input.userId] = moved;

  for (const entry of store.history) {
    if (entry.userId === input.legacyUserId) entry.userId = input.userId;
  }
  const nextRequests: Record<string, StoredRequest> = {};
  for (const [key, request] of Object.entries(store.requests)) {
    const belongsToLegacy = request.userId === input.legacyUserId;
    const nextKey = belongsToLegacy && key.startsWith(`${input.legacyUserId}:`)
      ? `${input.userId}:${key.slice(input.legacyUserId.length + 1)}`
      : key;
    nextRequests[nextKey] = belongsToLegacy ? { ...request, userId: input.userId } : request;
  }
  store.requests = nextRequests;
  writeStore(store);
  return summaryOf(moved, store.config);
};

export const authenticateCreditAccount = (userId: unknown, token: unknown): CreditAccount => {
  if (!validCreditUserId(userId)) {
    throw new CreditError("AI credits are not set up for this account.", 401, "credit_auth_required");
  }
  if (!validCreditToken(token)) {
    throw new CreditError("AI credits are not set up for this account.", 401, "credit_auth_required");
  }

  const store = readStore();
  const account = store.accounts[userId];
  if (!account || !hashesMatch(account.tokenHash, hashToken(token))) {
    throw new CreditError("AI credits are not set up for this account.", 401, "credit_auth_required");
  }

  if (refreshAccountPeriod(account, store.config)) writeStore(store);
  return account;
};

export const creditSummary = (userId: string): CreditSummary => {
  const store = readStore();
  const account = store.accounts[userId];
  if (!account) throw new CreditError("AI credits are not set up for this account.", 404, "credit_not_found");
  if (refreshAccountPeriod(account, store.config)) writeStore(store);
  return summaryOf(account, store.config);
};

/** Tier limits used by the AI service, not by the browser. */
export const subscriptionEntitlements = (userId: string): SubscriptionEntitlements => {
  const store = readStore();
  const account = store.accounts[userId];
  if (!account) throw new CreditError("AI credits are not set up for this account.", 401, "credit_auth_required");
  if (refreshAccountPeriod(account, store.config)) writeStore(store);
  return entitlementsOf(account, store.config);
};

/** Reject a Plus-only request before credits are reserved. */
export const assertAttachmentAccess = (
  userId: string,
  count: number,
): SubscriptionEntitlements => {
  const entitlements = subscriptionEntitlements(userId);
  if (count <= 0) return entitlements;
  if (!entitlements.advancedFeatures || entitlements.maxAttachments <= 0) {
    throw new CreditError(
      "File attachments are a Plus feature. Upgrade to send images or files with a message.",
      403,
      "plus_required",
    );
  }
  if (count > entitlements.maxAttachments) {
    throw new CreditError(
      `Your plan allows ${entitlements.maxAttachments} attachment${entitlements.maxAttachments === 1 ? "" : "s"} per message.`,
      403,
      "attachment_limit",
    );
  }
  return entitlements;
};

export const classifyCreditAction = (input: {
  mode?: unknown;
  attachments?: unknown;
}): CreditActionKey => {
  if (Array.isArray(input.attachments) && input.attachments.length > 0) return "complex_task";
  if (input.mode === "planning") return "daily_plan";
  if (input.mode === "progress" || input.mode === "budget") return "detailed_analysis";
  return "simple_message";
};

/**
 * Take the credits before the provider call. Because this is synchronous and
 * happens in one event-loop turn, concurrent requests cannot read the same
 * balance twice. A request id makes retries idempotent.
 */
export const reserveCredits = (input: {
  userId: string;
  action: CreditActionKey;
  requestId: string;
}): { summary: CreditSummary; action: CreditActionKey; credits: number; requestId: string } => {
  if (!validCreditUserId(input.userId)) {
    throw new CreditError("AI credits are not set up for this account.", 401, "credit_auth_required");
  }
  if (!validRequestId(input.requestId)) {
    throw new CreditError("A valid request id is required.", 400, "bad_request_id");
  }

  const store = readStore();
  const account = store.accounts[input.userId];
  if (!account) {
    throw new CreditError("AI credits are not set up for this account.", 401, "credit_auth_required");
  }
  if (refreshAccountPeriod(account, store.config)) writeStore(store);

  const key = requestKey(input.userId, input.requestId);
  const prior = store.requests[key];
  if (prior?.status === "succeeded") {
    throw new CreditError(
      "This AI request was already processed. No credits were taken again.",
      409,
      "duplicate_request",
    );
  }
  if (prior?.status === "pending") {
    throw new CreditError(
      "This AI request is already being processed.",
      409,
      "request_in_progress",
    );
  }

  const actionConfig = store.config.actions[input.action];
  const credits = actionConfig.cost;
  if (account.balance < credits) {
    throw new CreditError(
      `You need ${credits} credits for this action, but you have ${account.balance}.`,
      402,
      "insufficient_credits",
    );
  }

  const createdAt = nowIso();
  const historyId = randomUUID();
  account.balance -= credits;
  account.periodCreditsUsed += credits;
  account.updatedAt = createdAt;
  account.lastUsedAt = createdAt;

  const history: CreditHistoryEntry = {
    id: historyId,
    userId: input.userId,
    action: input.action,
    actionLabel: actionConfig.label,
    credits,
    createdAt,
    status: "pending",
    requestId: input.requestId,
    plan: account.plan,
  };
  store.history.unshift(history);
  store.history = store.history.slice(0, MAX_HISTORY);
  store.requests[key] = {
    userId: input.userId,
    action: input.action,
    credits,
    status: "pending",
    createdAt,
    historyId,
  };

  const keys = Object.keys(store.requests);
  if (keys.length > MAX_REQUESTS) {
    for (const oldKey of keys.slice(0, keys.length - MAX_REQUESTS)) {
      if (store.requests[oldKey]?.status !== "pending") delete store.requests[oldKey];
    }
  }

  writeStore(store);
  return {
    summary: summaryOf(account, store.config),
    action: input.action,
    credits,
    requestId: input.requestId,
  };
};

export const settleCredits = (input: {
  userId: string;
  requestId: string;
}): CreditSummary => {
  const store = readStore();
  const key = requestKey(input.userId, input.requestId);
  const request = store.requests[key];
  const account = store.accounts[input.userId];
  if (!request || !account) {
    throw new CreditError("That AI request could not be found.", 404, "request_not_found");
  }
  if (request.status === "failed") {
    throw new CreditError("That AI request has already failed.", 409, "request_failed");
  }

  if (request.status === "pending") {
    request.status = "succeeded";
    request.completedAt = nowIso();
    const history = store.history.find((entry) => entry.id === request.historyId);
    if (history) {
      history.status = "succeeded";
      history.completedAt = request.completedAt;
    }
    account.updatedAt = request.completedAt;
    writeStore(store);
  }

  return summaryOf(account, store.config);
};

export const refundCredits = (input: {
  userId: string;
  requestId: string;
}): CreditSummary => {
  const store = readStore();
  const key = requestKey(input.userId, input.requestId);
  const request = store.requests[key];
  const account = store.accounts[input.userId];
  if (!request || !account) {
    throw new CreditError("That AI request could not be found.", 404, "request_not_found");
  }
  if (request.status === "succeeded") {
    throw new CreditError("A completed request cannot be refunded.", 409, "request_already_settled");
  }
  if (request.status === "failed") return summaryOf(account, store.config);

  account.balance = Math.min(account.allocated, account.balance + request.credits);
  account.periodCreditsUsed = Math.max(0, account.periodCreditsUsed - request.credits);
  account.updatedAt = nowIso();
  request.status = "failed";
  request.completedAt = account.updatedAt;
  const history = store.history.find((entry) => entry.id === request.historyId);
  if (history) {
    history.status = "failed";
    history.credits = 0;
    history.completedAt = account.updatedAt;
  }
  writeStore(store);
  return summaryOf(account, store.config);
};

export const creditHistory = (userId: string, limit = 30): CreditHistoryRow[] => {
  const store = readStore();
  return publicHistory(
    store.history.filter((entry) => entry.userId === userId),
    limit,
  );
};

export const creditOverview = (): CreditOverview => {
  const store = readStore();
  let rolled = false;
  for (const account of Object.values(store.accounts)) {
    if (refreshAccountPeriod(account, store.config)) rolled = true;
  }
  if (rolled) writeStore(store);

  const accounts = Object.values(store.accounts)
    .sort((a, b) => (b.lastUsedAt || b.updatedAt).localeCompare(a.lastUsedAt || a.updatedAt))
    .slice(0, 100)
    .map((account) => {
      const plan = accountPlan(store, account);
      return {
        userId: account.userId,
        userShortId: account.userId.slice(0, 10),
        plan: account.plan,
        planLabel: plan.label,
        subscriptionStatus: account.subscriptionStatus,
        subscriptionStartedAt: account.subscriptionStartedAt,
        renewalAt: account.renewalAt,
        expiresAt: account.expiresAt,
        paymentProviderRef: account.paymentProviderRef,
        balance: account.balance,
        total: account.allocated,
        periodCreditsUsed: account.periodCreditsUsed,
        periodStart: account.periodStart,
        periodEnd: account.periodEnd,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
        lastUsedAt: account.lastUsedAt,
      };
    });

  return {
    config: {
      actions: actionRows(store.config),
      plans: CREDIT_PLAN_IDS.map((id) => ({
        id,
        ...store.config.plans[id],
      })),
      updatedAt: store.config.updatedAt,
    },
    accounts,
    history: publicHistory(store.history, 100),
  };
};

export const updateCreditConfig = (input: unknown): CreditOverview => {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const actions = raw.actions && typeof raw.actions === "object" ? raw.actions : {};
  const plans = raw.plans && typeof raw.plans === "object" ? raw.plans : {};

  if (!actions || typeof actions !== "object" || !plans || typeof plans !== "object") {
    throw new CreditError("Credit settings must include actions and plans.", 400, "bad_credit_settings");
  }

  const store = readStore();
  const next = cleanConfig({
    actions: {
      ...store.config.actions,
      ...(actions as Record<string, unknown>),
    },
    plans: {
      ...store.config.plans,
      ...(plans as Record<string, unknown>),
    },
  });

  store.config = next;
  writeStore(store);
  return creditOverview();
};

export const setAccountPlan = (input: {
  userId: unknown;
  plan: unknown;
}): CreditOverview => {
  if (!validCreditUserId(input.userId)) {
    throw new CreditError("Choose a valid credit account.", 400, "bad_user_id");
  }
  if (!isPlanId(input.plan)) {
    throw new CreditError("Choose the free or plus plan.", 400, "bad_plan");
  }

  const store = readStore();
  const account = store.accounts[input.userId];
  if (!account) throw new CreditError("That credit account was not found.", 404, "credit_not_found");

  const plan = store.config.plans[input.plan];
  const changedAt = nowIso();
  const periodEnd = addDays(changedAt, plan.periodDays);
  account.plan = input.plan;
  account.balance = plan.creditsPerPeriod;
  account.allocated = plan.creditsPerPeriod;
  account.periodCreditsUsed = 0;
  account.periodStart = changedAt;
  account.periodEnd = periodEnd;
  account.subscriptionStatus = "active";
  account.subscriptionStartedAt = changedAt;
  account.renewalAt = periodEnd;
  account.expiresAt = periodEnd;
  account.cancelAtPeriodEnd = false;
  account.gracePeriodEndsAt = undefined;
  account.paymentProviderRef = undefined;
  account.updatedAt = changedAt;
  writeStore(store);
  return creditOverview();
};

export const setSubscriptionStatus = (input: {
  userId: unknown;
  status: unknown;
}): CreditOverview => {
  if (!validCreditUserId(input.userId)) {
    throw new CreditError("Choose a valid credit account.", 400, "bad_user_id");
  }
  if (!isSubscriptionStatus(input.status)) {
    throw new CreditError("Choose a valid subscription status.", 400, "bad_subscription_status");
  }

  const store = readStore();
  const account = store.accounts[input.userId];
  if (!account) throw new CreditError("That credit account was not found.", 404, "credit_not_found");
  if (account.plan === "free" && input.status !== "active") {
    throw new CreditError(
      "The Free tier is the permanent fallback and cannot be deactivated.",
      400,
      "free_subscription_required",
    );
  }

  account.subscriptionStatus = input.status;
  if (input.status !== "active" && account.plan === "plus") {
    resetToFreeAccount(account, store.config, input.status);
  } else {
    account.updatedAt = nowIso();
  }
  writeStore(store);
  return creditOverview();
};

/** RevenueCat may use aliases, so match every identity it sends. */
export const findCreditAccountByRevenueCatIds = (ids: string[]): CreditAccount | undefined => {
  const store = readStore();
  const wanted = new Set(ids.filter((entry) => typeof entry === "string" && entry.length > 0));
  if (wanted.size === 0) return undefined;
  for (const id of wanted) {
    if (store.accounts[id]) return store.accounts[id];
    const lower = id.toLowerCase();
    if (store.accounts[lower]) return store.accounts[lower];
  }
  return Object.values(store.accounts).find((account) => {
    const aliases = [account.revenueCatCustomerId, ...(account.revenueCatAliases || [])].filter(
      (entry): entry is string => Boolean(entry),
    );
    return aliases.some((alias) => wanted.has(alias));
  });
};

/** A wallet owner can explicitly attach a RevenueCat App User ID to their wallet. */
export const linkRevenueCatCustomer = (input: {
  userId: unknown;
  token: unknown;
  customerId: unknown;
}): CreditSummary => {
  const account = authenticateCreditAccount(input.userId, input.token);
  const customerId = typeof input.customerId === "string" ? input.customerId.trim() : "";
  if (!/^[A-Za-z0-9_$:.@-]{1,200}$/.test(customerId)) {
    throw new CreditError("That RevenueCat customer id is not valid.", 400, "bad_billing_customer_id");
  }
  const store = readStore();
  const live = store.accounts[account.userId];
  if (!live) throw new CreditError("That credit account was not found.", 404, "credit_not_found");
  live.revenueCatCustomerId = customerId;
  live.revenueCatAliases = [
    ...new Set([...(live.revenueCatAliases || []), customerId]),
  ].slice(0, 20);
  live.updatedAt = nowIso();
  writeStore(store);
  return summaryOf(live, store.config);
};

export interface RevenueCatEntitlementUpdate {
  eventId: string;
  eventType: string;
  customerId: string;
  appUserIds?: string[];
  plan: CreditPlanId;
  status: SubscriptionStatus;
  environment?: BillingEnvironment;
  productId?: string;
  entitlementId?: string;
  purchasedAt?: string;
  expiresAt?: string;
  gracePeriodEndsAt?: string;
  cancelAtPeriodEnd?: boolean;
  managementUrl?: string;
  resetCredits?: boolean;
  receivedAt?: string;
}

/**
 * Apply one authenticated RevenueCat event to the wallet ledger.
 *
 * The event id is stored before returning, so a retried webhook cannot reset a
 * renewal allowance or renew access twice. An event for an unregistered wallet
 * is acknowledged and logged, not allowed to create a wallet: registration
 * still requires the vault credential.
 */
export const applyRevenueCatEntitlement = (
  input: RevenueCatEntitlementUpdate,
): { matched: boolean; duplicate: boolean; summary?: CreditSummary } => {
  const store = readStore();
  const eventId = input.eventId.slice(0, 200);
  const existing = store.billingEvents[eventId];
  if (existing) {
    return { matched: existing.matched, duplicate: true };
  }

  const ids = [input.customerId, ...(input.appUserIds || [])]
    .filter((entry, index, all) => Boolean(entry) && all.indexOf(entry) === index)
    .slice(0, 20);
  const account = findCreditAccountByRevenueCatIds(ids);
  const receivedAt = input.receivedAt || nowIso();

  if (!account) {
    store.billingEvents[eventId] = {
      id: eventId,
      type: input.eventType.slice(0, 80),
      customerId: input.customerId.slice(0, 200),
      receivedAt,
      matched: false,
    };
    writeStore(store);
    return { matched: false, duplicate: false };
  }

  account.revenueCatCustomerId = account.revenueCatCustomerId || input.customerId;
  account.revenueCatAliases = [
    ...new Set([...(account.revenueCatAliases || []), ...ids]),
  ].slice(0, 20);
  account.revenueCatEnvironment = input.environment;
  account.revenueCatProductId = input.productId;
  account.revenueCatEntitlementId = input.entitlementId;
  account.managementUrl = input.managementUrl || account.managementUrl;
  account.lastBillingEventId = eventId;
  account.lastBillingEventType = input.eventType.slice(0, 80);
  account.lastBillingEventAt = receivedAt;

  const expiresAt = input.expiresAt;
  const graceOpen = isFuture(input.gracePeriodEndsAt);
  // A billing issue can arrive after the paid period closes but while the grace
  // period is still open; that is still an entitled Plus period.
  const expired = expiresAt
    ? !isFuture(expiresAt) && !(input.status === "past_due" && graceOpen)
    : false;
  const grantPlus =
    input.plan === "plus" &&
    input.status !== "expired" &&
    input.status !== "refunded" &&
    !expired;

  if (grantPlus) {
    const plan = store.config.plans.plus;
    const end = expiresAt || addDays(receivedAt, plan.periodDays);
    account.plan = "plus";
    account.subscriptionStatus = input.status;
    account.subscriptionStartedAt = input.purchasedAt || account.subscriptionStartedAt;
    account.expiresAt = end;
    account.renewalAt = end;
    account.cancelAtPeriodEnd = input.cancelAtPeriodEnd === true;
    account.gracePeriodEndsAt = input.gracePeriodEndsAt;
    if (input.resetCredits) {
      account.balance = plan.creditsPerPeriod;
      account.allocated = plan.creditsPerPeriod;
      account.periodCreditsUsed = 0;
      account.periodStart = receivedAt;
      account.periodEnd = end;
    }
  } else {
    resetToFreeAccount(
      account,
      store.config,
      input.status === "active" ? "expired" : input.status,
    );
  }

  account.updatedAt = receivedAt;
  store.billingEvents[eventId] = {
    id: eventId,
    type: input.eventType.slice(0, 80),
    customerId: input.customerId.slice(0, 200),
    receivedAt,
    matched: true,
  };

  const keys = Object.keys(store.billingEvents);
  if (keys.length > 2_000) {
    for (const oldKey of keys.slice(0, keys.length - 2_000)) delete store.billingEvents[oldKey];
  }

  writeStore(store);
  return { matched: true, duplicate: false, summary: summaryOf(account, store.config) };
};

export interface BillingEventRow {
  id: string;
  type: string;
  customerId: string;
  receivedAt: string;
  matched: boolean;
}

export const billingEventHistory = (limit = 100): BillingEventRow[] => {
  const store = readStore();
  return Object.values(store.billingEvents)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, Math.max(1, Math.min(limit, 500)));
};

/** Test helper: forget the in-memory copy so the file is read again. */
export const resetCreditsCache = (): void => {
  cached = null;
};
