/**
 * Server-only AI usage/spend analytics.
 *
 * Date ranges are resolved in UTC and passed to one aggregate RPC. The RPC
 * returns display labels and short references only; no email addresses or full
 * user ids are exposed to the browser.
 */

import {
  getSupabaseAdminClient,
  SupabaseClientConfigError,
} from "../supabaseClient";

export type AnalyticsPreset = "today" | "last7" | "last30" | "month" | "custom";

export interface AdminAiAnalyticsQuery {
  preset: AnalyticsPreset;
  from?: string;
  to?: string;
  provider?: string;
  model?: string;
  action?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AnalyticsRange {
  preset: AnalyticsPreset;
  from: string;
  to: string;
  timezone: "UTC";
}

export interface AnalyticsSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  cancelledRequests: number | null;
  cancelledAvailable: boolean;
  cancelledReason: string;
  creditsUsed: number;
  actualSpendAud: number;
  estimatedSpendAud: number;
  recordedSpendAud: number;
  actualSpendTodayAud: number;
  estimatedSpendTodayAud: number;
  actualSpendMonthAud: number;
  estimatedSpendMonthAud: number;
  reservedAud: number;
  uncertainReservedAud: number;
  heldReservedAud: number;
  averageCostPerRequestAud: number;
  averageActualCostPerRequestAud: number;
}

export interface AnalyticsTimeseriesPoint {
  day: string;
  requests: number;
  successful: number;
  failed: number;
  credits: number;
  actualCostAud: number;
  estimatedCostAud: number;
  costAud: number;
}

export interface AnalyticsBreakdownRow {
  provider?: string;
  model?: string;
  action?: string;
  requests: number;
  successful: number;
  failed: number;
  credits: number;
  actualCostAud: number;
  estimatedCostAud: number;
  costAud: number;
}

export interface AnalyticsUserRow {
  userLabel: string;
  userShortId: string;
  requests: number;
  successful: number;
  failed: number;
  credits: number;
  actualCostAud: number;
  estimatedCostAud: number;
  costAud: number;
}

export interface AnalyticsHistoryRow {
  requestId: string;
  userLabel: string;
  userShortId: string;
  action: string;
  model: string;
  provider: string;
  credits: number;
  actualCostAud: number;
  estimatedCostAud: number;
  costAud: number;
  status: "success" | "failed";
  estimated: boolean;
  createdAt: string;
}

export interface AdminAiAnalytics {
  generatedAt: string;
  range: AnalyticsRange;
  filters: {
    provider: string | null;
    model: string | null;
    action: string | null;
    search: string | null;
    options: {
      providers: string[];
      models: string[];
      actions: string[];
    };
  };
  summary: AnalyticsSummary;
  timeseries: AnalyticsTimeseriesPoint[];
  byProvider: AnalyticsBreakdownRow[];
  byModel: AnalyticsBreakdownRow[];
  byAction: AnalyticsBreakdownRow[];
  byUser: AnalyticsUserRow[];
  historyTotal: number;
  history: AnalyticsHistoryRow[];
}

export class AnalyticsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "AnalyticsError";
  }
}

const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const isAnalyticsPreset = (value: string): value is AnalyticsPreset =>
  value === "today" || value === "last7" || value === "last30" || value === "month" || value === "custom";

const startOfUtcDay = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

const startOfUtcMonth = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);

const parseDateOnly = (value: string | undefined, label: string): number => {
  if (!value || !DATE_ONLY.test(value)) {
    throw new AnalyticsError(
      `Choose a valid ${label} date in YYYY-MM-DD format.`,
      400,
      "bad_custom_date",
    );
  }
  const [year, month, day] = value.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const parsed = new Date(ms);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new AnalyticsError(
      `Choose a valid ${label} date.`,
      400,
      "bad_custom_date",
    );
  }
  return ms;
};

export function resolveAnalyticsRange(
  preset: AnalyticsPreset,
  from?: string,
  to?: string,
  now = new Date(),
): AnalyticsRange {
  const today = startOfUtcDay(now);
  let start: number;
  let end: number;

  if (preset === "custom") {
    start = parseDateOnly(from, "start");
    end = parseDateOnly(to, "end") + DAY_MS;
  } else if (preset === "today") {
    start = today;
    end = today + DAY_MS;
  } else if (preset === "last7") {
    start = today - 6 * DAY_MS;
    end = today + DAY_MS;
  } else if (preset === "last30") {
    start = today - 29 * DAY_MS;
    end = today + DAY_MS;
  } else {
    start = startOfUtcMonth(now);
    end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  }

  if (end <= start) {
    throw new AnalyticsError(
      "The end date must be after the start date.",
      400,
      "bad_date_range",
    );
  }

  return {
    preset,
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
    timezone: "UTC",
  };
}

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AnalyticsError(
      `Supabase returned an invalid ${label} response.`,
      502,
      "analytics_invalid",
    );
  }
  return value as Record<string, unknown>;
};

const asNumber = (value: unknown, label: string): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AnalyticsError(
      `Supabase returned an invalid ${label} statistic.`,
      502,
      "analytics_invalid",
    );
  }
  return parsed;
};

const asNullableNumber = (value: unknown, label: string): number | null => {
  if (value === null || value === undefined) return null;
  return asNumber(value, label);
};

