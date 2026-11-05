/**
 * Server-only Supabase statistics for the AI administrator dashboard.
 *
 * The browser never talks to Supabase. This module calls one aggregate RPC
 * with the service-role client and validates the shape before returning it.
 * It returns counts and money totals only: no user ids, emails, prompts or
 * journal data are selected or exposed.
 */

import {
  getSupabaseAdminClient,
  SupabaseClientConfigError,
} from "../supabaseClient";

export interface SupabaseAdminOverview {
  generatedAt: string;
  source: "supabase";
  currency: "AUD";
  users: {
    total: number;
    free: number;
    plusActive: number;
    activeToday: number | null;
    activeLast30Days: number | null;
    activity: {
      available: boolean;
      reason: string;
    };
  };
  ai: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    creditsUsed: number;
    actualSpendTodayAud: number;
    actualSpendMonthAud: number;
    estimatedSpendTodayAud: number;
    estimatedSpendMonthAud: number;
  };
}

export class SupabaseOverviewError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "SupabaseOverviewError";
  }
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SupabaseOverviewError(
      "Supabase returned an invalid statistics response.",
      502,
      "supabase_overview_invalid",
    );
  }
  return value as Record<string, unknown>;
};

const requiredNumber = (value: unknown, field: string): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new SupabaseOverviewError(
      `Supabase returned an invalid ${field} statistic.`,
      502,
      "supabase_overview_invalid",
    );
  }
  return parsed;
};

const optionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const normalise = (payload: unknown): SupabaseAdminOverview => {
  const root = asRecord(payload);
  const users = asRecord(root.users);
  const ai = asRecord(root.ai);
  const activity = asRecord(users.activity);

  return {
    generatedAt:
      typeof root.generatedAt === "string" && root.generatedAt
        ? root.generatedAt
        : new Date().toISOString(),
    source: "supabase",
    currency: "AUD",
    users: {
      total: requiredNumber(users.total, "total users"),
      free: requiredNumber(users.free, "Free users"),
      plusActive: requiredNumber(users.plusActive, "active Plus subscriptions"),
      activeToday: optionalNumber(users.activeToday),
      activeLast30Days: optionalNumber(users.activeLast30Days),
      activity: {
        available: activity.available === true,
        reason:
          typeof activity.reason === "string" && activity.reason.trim()
            ? activity.reason.trim()
            : "App activity is not recorded, so active-user counts are unavailable.",
      },
    },
    ai: {
      totalRequests: requiredNumber(ai.totalRequests, "total AI requests"),
      successfulRequests: requiredNumber(ai.successfulRequests, "successful AI requests"),
      failedRequests: requiredNumber(ai.failedRequests, "failed AI requests"),
      creditsUsed: requiredNumber(ai.creditsUsed, "AI credits used"),
      actualSpendTodayAud: requiredNumber(ai.actualSpendTodayAud, "actual spend today"),
      actualSpendMonthAud: requiredNumber(ai.actualSpendMonthAud, "actual spend this month"),
      estimatedSpendTodayAud: requiredNumber(ai.estimatedSpendTodayAud, "estimated spend today"),
      estimatedSpendMonthAud: requiredNumber(ai.estimatedSpendMonthAud, "estimated spend this month"),
    },
  };
};

export async function loadSupabaseAdminOverview(): Promise<SupabaseAdminOverview> {
  let data: unknown;
  try {
    const result = await getSupabaseAdminClient().rpc("admin_supabase_overview");
    if (result.error) {
      throw new SupabaseOverviewError(
        "Supabase statistics could not be read.",
        503,
        "supabase_overview_unavailable",
      );
    }
    data = result.data;
  } catch (error) {
    if (error instanceof SupabaseOverviewError) throw error;
    if (error instanceof SupabaseClientConfigError) {
      throw new SupabaseOverviewError(
        "Supabase statistics are not configured on this server.",
        503,
        "supabase_not_configured",
      );
    }
    throw new SupabaseOverviewError(
      "Supabase statistics could not be read.",
      503,
      "supabase_overview_unavailable",
    );
  }

  return normalise(data);
}