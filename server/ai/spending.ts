/**
 * Admin spending and safety view.
 *
 * Supabase is the source of truth for actual spend and outstanding
 * reservations when it is configured. The local JSON ledger remains the
 * fallback for tests and installations without Supabase, and still supplies
 * the historical/monthly series that Supabase does not expose here.
 */

import { loadAiConfig } from "./config";
import { loadOverrides } from "./overrides";
import { loadSupabaseSpendingOverview, supabaseSpendingConfigured } from "./spendProtection";
import { pendingSpend, summariseUsage } from "./usage";
import type { SpendProtectionError } from "./spendProtection";

export interface SpendingAlert {
  code: string;
  level: "warning" | "critical" | "info";
  message: string;
}

const round = (value: number): number => Number((Number(value) || 0).toFixed(4));

export const buildSpendingOverview = async () => {
  const config = loadAiConfig();
  const overrides = loadOverrides();
  const usage = summariseUsage();
  const localReservations = pendingSpend();
  let remote: Awaited<ReturnType<typeof loadSupabaseSpendingOverview>> = null;
  let fallbackReason: string | null = null;

  if (supabaseSpendingConfigured()) {
    try {
      remote = await loadSupabaseSpendingOverview();
    } catch (error) {
      fallbackReason =
        error instanceof Error ? error.message : "Supabase spending data could not be read.";
    }
  }

  const dayAud = round(remote?.dayAud ?? usage.today.costAud);
  const monthAud = round(remote?.monthAud ?? usage.thisMonth.costAud);
  const dayReservedAud = round(
    remote?.dayReservedAud ?? remote?.reservations.reservedAud ?? localReservations.reservedAud,
  );
  const monthReservedAud = round(
    remote?.monthReservedAud ?? remote?.reservations.reservedAud ?? localReservations.reservedAud,
  );
  const dailyLimit = config.limits.dailyLimitAud;
  const monthlyHardLimit = config.limits.monthlyHardLimitAud;
  const monthlyBudget = config.limits.monthlyBudgetAud;
  const remainingDaily = Math.max(0, dailyLimit - dayAud - dayReservedAud);
  const remainingMonthly = Math.max(0, monthlyHardLimit - monthAud - monthReservedAud);
  const dailyPercentage =
    dailyLimit > 0 ? round((dayAud + dayReservedAud) / dailyLimit) : dayAud > 0 ? 1 : 0;
  const monthlyPercentage =
    monthlyHardLimit > 0 ? round((monthAud + monthReservedAud) / monthlyHardLimit) : monthAud > 0 ? 1 : 0;

  const alerts: SpendingAlert[] = [];
  for (const threshold of config.warningThresholds) {
    if (dailyLimit > 0 && dailyPercentage >= threshold / 100) {
      alerts.push({
        code: `daily-${threshold}`,
        level: "warning",
        message: `Daily spending is ${Math.round(dailyPercentage * 100)}% of its limit (A$${dayAud.toFixed(
          2,
        )} spent, A$${dayReservedAud.toFixed(2)} reserved, limit A$${dailyLimit.toFixed(2)}).`,
      });
    }
    if (monthlyHardLimit > 0 && monthlyPercentage >= threshold / 100) {
      alerts.push({
        code: `budget-${threshold}`,
        level: "warning",
        message: `Monthly spending is ${Math.round(monthlyPercentage * 100)}% of the hard limit (A$${monthAud.toFixed(
          2,
        )} spent, A$${monthReservedAud.toFixed(2)} reserved, limit A$${monthlyHardLimit.toFixed(2)}).`,
      });
    }
  }
  if (dailyLimit > 0 && dayAud + dayReservedAud >= dailyLimit) {
    alerts.push({
      code: "daily-limit",
      level: "critical",
      message: "The daily spending ceiling, including outstanding reservations, has been reached.",
    });
  }
  if (monthlyHardLimit > 0 && monthAud + monthReservedAud >= monthlyHardLimit) {
    alerts.push({
      code: "monthly-limit",
      level: "critical",
      message: "The monthly hard spending ceiling, including outstanding reservations, has been reached.",
    });
  }
  if (config.emergency.paused || config.disabledByAdmin) {
    alerts.push({
      code: "ai-disabled",
      level: "info",
      message: config.emergency.paused
        ? "AI is paused by the emergency control. Requests already running are left to finish."
        : "AI is paused by the administrator. Ordinary app features remain available.",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    source: remote ? ("supabase" as const) : ("local" as const),
    fallbackReason,
    status: {
      enabled: config.enabled,
      paused: !config.enabled,
      pausedByEmergency: config.emergency.paused,
      pausedByAdmin: config.disabledByAdmin,
      emergency: config.emergency,
      configuredProviders: config.providers.filter((provider) => provider.enabled).length,
      availableModels: config.providers
        .filter((provider) => provider.enabled)
        .flatMap((provider) => provider.models.filter((model) => model.enabled !== false)).length,
      defaultModel: config.defaultModel ? `${config.defaultModel.provider}:${config.defaultModel.id}` : null,
    },
    limits: {
      dailyLimitAud: dailyLimit,
      monthlyHardLimitAud: monthlyHardLimit,
      monthlyBudgetAud: monthlyBudget,
      perUserDailyLimitAud: config.limits.perUserDailyLimitAud,
      perUserMonthlyLimitAud: config.limits.perUserMonthlyLimitAud,
      warningThresholds: config.warningThresholds,
      modelLimits: config.modelLimits,
      requestsPerDay: config.limits.requestsPerDay,
      tokensPerDay: config.limits.tokensPerDay,
      requestsPerDayPerUser: config.limits.requestsPerDayPerUser,
      tokensPerDayPerUser: config.limits.tokensPerDayPerUser,
      costPerMonthPerUserUsd: config.limits.costPerMonthPerUserUsd,
    },
    spending: {
      dayAud,
      monthAud,
      dayReservedAud,
      monthReservedAud,
      remainingDailyAud: remainingDaily,
      remainingMonthlyAud: remainingMonthly,
      dailyPercentage,
      monthlyPercentage,
      byProvider: remote?.byProvider ?? Object.fromEntries(
        Object.entries(usage.byProvider).map(([key, totals]) => [key, totals.costAud]),
      ),
      byModel: remote?.byModel ?? Object.fromEntries(
        Object.entries(usage.byModel).map(([key, totals]) => [key, totals.costAud]),
      ),
      monthlyHistory: usage.monthlyHistory,
    },
    reservations: {
      active: remote?.reservations.active ?? localReservations.count,
      reservedAud: remote?.reservations.reservedAud ?? localReservations.reservedAud,
      uncertain: remote?.reservations.uncertain ?? 0,
    },
    alerts,
    overrides: {
      warningThresholds: overrides.warningThresholds ?? null,
      emergencyPaused: overrides.emergencyPaused ?? null,
    },
  };
};

export type SpendingOverview = Awaited<ReturnType<typeof buildSpendingOverview>>;
export type { SpendProtectionError };