const asString = (value: unknown, label: string): string => {
  if (typeof value !== "string") {
    throw new AnalyticsError(
      `Supabase returned an invalid ${label}.`,
      502,
      "analytics_invalid",
    );
  }
  return value;
};

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const normaliseRange = (data: Record<string, unknown>, fallback: AnalyticsRange): AnalyticsRange => {
  const raw = data.range;
  if (!raw || typeof raw !== "object") return fallback;
  const range = raw as Record<string, unknown>;
  return {
    preset: isAnalyticsPreset(String(range.preset)) ? (range.preset as AnalyticsPreset) : fallback.preset,
    from: typeof range.from === "string" ? range.from : fallback.from,
    to: typeof range.to === "string" ? range.to : fallback.to,
    timezone: "UTC",
  };
};

const normalise = (
  data: unknown,
  fallbackRange: AnalyticsRange,
  selected: Pick<AdminAiAnalyticsQuery, "provider" | "model" | "action" | "search">,
): AdminAiAnalytics => {
  const root = asRecord(data, "analytics");
  const summary = asRecord(root.summary, "summary");
  const options = asRecord(root.options, "filter options");
  const range = normaliseRange(root, fallbackRange);

  return {
    generatedAt:
      typeof root.generatedAt === "string" && root.generatedAt
        ? root.generatedAt
        : new Date().toISOString(),
    range,
    filters: {
      provider: selected.provider || null,
      model: selected.model || null,
      action: selected.action || null,
      search: selected.search || null,
      options: {
        providers: asStringArray(options.providers),
        models: asStringArray(options.models),
        actions: asStringArray(options.actions),
      },
    },
    summary: {
      totalRequests: asNumber(summary.totalRequests, "total requests"),
      successfulRequests: asNumber(summary.successfulRequests, "successful requests"),
      failedRequests: asNumber(summary.failedRequests, "failed requests"),
      cancelledRequests: asNullableNumber(summary.cancelledRequests, "cancelled requests"),
      cancelledAvailable: summary.cancelledAvailable === true,
      cancelledReason:
        typeof summary.cancelledReason === "string"
          ? summary.cancelledReason
          : "Cancelled requests are not recorded.",
      creditsUsed: asNumber(summary.creditsUsed, "credits used"),
      actualSpendAud: asNumber(summary.actualSpendAud, "actual spend"),
      estimatedSpendAud: asNumber(summary.estimatedSpendAud, "estimated spend"),
      recordedSpendAud: asNumber(summary.recordedSpendAud, "recorded spend"),
      actualSpendTodayAud: asNumber(summary.actualSpendTodayAud, "actual spend today"),
      estimatedSpendTodayAud: asNumber(summary.estimatedSpendTodayAud, "estimated spend today"),
      actualSpendMonthAud: asNumber(summary.actualSpendMonthAud, "actual spend this month"),
      estimatedSpendMonthAud: asNumber(summary.estimatedSpendMonthAud, "estimated spend this month"),
      reservedAud: asNumber(summary.reservedAud, "reserved spend"),
      uncertainReservedAud: asNumber(summary.uncertainReservedAud, "uncertain reserved spend"),
      heldReservedAud: asNumber(summary.heldReservedAud, "held reserved spend"),
      averageCostPerRequestAud: asNumber(summary.averageCostPerRequestAud, "average cost per request"),
      averageActualCostPerRequestAud: asNumber(
        summary.averageActualCostPerRequestAud,
        "average actual cost per request",
      ),
    },
    timeseries: asArray<AnalyticsTimeseriesPoint>(root.timeseries),
    byProvider: asArray<AnalyticsBreakdownRow>(root.byProvider),
    byModel: asArray<AnalyticsBreakdownRow>(root.byModel),
    byAction: asArray<AnalyticsBreakdownRow>(root.byAction),
    byUser: asArray<AnalyticsUserRow>(root.byUser),
    historyTotal: asNumber(root.historyTotal, "history total"),
    history: asArray<AnalyticsHistoryRow>(root.history),
  };
};

export async function loadAdminAiAnalytics(
  query: AdminAiAnalyticsQuery,
): Promise<AdminAiAnalytics> {
  const range = resolveAnalyticsRange(query.preset, query.from, query.to);
  const limit = Math.min(200, Math.max(1, Math.trunc(query.limit ?? 25)));
  const offset = Math.min(1_000_000, Math.max(0, Math.trunc(query.offset ?? 0)));
  const provider = (query.provider || "").trim().slice(0, 120) || null;
  const model = (query.model || "").trim().slice(0, 120) || null;
  const action = (query.action || "").trim().slice(0, 80) || null;
  const search = (query.search || "").trim().slice(0, 100) || null;

  let data: unknown;
  try {
    const result = await getSupabaseAdminClient().rpc("admin_ai_analytics", {
      p_start: range.from,
      p_end: range.to,
      p_provider: provider,
      p_model: model,
      p_action: action,
      p_search: search,
      p_limit: limit,
      p_offset: offset,
    });
    if (result.error) {
      throw new AnalyticsError(
        "AI usage analytics could not be read.",
        503,
        "analytics_unavailable",
      );
    }
    data = result.data;
  } catch (error) {
    if (error instanceof AnalyticsError) throw error;
    if (error instanceof SupabaseClientConfigError) {
      throw new AnalyticsError(
        "Supabase analytics are not configured on this server.",
        503,
        "supabase_not_configured",
      );
    }
    throw new AnalyticsError(
      "AI usage analytics could not be read.",
      503,
      "analytics_unavailable",
    );
  }

  return normalise(data, range, { provider: provider || undefined, model: model || undefined, action: action || undefined, search: search || undefined });
}

export { asString };