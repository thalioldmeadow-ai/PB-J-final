/**
 * Server-only spending protection adapter.
 *
 * When Supabase is configured, a request reserves its worst-case cost through
 * `reserve_ai_spend`, which locks the daily/monthly counters and checks both
 * outstanding reservations and actual spend. The reservation is consumed by
 * `record_ai_usage` once the provider reports usage, or released when no call
 * reaches a provider.
 *
 * A local reservation remains available for tests and deployments without
 * Supabase. That path is process-local; the Supabase path is the atomic,
 * cross-process one used in production.
 */

import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient, supabaseEnvironmentStatus } from "../supabaseClient";
import { pendingSpend, reserveSpend, type LimitVerdict } from "./usage";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SpendProtectionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "SpendProtectionError";
  }
}

export const supabaseSpendingConfigured = (): boolean => {
  const status = supabaseEnvironmentStatus();
  return status.variables.SUPABASE_URL && status.variables.SUPABASE_SERVICE_ROLE_KEY;
};

export interface SpendReservationInput {
  requestId?: string;
  userId?: string;
  maxCostAud: number;
  dailyLimitAud: number;
  monthlyHardLimitAud: number;
  perUserDailyLimitAud?: number;
  perUserMonthlyLimitAud?: number;
}

export interface SpendSettlement {
  provider: string;
  model: string;
  action: string;
  plan: string;
  inputTokens: number;
  outputTokens: number;
  credits: number;
  costUsd: number;
  costAud: number;
  durationMs: number;
  estimatedUsage: boolean;
}

export interface SpendReservation extends LimitVerdict {
  source: "supabase" | "local";
  reservedAud: number;
  requestId: string;
  release: () => Promise<void>;
  settle: (settlement: SpendSettlement) => Promise<void>;
}

interface SupabaseReservationRow {
  reserved_aud?: number | string;
  status?: string;
  duplicate?: boolean;
}

const localReservation = (input: SpendReservationInput): SpendReservation => {
  const requestId = input.requestId || randomUUID();
  const result = reserveSpend(input.maxCostAud, {
    dailyLimitAud: input.dailyLimitAud,
    monthlyHardLimitAud: input.monthlyHardLimitAud,
  });
  return {
    ...result,
    source: "local",
    requestId,
    release: async () => {
      result.release();
    },
    settle: async () => undefined,
  };
};

const budgetReason = (message: string): LimitVerdict["reason"] | null => {
  const text = message.toLowerCase();
  if (text.includes("ai_global_daily_budget_exceeded")) return "daily-budget";
  if (text.includes("ai_global_monthly_budget_exceeded")) return "monthly-budget";
  if (text.includes("ai_daily_budget_exceeded")) return "user-daily-budget";
  if (text.includes("ai_monthly_budget_exceeded")) return "user-monthly-budget";
  return null;
};

const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    throw new SpendProtectionError(
      "The spending protection service is temporarily unavailable.",
      503,
      "spend_protection_unavailable",
    );
  }
  return data as T;
};

const firstRow = (data: unknown): SupabaseReservationRow | null => {
  if (Array.isArray(data)) return (data[0] as SupabaseReservationRow) || null;
  if (data && typeof data === "object") return data as SupabaseReservationRow;
  return null;
};

