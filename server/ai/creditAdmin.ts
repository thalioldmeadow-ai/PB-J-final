/**
 * Server-only administrator credit management for the Supabase ledger.
 *
 * Balances are never written by the browser. The route passes the verified
 * administrator actor to a transactional RPC, which locks the wallet, writes
 * the transaction with before/after balances, and appends the admin audit row.
 */

import {
  getSupabaseAdminClient,
  SupabaseClientConfigError,
} from "../supabaseClient";
import type { AdminActor } from "../security/adminAuth";

export interface CreditAdminAction {
  key: string;
  label: string;
  description: string;
  cost: number;
}

export interface CreditAdminPlan {
  id: string;
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

export interface CreditAdminConfig {
  actions: CreditAdminAction[];
  plans: CreditAdminPlan[];
  updatedAt: string;
}

export interface CreditAdminUser {
  userId: string;
  userShortId: string;
  displayName: string;
  plan: string;
  planLabel: string;
  subscriptionStatus: string;
  balance: number;
  allocated: number;
  totalReceivedCredits: number;
  totalSpentCredits: number;
  transactionCount: number;
  periodCreditsUsed: number;
  periodStart: string;
  periodEnd: string;
  renewalAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface CreditAdminTransaction {
  id: string;
  kind: string;
  creditsDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string | null;
  requestId: string | null;
  adminUserId: string | null;
  createdAt: string;
}

export interface CreditAdminOverview {
  generatedAt: string;
  source: "supabase";
  config: CreditAdminConfig;
  summary: {
    wallets: number;
    heldCredits: number;
    allocatedCredits: number;
    totalSpentCredits: number;
  };
  total: number;
  users: CreditAdminUser[];
}

export interface CreditAdminUserDetail {
  generatedAt: string;
  user: CreditAdminUser;
  transactions: CreditAdminTransaction[];
}

export interface CreditAdminSettingsInput {
  actions?: Record<string, number>;
  plans?: Record<string, { creditsPerPeriod: number; periodDays: number }>;
}

export interface CreditAdminAdjustmentInput {
  userId: string;
  delta: number;
  reason: string;
  requestId: string;
}

export class CreditAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "CreditAdminError";
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_RE = /^[A-Za-z0-9_-]{8,80}$/;
const ACTION_KEYS = new Set(["simple_message", "daily_plan", "detailed_analysis", "complex_task"]);
const PLAN_IDS = new Set(["free", "plus"]);

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreditAdminError(`Supabase returned an invalid ${label}.`, 502, "credit_invalid");
  }
  return value as Record<string, unknown>;
};

const asNumber = (value: unknown, label: string): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CreditAdminError(`Supabase returned an invalid ${label}.`, 502, "credit_invalid");
  }
  return parsed;
};

const asString = (value: unknown, label: string): string => {
  if (typeof value !== "string") {
    throw new CreditAdminError(`Supabase returned an invalid ${label}.`, 502, "credit_invalid");
  }
  return value;
};

const asNullableString = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const configOf = (value: unknown): CreditAdminConfig => {
  const config = asRecord(value, "credit configuration");
  return {
    actions: asArray<Record<string, unknown>>(config.actions).map((action) => ({
      key: asString(action.key, "action key"),
      label: asString(action.label, "action label"),
      description: asString(action.description, "action description"),
      cost: asNumber(action.cost, "action cost"),
    })),
    plans: asArray<Record<string, unknown>>(config.plans).map((plan) => ({
      id: asString(plan.id, "plan id"),
      label: asString(plan.label, "plan label"),
      creditsPerPeriod: asNumber(plan.creditsPerPeriod, "plan allocation"),
      periodDays: asNumber(plan.periodDays, "plan period"),
      requestsPerDay: asNumber(plan.requestsPerDay, "plan request limit"),
      tokensPerDay: asNumber(plan.tokensPerDay, "plan token limit"),
      memoryLimit: asNumber(plan.memoryLimit, "plan memory limit"),
      historyLimit: asNumber(plan.historyLimit, "plan history limit"),
      historyCharLimit: asNumber(plan.historyCharLimit, "plan history character limit"),
      maxAttachments: asNumber(plan.maxAttachments, "plan attachment limit"),
      advancedFeatures: plan.advancedFeatures === true,
    })),
    updatedAt: asString(config.updatedAt, "configuration timestamp"),
  };
};