export const reserveProtectedSpend = async (
  input: SpendReservationInput,
): Promise<SpendReservation> => {
  const userId = (input.userId || "").trim();
  const requestId = input.requestId || randomUUID();
  if (!supabaseSpendingConfigured() || !UUID_RE.test(userId)) {
    return localReservation({ ...input, requestId });
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc("reserve_ai_spend", {
    p_user_id: userId,
    p_request_id: requestId,
    p_max_cost_aud: Math.max(0, Number(input.maxCostAud) || 0),
    p_daily_limit_aud: input.perUserDailyLimitAud || null,
    p_monthly_limit_aud: input.perUserMonthlyLimitAud || null,
    p_global_daily_limit_aud: input.dailyLimitAud || null,
    p_global_monthly_limit_aud: input.monthlyHardLimitAud || null,
  });

  if (error) {
    const reason = budgetReason(error.message || "");
    if (reason) {
      return {
        allowed: false,
        reason,
        scope: reason.startsWith("user-") ? "user" : "global",
        source: "supabase",
        reservedAud: 0,
        requestId,
        release: async () => undefined,
        settle: async () => undefined,
      };
    }
    throw new SpendProtectionError(
      "The spending protection service is temporarily unavailable.",
      503,
      "spend_protection_unavailable",
    );
  }

  const row = firstRow(data);
  if (!row || row.status !== "reserved") {
    throw new SpendProtectionError(
      "The spending reservation could not be created.",
      503,
      "spend_reservation_failed",
    );
  }

  let released = false;
  return {
    allowed: true,
    source: "supabase",
    reservedAud: Math.max(0, Number(row.reserved_aud) || 0),
    requestId,
    release: async () => {
      if (released) return;
      released = true;
      try {
        await call("release_ai_spend", { p_user_id: userId, p_request_id: requestId });
      } catch {
        // A reservation that cannot be released expires server-side. Never
        // fail the user's request because cleanup had a transport error.
      }
    },
    settle: async (settlement) => {
      if (released) return;
      released = true;
      await call("record_ai_usage", {
        p_user_id: userId,
        p_request_id: requestId,
        p_provider: settlement.provider,
        p_model: settlement.model,
        p_action: settlement.action,
        p_plan: settlement.plan,
        p_input_tokens: Math.max(0, Math.round(settlement.inputTokens)),
        p_output_tokens: Math.max(0, Math.round(settlement.outputTokens)),
        p_credits: Math.max(0, Math.round(settlement.credits)),
        p_cost_billing: Number(settlement.costUsd) || 0,
        p_billing_currency: "USD",
        p_cost_usd: Number(settlement.costUsd) || 0,
        p_cost_aud: Number(settlement.costAud) || 0,
        p_duration_ms: Math.max(0, Math.round(settlement.durationMs)),
        p_status: "success",
        p_estimated_usage: settlement.estimatedUsage,
      });
    },
  };
};

export interface SupabaseSpendingOverview {
  generatedAt: string | null;
  dayAud: number;
  monthAud: number;
  dayReservedAud: number;
  monthReservedAud: number;
  byUser: Record<string, number>;
  byModel: Record<string, number>;
  byProvider: Record<string, number>;
  reservations: { active: number; reservedAud: number; uncertain: number };
}

const numeric = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const numberMap = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, cost]) => [key, numeric(cost)]),
  );
};

/** Read the same financial summary the credit dashboard uses. */
export const loadSupabaseSpendingOverview = async (): Promise<SupabaseSpendingOverview | null> => {
  if (!supabaseSpendingConfigured()) return null;
  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc("admin_financial_overview");
  if (error || !data || typeof data !== "object") {
    throw new SpendProtectionError(
      "The Supabase spending summary could not be read.",
      503,
      "supabase_spending_unavailable",
    );
  }
  const source = data as Record<string, any>;
  const spending = source.spending || {};
  const reservations = source.reservations || {};
  return {
    generatedAt: typeof source.generatedAt === "string" ? source.generatedAt : null,
    dayAud: numeric(spending.dayAud),
    monthAud: numeric(spending.monthAud),
    dayReservedAud: numeric(spending.dayReservedAud),
    monthReservedAud: numeric(spending.monthReservedAud),
    byUser: numberMap(spending.byUser),
    byModel: numberMap(spending.byModel),
    byProvider: numberMap(spending.byProvider),
    reservations: {
      active: numeric(reservations.active),
      reservedAud: numeric(reservations.reservedAud),
      uncertain: numeric(reservations.uncertain),
    },
  };
};

/** Local outstanding reservations without calling Supabase. */
export const localOutstandingReservations = pendingSpend;