const userOf = (value: unknown): CreditAdminUser => {
  const user = asRecord(value, "credit user");
  return {
    userId: asString(user.userId, "user id"),
    userShortId: asString(user.userShortId, "user reference"),
    displayName: asString(user.displayName, "display name"),
    plan: asString(user.plan, "plan"),
    planLabel: asString(user.planLabel, "plan label"),
    subscriptionStatus: asString(user.subscriptionStatus, "subscription status"),
    balance: asNumber(user.balance, "balance"),
    allocated: asNumber(user.allocated, "allocation"),
    totalReceivedCredits: asNumber(user.totalReceivedCredits, "received credits"),
    totalSpentCredits: asNumber(user.totalSpentCredits, "spent credits"),
    transactionCount: asNumber(user.transactionCount, "transaction count"),
    periodCreditsUsed: asNumber(user.periodCreditsUsed, "period credits used"),
    periodStart: asString(user.periodStart, "period start"),
    periodEnd: asString(user.periodEnd, "period end"),
    renewalAt: asString(user.renewalAt, "renewal date"),
    expiresAt: asString(user.expiresAt, "expiry date"),
    createdAt: asString(user.createdAt, "creation date"),
    updatedAt: asString(user.updatedAt, "update date"),
    lastUsedAt: asNullableString(user.lastUsedAt),
  };
};

const transactionOf = (value: unknown): CreditAdminTransaction => {
  const row = asRecord(value, "credit transaction");
  return {
    id: asString(row.id, "transaction id"),
    kind: asString(row.kind, "transaction kind"),
    creditsDelta: Number(row.creditsDelta),
    balanceBefore: asNumber(row.balanceBefore, "balance before"),
    balanceAfter: asNumber(row.balanceAfter, "balance after"),
    reason: asNullableString(row.reason),
    requestId: asNullableString(row.requestId),
    adminUserId: asNullableString(row.adminUserId),
    createdAt: asString(row.createdAt, "transaction date"),
  };
};

const mapRpcError = (message: string): CreditAdminError => {
  const known: Record<string, [number, string]> = {
    wallet_not_found: [404, "That credit wallet was not found."],
    adjustment_would_make_balance_negative: [400, "That removal would make the balance negative."],
    adjustment_reason_required: [400, "Enter a reason for this adjustment."],
    bad_adjustment_amount: [400, "Enter a valid non-zero adjustment amount."],
    bad_request_id: [400, "The adjustment could not be identified. Try again."],
    bad_credit_cost: [400, "Enter a valid credit cost."],
    bad_credit_plan: [400, "Enter a valid allocation and allocation period."],
    unknown_credit_action: [400, "Unknown credit action."],
    no_credit_changes: [400, "No credit settings were changed."],
    admin_user_not_authorized: [403, "Administrator authorization failed."],
    break_glass_actor_required: [403, "Administrator authorization failed."],
  };
  for (const [key, [status, text]] of Object.entries(known)) {
    if (message.includes(key)) return new CreditAdminError(text, status, key);
  }
  return new CreditAdminError("Credit management is temporarily unavailable.", 503, "credit_management_unavailable");
};

const callRpc = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
  try {
    const result = await getSupabaseAdminClient().rpc(name, args);
    if (result.error) throw mapRpcError(result.error.message || "");
    return result.data;
  } catch (error) {
    if (error instanceof CreditAdminError) throw error;
    if (error instanceof SupabaseClientConfigError) {
      throw new CreditAdminError(
        "Supabase credit management is not configured on this server.",
        503,
        "supabase_not_configured",
      );
    }
    throw new CreditAdminError("Credit management is temporarily unavailable.", 503, "credit_management_unavailable");
  }
};

export async function loadAdminCreditManagement(input: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<CreditAdminOverview> {
  const search = (input.search || "").trim().slice(0, 100) || null;
  const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 25)));
  const offset = Math.min(1_000_000, Math.max(0, Math.trunc(input.offset ?? 0)));
  const data = asRecord(
    await callRpc("admin_credit_management", {
      p_search: search,
      p_limit: limit,
      p_offset: offset,
    }),
    "credit overview",
  );
  return {
    generatedAt: asString(data.generatedAt, "overview timestamp"),
    source: "supabase",
    config: configOf(data.config),
    summary: {
      wallets: asNumber(asRecord(data.summary, "credit summary").wallets, "wallet count"),
      heldCredits: asNumber(asRecord(data.summary, "credit summary").heldCredits, "held credits"),
      allocatedCredits: asNumber(asRecord(data.summary, "credit summary").allocatedCredits, "allocated credits"),
      totalSpentCredits: asNumber(asRecord(data.summary, "credit summary").totalSpentCredits, "spent credits"),
    },
    total: asNumber(data.total, "matching wallet count"),
    users: asArray<Record<string, unknown>>(data.users).map(userOf),
  };
}

export async function loadAdminCreditUser(userId: string, limit = 50): Promise<CreditAdminUserDetail> {
  if (!UUID_RE.test(userId)) {
    throw new CreditAdminError("Choose a valid credit user.", 400, "bad_user_id");
  }
  const data = asRecord(
    await callRpc("admin_credit_user_detail", {
      p_user_id: userId.toLowerCase(),
      p_limit: Math.min(100, Math.max(1, Math.trunc(limit))),
    }),
    "credit user detail",
  );
  return {
    generatedAt: asString(data.generatedAt, "detail timestamp"),
    user: userOf(data.user),
    transactions: asArray<Record<string, unknown>>(data.transactions).map(transactionOf),
  };
}

const actorArgs = (actor: AdminActor) => ({
  p_admin_user_id: actor.type === "admin_user" ? actor.userId : null,
  p_actor_type: actor.type,
  p_actor_id: actor.actorId,
});

export async function updateAdminCreditSettings(
  input: CreditAdminSettingsInput,
  actor: AdminActor,
  requestId: string,
): Promise<CreditAdminConfig> {
  if (!REQUEST_RE.test(requestId)) {
    throw new CreditAdminError("The settings change could not be identified.", 400, "bad_request_id");
  }
  const actions: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.actions || {})) {
    if (!ACTION_KEYS.has(key)) {
      throw new CreditAdminError("Unknown credit action.", 400, "unknown_credit_action");
    }
    const cost = Number(value);
    if (!Number.isFinite(cost) || cost < 0 || cost > 10_000) {
      throw new CreditAdminError("Enter a valid credit cost.", 400, "bad_credit_cost");
    }
    actions[key] = Math.round(cost * 10_000) / 10_000;
  }
  const plans: Record<string, { creditsPerPeriod: number; periodDays: number }> = {};
  for (const [id, value] of Object.entries(input.plans || {})) {
    if (!PLAN_IDS.has(id)) {
      throw new CreditAdminError("Unknown credit plan.", 400, "bad_credit_plan");
    }
    const credits = Number(value?.creditsPerPeriod);
    const days = Number(value?.periodDays);
    if (
      !Number.isFinite(credits) || credits < 0 || credits > 1_000_000 ||
      !Number.isFinite(days) || days < 1 || days > 3_650
    ) {
      throw new CreditAdminError("Enter a valid allocation and allocation period.", 400, "bad_credit_plan");
    }
    plans[id] = {
      creditsPerPeriod: Math.round(credits * 10_000) / 10_000,
      periodDays: Math.round(days),
    };
  }
  if (Object.keys(actions).length === 0 && Object.keys(plans).length === 0) {
    throw new CreditAdminError("No credit settings were changed.", 400, "no_credit_changes");
  }

  const data = await callRpc("admin_credit_settings_update", {
    ...actorArgs(actor),
    p_actions: actions,
    p_plans: plans,
    p_request_id: requestId,
  });
  return configOf(data);
}

export async function adjustAdminCredits(
  input: CreditAdminAdjustmentInput,
  actor: AdminActor,
  requestId: string,
): Promise<{
  balance: number;
  balanceBefore: number;
  balanceAfter: number;
  duplicate: boolean;
  transactionId: string;
}> {
  if (!UUID_RE.test(input.userId)) {
    throw new CreditAdminError("Choose a valid credit user.", 400, "bad_user_id");
  }
  const delta = Math.round(Number(input.delta) * 10_000) / 10_000;
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1_000_000) {
    throw new CreditAdminError("Enter a valid non-zero adjustment amount.", 400, "bad_adjustment_amount");
  }
  const reason = (input.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new CreditAdminError("Enter a reason for this adjustment.", 400, "adjustment_reason_required");
  }
  if (!REQUEST_RE.test(requestId)) {
    throw new CreditAdminError("The adjustment could not be identified. Try again.", 400, "bad_request_id");
  }

  const data = asRecord(
    await callRpc("admin_credit_adjustment", {
      ...actorArgs(actor),
      p_user_id: input.userId.toLowerCase(),
      p_delta: delta,
      p_reason: reason,
      p_request_id: requestId,
    }),
    "credit adjustment",
  );
  return {
    balance: asNumber(data.balance, "new balance"),
    balanceBefore: asNumber(data.balanceBefore, "previous balance"),
    balanceAfter: asNumber(data.balanceAfter, "new balance"),
    duplicate: data.duplicate === true,
    transactionId: asString(data.transactionId, "transaction id"),
  };
}