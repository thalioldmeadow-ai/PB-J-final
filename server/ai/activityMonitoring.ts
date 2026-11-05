/**
 * Server-only user activity and unusual-activity monitoring.
 *
 * The dashboard reads real profile, wallet, AI usage, credit-request, credit
 * transaction and spend-rejection records. It never reads prompts, replies,
 * journal content, emails or billing customer references.
 *
 * Detection is advisory. Every rule is a fixed threshold or simple estimate,
 * and no rule changes a user's plan, credits, access or AI permissions.
 *
 * Alert review state is kept in the existing append-only administrator audit
 * log: the latest successful `monitoring.alert.review` entry for an alert key is
 * its current state. There is no separate mutable review table.
 */

import {
  getSupabaseAdminClient,
  SupabaseClientConfigError,
} from "../supabaseClient";
import { listLocalAdminAudit } from "../security/adminAudit";
import {
  resolveAnalyticsRange,
  type AnalyticsPreset,
  type AnalyticsRange,
} from "./analytics";
import { creditOverview } from "./credits";
import { summariseUsage } from "./usage";

export type MonitoringSeverity = "high" | "medium" | "low";
export type MonitoringAlertStatus = "open" | "reviewed";
export type MonitoringRuleKind = "threshold" | "estimate" | "unavailable";

export interface AdminActivityMonitoringQuery {
  preset: AnalyticsPreset;
  from?: string;
  to?: string;
  search?: string;
  severity?: MonitoringSeverity | "";
  alertStatus?: MonitoringAlertStatus | "";
  limit?: number;
  offset?: number;
}

export interface ActivityMonitoringRule {
  key: string;
  label: string;
  severity: MonitoringSeverity;
  kind: MonitoringRuleKind;
  available: boolean;
  description: string;
  threshold: string;
}

export interface ActivityRequestRef {
  requestId: string;
  action: string;
  status: string;
  model?: string;
  createdAt: string;
}

export interface ActivityTransaction {
  id: string;
  userId: string;
  userShortId: string;
  kind: string;
  creditsDelta: number;
  reason: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface ActivityAlert {
  key: string;
  rule: string;
  ruleLabel: string;
  severity: MonitoringSeverity;
  kind: MonitoringRuleKind;
  message: string;
  evidence: string;
  userId: string;
  userShortId: string;
  displayName: string;
  plan: string;
  status: MonitoringAlertStatus;
  reviewedAt: string | null;
  reviewedBy: string | null;
  note: string | null;
  relatedRequests: ActivityRequestRef[];
  detectedAt: string;
}

export interface ActivityUser {
  userId: string;
  userShortId: string;
  displayName: string;
  plan: string;
  planLabel: string;
  subscriptionStatus: string;
  accountCreatedAt: string;
  lastActivityAt: string | null;
  requests: number;
  failedRequests: number;
  creditsSpent: number;
  spendAud: number;
  lastRequestAt: string | null;
  balance: number | null;
  recentTransactions: ActivityTransaction[];
  alerts: number;
  highestSeverity: MonitoringSeverity | null;
}

export interface AdminActivityMonitoring {
  generatedAt: string;
  source: "supabase" | "local";
  range: AnalyticsRange;
  filters: {
    search: string | null;
    severity: MonitoringSeverity | null;
    alertStatus: MonitoringAlertStatus | null;
  };
  summary: {
    totalAccounts: number;
    filteredAccounts: number;
    activeInRange: number;
    activeToday: number;
    activeLast7Days: number;
    plusActive: number;
    freeWallets: number;
    totalRequests: number;
    failedRequests: number;
    creditsSpent: number;
    alertsOpen: number;
    alertsReviewed: number;
    highSeverityOpen: number;
  };
  users: ActivityUser[];
  totalUsers: number;
  alerts: ActivityAlert[];
  recentTransactions: ActivityTransaction[];
  rules: ActivityMonitoringRule[];
  limitations: string[];
}

export class MonitoringError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "MonitoringError";
  }
}

interface ReviewState {
  status: MonitoringAlertStatus;
  reviewedAt: string;
  reviewedBy: string | null;
  note: string | null;
}

interface NormalisedUsageEvent {
  userId: string;
  requestId: string;
  action: string;
  model: string;
  status: string;
  credits: number;
  costAud: number;
  createdAt: string;
}

interface NormalisedCreditRequest {
  userId: string;
  requestId: string;
  action: string;
  status: string;
  errorCode: string | null;
  credits: number;
  createdAt: string;
  completedAt: string | null;
}

interface NormalisedRejection {
  userId: string;
  requestId: string;
  reason: string;
  createdAt: string;
}

interface NormalisedTransaction {
  id: string;
  userId: string;
  requestId: string | null;
  kind: string;
  creditsDelta: number;
  reason: string | null;
  createdAt: string;
}

interface UserSeed {
  userId: string;
  displayName: string;
  plan: string;
  planLabel: string;
  subscriptionStatus: string;
  accountCreatedAt: string;
  balance: number | null;
  lastWalletUseAt: string | null;
}

interface UserAccumulator extends UserSeed {
  requests: number;
  failedRequests: number;
  creditsSpent: number;
  spendAud: number;
  lastActivityAt: string | null;
  lastRequestAt: string | null;
  events: NormalisedUsageEvent[];
  failures: NormalisedUsageEvent[];
  creditRequests: NormalisedCreditRequest[];
  transactions: NormalisedTransaction[];
  rejections: NormalisedRejection[];
}

const DAY_MS = 86_400_000;
const MAX_USERS = 1_000;
const MAX_EVENTS = 5_000;
const MAX_REQUESTS = 5_000;
const MAX_TRANSACTIONS = 2_000;
const MAX_REJECTIONS = 2_000;
const MAX_REVIEWS = 2_000;

const RULES: ActivityMonitoringRule[] = [
  {
    key: "high_ai_request_volume",
    label: "Unusually high AI request volume",
    severity: "high",
    kind: "threshold",
    available: true,
    description: "Flags accounts with an unusually large number of AI requests in the selected range.",
    threshold: "100 or more requests in the range; high severity at 250 or more.",
  },
  {
    key: "repeated_failed_requests",
    label: "Repeated failed AI requests",
    severity: "high",
    kind: "threshold",
    available: true,
    description: "Flags accounts whose AI requests repeatedly fail, which can indicate provider trouble or abuse.",
    threshold: "5 or more failed requests and a failure rate of at least 25%.",
  },
  {
    key: "repeated_insufficient_credits",
    label: "Repeated insufficient-credit requests",
    severity: "medium",
    kind: "threshold",
    available: true,
    description: "Flags repeated attempts to use AI after the wallet could not cover the action.",
    threshold: "3 or more failed credit requests with an insufficient-credits error code.",
  },
  {
    key: "repeated_spending_limit_rejections",
    label: "Repeated spending-limit rejections",
    severity: "high",
    kind: "threshold",
    available: true,
    description: "Flags repeated attempts that were rejected by a daily, monthly or per-request spend limit.",
    threshold: "3 or more recorded spend-limit rejections in the range.",
  },
  {
    key: "ai_spending_spike",
    label: "Unusual spike in AI spending",
    severity: "medium",
    kind: "estimate",
    available: true,
    description: "Compares each account's highest spending day with its other active days. This is an estimate and is not proof of misuse.",
    threshold: "Highest day at least A$5 and at least 3x the average of the account's other active days.",
  },
  {
    key: "unusual_credit_adjustments",
    label: "Unusual credit adjustments",
    severity: "medium",
    kind: "threshold",
    available: true,
    description: "Flags administrator credit adjustments for review. Adjustments can be legitimate, so this is a review prompt only.",
    threshold: "Any administrator adjustment in the range; high severity at 3 or more, or a total absolute adjustment of 500 credits or more.",
  },
  {
    key: "suspicious_authentication_activity",
    label: "Suspicious authentication activity",
    severity: "medium",
    kind: "unavailable",
    available: false,
    description: "No authentication-event history is stored in the current schema. Sign-ins, failed passwords and lockouts cannot be assessed here.",
    threshold: "Not available: no auth event or session-history source is populated.",
  },
  {
    key: "unusual_concurrent_requests",
    label: "Unusual concurrent request activity",
    severity: "medium",
    kind: "estimate",
    available: true,
    description: "Counts credit requests started in the same minute as a basic concurrency estimate. It does not prove parallel use of one account.",
    threshold: "5 or more requests started in the same minute; high severity at 10 or more.",
  },
];

const SEVERITY_RANK: Record<MonitoringSeverity, number> = { high: 3, medium: 2, low: 1 };

const asNumber = (value: unknown): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const optionalString = (value: unknown): string | null => {
  const text = asString(value).trim();
  return text ? text : null;
};

const isoOrNull = (value: unknown): string | null => {
  const text = asString(value);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
};

const latest = (...values: Array<string | null | undefined>): string | null => {
  let result: string | null = null;
  for (const value of values) {
    if (!value || !Number.isFinite(Date.parse(value))) continue;
    if (!result || Date.parse(value) > Date.parse(result)) result = value;
  }
  return result;
};

const shortId = (userId: string): string => userId.slice(0, 8);

const displayNameFor = (name: string | null | undefined, userId: string): string =>
  (name || "").trim().slice(0, 80) || `User ${shortId(userId)}`;

const clampLimit = (value: number | undefined): number =>
  Math.min(100, Math.max(1, Math.trunc(value ?? 25)));

const clampOffset = (value: number | undefined): number =>
  Math.min(1_000_000, Math.max(0, Math.trunc(value ?? 0)));

const inIsoRange = (value: string, range: AnalyticsRange): boolean =>
  value >= range.from && value < range.to;

const transactionReason = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return optionalString((metadata as Record<string, unknown>).reason);
};

const reviewsFromEntries = (
  entries: Array<{ action?: unknown; success?: unknown; createdAt?: unknown; actorId?: unknown; metadata?: unknown }>,
): Map<string, ReviewState> => {
  const reviews = new Map<string, ReviewState>();
  const ordered = [...entries].sort((a, b) => {
    const left = asString(a.createdAt);
    const right = asString(b.createdAt);
    return right.localeCompare(left);
  });
  for (const entry of ordered) {
    if (entry.success === false) continue;
    const metadata =
      entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
        ? (entry.metadata as Record<string, unknown>)
        : {};
    const alertKey = optionalString(metadata.alertKey);
    if (!alertKey || reviews.has(alertKey)) continue;
    const status = metadata.status === "reviewed" ? "reviewed" : "open";
    reviews.set(alertKey, {
      status,
      reviewedAt: isoOrNull(entry.createdAt) || new Date().toISOString(),
      reviewedBy: optionalString(entry.actorId),
      note: optionalString(metadata.note)?.slice(0, 1_000) || null,
    });
  }
  return reviews;
};

async function loadSupabaseReviews(): Promise<Map<string, ReviewState>> {
  const result = await getSupabaseAdminClient()
    .from("admin_audit_log")
    .select("actor_id,success,created_at,metadata")
    .eq("action", "monitoring.alert.review")
    .eq("success", true)
    .order("created_at", { ascending: false })
    .limit(MAX_REVIEWS);
  if (result.error) {
    throw new MonitoringError(
      "Alert review history could not be read.",
      503,
      "monitoring_reviews_unavailable",
    );
  }
  const reviews = reviewsFromEntries(
    (result.data ?? []).map((row: Record<string, unknown>) => ({
      action: "monitoring.alert.review",
      success: row.success,
      createdAt: row.created_at,
      actorId: row.actor_id,
      metadata: row.metadata,
    })),
  );
  // recordAdminAudit can fall back to the local audit file during a Supabase
  // audit outage. Merge that copy so an accepted review remains visible.
  for (const [key, state] of localReviews()) {
    const current = reviews.get(key);
    if (!current || state.reviewedAt > current.reviewedAt) reviews.set(key, state);
  }
  return reviews;
}

const localReviews = (): Map<string, ReviewState> =>
  reviewsFromEntries(
    listLocalAdminAudit(MAX_REVIEWS)
      .filter((entry) => entry.action === "monitoring.alert.review")
      .map((entry) => ({
        action: entry.action,
        success: entry.success,
        createdAt: entry.createdAt,
        actorId: entry.actorId,
        metadata: entry.metadata,
      })),
  );

function createAccumulator(seed: UserSeed): UserAccumulator {
  return {
    ...seed,
    requests: 0,
    failedRequests: 0,
    creditsSpent: 0,
    spendAud: 0,
    lastActivityAt: seed.lastWalletUseAt,
    lastRequestAt: null,
    events: [],
    failures: [],
    creditRequests: [],
    transactions: [],
    rejections: [],
  };
}

function addEvent(users: Map<string, UserAccumulator>, event: NormalisedUsageEvent): void {
  const user = users.get(event.userId);
  if (!user) return;
  user.events.push(event);
  user.requests += 1;
  if (event.status === "success") {
    user.creditsSpent += event.credits;
    user.spendAud += event.costAud;
  } else {
    user.failedRequests += 1;
    user.failures.push(event);
  }
  user.lastActivityAt = latest(user.lastActivityAt, event.createdAt);
  user.lastRequestAt = latest(user.lastRequestAt, event.createdAt);
}

function addCreditRequest(users: Map<string, UserAccumulator>, row: NormalisedCreditRequest): void {
  const user = users.get(row.userId);
  if (!user) return;
  user.creditRequests.push(row);
  user.lastActivityAt = latest(user.lastActivityAt, row.createdAt);
}

function addTransaction(users: Map<string, UserAccumulator>, row: NormalisedTransaction): void {
  const user = users.get(row.userId);
  if (!user) return;
  user.transactions.push(row);
  user.lastActivityAt = latest(user.lastActivityAt, row.createdAt);
}

function addRejection(users: Map<string, UserAccumulator>, row: NormalisedRejection): void {
  const user = users.get(row.userId);
  if (!user) return;
  user.rejections.push(row);
  user.lastActivityAt = latest(user.lastActivityAt, row.createdAt);
}

function requestRefs(
  events: NormalisedUsageEvent[],
  requests: NormalisedCreditRequest[] = [],
): ActivityRequestRef[] {
  const refs: ActivityRequestRef[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.requestId)) continue;
    seen.add(event.requestId);
    refs.push({
      requestId: event.requestId,
      action: event.action,
      status: event.status,
      model: event.model,
      createdAt: event.createdAt,
    });
  }
  for (const request of requests) {
    if (seen.has(request.requestId)) continue;
    seen.add(request.requestId);
    refs.push({
      requestId: request.requestId,
      action: request.action,
      status: request.status,
      createdAt: request.createdAt,
    });
  }
  return refs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
}

function concurrencyPeak(requests: NormalisedCreditRequest[]): { peak: number; requestIds: string[] } {
  const buckets = new Map<string, NormalisedCreditRequest[]>();
  for (const request of requests) {
    const bucket = request.createdAt.slice(0, 16);
    const existing = buckets.get(bucket);
    if (existing) existing.push(request);
    else buckets.set(bucket, [request]);
  }
  let peak = 0;
  let requestIds: string[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length > peak) {
      peak = bucket.length;
      requestIds = bucket.map((request) => request.requestId).slice(0, 5);
    }
  }
  return { peak, requestIds };
}

function spendSpike(events: NormalisedUsageEvent[]): { max: number; average: number } {
  const daily = new Map<string, number>();
  for (const event of events) {
    if (event.status !== "success") continue;
    const day = event.createdAt.slice(0, 10);
    daily.set(day, (daily.get(day) || 0) + event.costAud);
  }
  const values = [...daily.values()].filter((value) => value > 0);
  if (values.length < 2) return { max: values[0] || 0, average: values[0] || 0 };
  const max = Math.max(...values);
  const otherDays = values.filter((value) => value !== max);
  const average =
    otherDays.length > 0
      ? otherDays.reduce((total, value) => total + value, 0) / otherDays.length
      : max;
  return { max, average };
}

function alertFor(
  user: UserAccumulator,
  rule: ActivityMonitoringRule,
  input: {
    key: string;
    severity?: MonitoringSeverity;
    message: string;
    evidence: string;
    detectedAt: string;
    relatedRequests?: ActivityRequestRef[];
  },
  reviews: Map<string, ReviewState>,
): ActivityAlert {
  // Keep the key stable while a threshold counts up during the day, so a
  // review is not silently reset by the next request. A new day is a new alert.
  const key = `${rule.key}:${user.userId}:${input.detectedAt.slice(0, 10)}`;
  const review = reviews.get(key);
  return {
    key,
    rule: rule.key,
    ruleLabel: rule.label,
    severity: input.severity ?? rule.severity,
    kind: rule.kind,
    message: input.message,
    evidence: input.evidence,
    userId: user.userId,
    userShortId: shortId(user.userId),
    displayName: displayNameFor(user.displayName, user.userId),
    plan: user.plan,
    status: review?.status ?? "open",
    reviewedAt: review?.status === "reviewed" ? review.reviewedAt : null,
    reviewedBy: review?.status === "reviewed" ? review.reviewedBy : null,
    note: review?.note ?? null,
    relatedRequests: input.relatedRequests ?? [],
    detectedAt: input.detectedAt,
  };
}

function detectAlerts(
  user: UserAccumulator,
  reviews: Map<string, ReviewState>,
): ActivityAlert[] {
  const alerts: ActivityAlert[] = [];
  const rule = (key: string): ActivityMonitoringRule =>
    RULES.find((entry) => entry.key === key) as ActivityMonitoringRule;
  const detectedAt = latest(
    user.lastActivityAt,
    user.lastRequestAt,
    ...user.events.map((event) => event.createdAt),
  ) || new Date().toISOString();

  if (user.requests >= 100) {
    alerts.push(
      alertFor(
        user,
        rule("high_ai_request_volume"),
        {
          key: `${user.requests}`,
          severity: user.requests >= 250 ? "high" : "medium",
          message: `${user.requests} AI requests were recorded in this range.`,
          evidence: "Request count from ai_usage_events.",
          detectedAt,
          relatedRequests: requestRefs(user.events.slice(0, 10)),
        },
        reviews,
      ),
    );
  }

  const failureRate = user.requests > 0 ? user.failedRequests / user.requests : 0;
  if (user.failedRequests >= 5 && failureRate >= 0.25) {
    alerts.push(
      alertFor(
        user,
        rule("repeated_failed_requests"),
        {
          key: `${user.failedRequests}`,
          severity: user.failedRequests >= 10 || failureRate >= 0.5 ? "high" : "medium",
          message: `${user.failedRequests} of ${user.requests} AI requests failed (${Math.round(failureRate * 100)}%).`,
          evidence: "Failure counts from ai_usage_events.",
          detectedAt,
          relatedRequests: requestRefs(user.failures.slice(0, 10)),
        },
        reviews,
      ),
    );
  }

  const insufficient = user.creditRequests.filter(
    (request) =>
      request.status === "failed" && (request.errorCode || "").toLowerCase().includes("insufficient"),
  );
  if (insufficient.length >= 3) {
    alerts.push(
      alertFor(
        user,
        rule("repeated_insufficient_credits"),
        {
          key: `${insufficient.length}`,
          severity: insufficient.length >= 8 ? "high" : "medium",
          message: `${insufficient.length} AI requests failed because the wallet had insufficient credits.`,
          evidence: "credit_requests.error_code contains insufficient.",
          detectedAt,
          relatedRequests: requestRefs([], insufficient),
        },
        reviews,
      ),
    );
  }

  if (user.rejections.length >= 3) {
    alerts.push(
      alertFor(
        user,
        rule("repeated_spending_limit_rejections"),
        {
          key: `${user.rejections.length}`,
          severity: user.rejections.length >= 6 ? "high" : "medium",
          message: `${user.rejections.length} AI attempts were rejected by spending limits.`,
          evidence: "Rows from ai_spend_rejections.",
          detectedAt,
          relatedRequests: user.rejections.slice(0, 5).map((rejection) => ({
            requestId: rejection.requestId,
            action: rejection.reason,
            status: "rejected",
            createdAt: rejection.createdAt,
          })),
        },
        reviews,
      ),
    );
  }

  const spike = spendSpike(user.events);
  if (spike.max >= 5 && spike.average > 0 && spike.max >= spike.average * 3) {
    alerts.push(
      alertFor(
        user,
        rule("ai_spending_spike"),
        {
          key: `${spike.max.toFixed(2)}`,
          severity: spike.max >= 10 ? "high" : "medium",
          message: `Highest spending day was A$${spike.max.toFixed(2)}, ${(spike.max / spike.average).toFixed(1)}x the other-day average of A$${spike.average.toFixed(2)}.`,
          evidence: "Estimated from successful ai_usage_events cost_aud by UTC day.",
          detectedAt,
        },
        reviews,
      ),
    );
  }

  const adjustments = user.transactions.filter((transaction) => transaction.kind === "admin_adjustment");
  if (adjustments.length > 0) {
    const absolute = adjustments.reduce(
      (total, transaction) => total + Math.abs(transaction.creditsDelta),
      0,
    );
    alerts.push(
      alertFor(
        user,
        rule("unusual_credit_adjustments"),
        {
          key: `${adjustments.length}-${absolute.toFixed(2)}`,
          severity: adjustments.length >= 3 || absolute >= 500 ? "high" : "medium",
          message: `${adjustments.length} administrator credit adjustment${adjustments.length === 1 ? "" : "s"} changed the wallet by ${absolute.toFixed(2)} credits in total.`,
          evidence: "Rows from credit_transactions where kind = admin_adjustment.",
          detectedAt,
        },
        reviews,
      ),
    );
  }

  const concurrency = concurrencyPeak(user.creditRequests);
  if (concurrency.peak >= 5) {
    alerts.push(
      alertFor(
        user,
        rule("unusual_concurrent_requests"),
        {
          key: `${concurrency.peak}`,
          severity: concurrency.peak >= 10 ? "high" : "medium",
          message: `${concurrency.peak} credit requests started in the same UTC minute.`,
          evidence: "Basic same-minute count from credit_requests.created_at.",
          detectedAt,
          relatedRequests: concurrency.requestIds
            .map((requestId) =>
              user.creditRequests.find((request) => request.requestId === requestId),
            )
            .filter((request): request is NormalisedCreditRequest => Boolean(request))
            .map((request) => ({
              requestId: request.requestId,
              action: request.action,
              status: request.status,
              createdAt: request.createdAt,
            })),
        },
        reviews,
      ),
    );
  }

  return alerts;
}

function emptyStats() {
  return {
    totalAccounts: 0,
    filteredAccounts: 0,
    activeInRange: 0,
    activeToday: 0,
    activeLast7Days: 0,
    plusActive: 0,
    freeWallets: 0,
    totalRequests: 0,
    failedRequests: 0,
    creditsSpent: 0,
    alertsOpen: 0,
    alertsReviewed: 0,
    highSeverityOpen: 0,
  };
}

function buildResult(input: {
  source: "supabase" | "local";
  range: AnalyticsRange;
  query: AdminActivityMonitoringQuery;
  totalAccounts: number;
  users: UserAccumulator[];
  transactions: NormalisedTransaction[];
  reviews: Map<string, ReviewState>;
  limitations: string[];
}): AdminActivityMonitoring {
  const search = (input.query.search || "").trim().slice(0, 100).toLowerCase();
  const severity = input.query.severity || null;
  const alertStatus = input.query.alertStatus || null;
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const enriched = input.users
    .map((user) => {
      const alerts = detectAlerts(user, input.reviews);
      const highest = alerts.reduce<MonitoringSeverity | null>((current, alert) => {
        if (!current) return alert.severity;
        return SEVERITY_RANK[alert.severity] > SEVERITY_RANK[current] ? alert.severity : current;
      }, null);
      const transactions = user.transactions
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5)
        .map((transaction) => ({
          id: transaction.id,
          userId: transaction.userId,
          userShortId: shortId(transaction.userId),
          kind: transaction.kind,
          creditsDelta: transaction.creditsDelta,
          reason: transaction.reason,
          requestId: transaction.requestId,
          createdAt: transaction.createdAt,
        }));
      return { user, alerts, highest, transactions };
    })
    .filter(({ user }) => {
      if (!search) return true;
      return (
        user.displayName.toLowerCase().includes(search) ||
        user.userId.toLowerCase().includes(search)
      );
    })
    .sort((a, b) =>
      (b.user.lastActivityAt || "").localeCompare(a.user.lastActivityAt || "") ||
      a.user.userId.localeCompare(b.user.userId),
    );

  const alerts = enriched
    .flatMap((entry) => entry.alerts)
    .filter((alert) => !severity || alert.severity === severity)
    .filter((alert) => !alertStatus || alert.status === alertStatus)
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        b.detectedAt.localeCompare(a.detectedAt),
    );

  const allAlerts = enriched.flatMap((entry) => entry.alerts);
  const summary = emptyStats();
  summary.totalAccounts = input.totalAccounts;
  summary.filteredAccounts = enriched.length;
  summary.activeInRange = input.users.filter(
    (user) =>
      Boolean(user.lastActivityAt) &&
      Boolean(user.lastActivityAt && user.lastActivityAt >= input.range.from && user.lastActivityAt < input.range.to),
  ).length;
  summary.activeToday = input.users.filter(
    (user) => user.lastActivityAt && Date.parse(user.lastActivityAt) >= todayStart.getTime(),
  ).length;
  summary.activeLast7Days = input.users.filter(
    (user) => user.lastActivityAt && Date.parse(user.lastActivityAt) >= now - 7 * DAY_MS,
  ).length;
  summary.plusActive = input.users.filter(
    (user) => user.plan === "plus" && user.subscriptionStatus === "active",
  ).length;
  summary.freeWallets = input.users.filter((user) => user.plan === "free").length;
  summary.totalRequests = input.users.reduce((total, user) => total + user.requests, 0);
  summary.failedRequests = input.users.reduce((total, user) => total + user.failedRequests, 0);
  summary.creditsSpent = Number(
    input.users.reduce((total, user) => total + user.creditsSpent, 0).toFixed(4),
  );
  summary.alertsOpen = allAlerts.filter((alert) => alert.status === "open").length;
  summary.alertsReviewed = allAlerts.filter((alert) => alert.status === "reviewed").length;
  summary.highSeverityOpen = allAlerts.filter(
    (alert) => alert.status === "open" && alert.severity === "high",
  ).length;

  const offset = clampOffset(input.query.offset);
  const limit = clampLimit(input.query.limit);
  const page = enriched.slice(offset, offset + limit);

  return {
    generatedAt: new Date().toISOString(),
    source: input.source,
    range: input.range,
    filters: { search: search || null, severity, alertStatus },
    summary,
    users: page.map(({ user, highest, transactions }) => ({
      userId: user.userId,
      userShortId: shortId(user.userId),
      displayName: displayNameFor(user.displayName, user.userId),
      plan: user.plan,
      planLabel: user.planLabel,
      subscriptionStatus: user.subscriptionStatus,
      accountCreatedAt: user.accountCreatedAt,
      lastActivityAt: user.lastActivityAt,
      requests: user.requests,
      failedRequests: user.failedRequests,
      creditsSpent: Number(user.creditsSpent.toFixed(4)),
      spendAud: Number(user.spendAud.toFixed(6)),
      lastRequestAt: user.lastRequestAt,
      balance: user.balance,
      recentTransactions: transactions,
      alerts: enriched.find((entry) => entry.user.userId === user.userId)?.alerts.length ?? 0,
      highestSeverity: highest,
    })),
    totalUsers: enriched.length,
    alerts,
    recentTransactions: input.transactions
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50)
      .map((transaction) => ({
        id: transaction.id,
        userId: transaction.userId,
        userShortId: shortId(transaction.userId),
        kind: transaction.kind,
        creditsDelta: transaction.creditsDelta,
        reason: transaction.reason,
        requestId: transaction.requestId,
        createdAt: transaction.createdAt,
      })),
    rules: RULES,
    limitations: input.limitations,
  };
}

async function loadSupabaseMonitoring(
  range: AnalyticsRange,
  query: AdminActivityMonitoringQuery,
): Promise<AdminActivityMonitoring> {
  const client = getSupabaseAdminClient();
  const [
    profilesResult,
    walletsResult,
    plansResult,
    eventsResult,
    requestsResult,
    transactionsResult,
    rejectionsResult,
    reviews,
  ] = await Promise.all([
    client
      .from("profiles")
      .select("id,display_name,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(MAX_USERS),
    client
      .from("wallets")
      .select("user_id,plan,subscription_status,balance,last_used_at")
      .limit(MAX_USERS),
    client.from("credit_plans").select("id,label"),
    client
      .from("ai_usage_events")
      .select("user_id,request_id,action,model,status,credits,cost_aud,created_at")
      .gte("created_at", range.from)
      .lt("created_at", range.to)
      .order("created_at", { ascending: false })
      .limit(MAX_EVENTS),
    client
      .from("credit_requests")
      .select("user_id,request_id,action,status,error_code,credits,created_at,completed_at")
      .gte("created_at", range.from)
      .lt("created_at", range.to)
      .order("created_at", { ascending: false })
      .limit(MAX_REQUESTS),
    client
      .from("credit_transactions")
      .select("id,user_id,request_id,kind,credits_delta,metadata,created_at")
      .gte("created_at", range.from)
      .lt("created_at", range.to)
      .order("created_at", { ascending: false })
      .limit(MAX_TRANSACTIONS),
    client
      .from("ai_spend_rejections")
      .select("user_id,request_id,reason,created_at")
      .gte("created_at", range.from)
      .lt("created_at", range.to)
      .order("created_at", { ascending: false })
      .limit(MAX_REJECTIONS),
    loadSupabaseReviews(),
  ]);

  for (const result of [
    profilesResult,
    walletsResult,
    plansResult,
    eventsResult,
    requestsResult,
    transactionsResult,
    rejectionsResult,
  ]) {
    if (result.error) {
      throw new MonitoringError(
        "User activity records could not be read.",
        503,
        "monitoring_unavailable",
      );
    }
  }

  const planLabels = new Map<string, string>(
    ((plansResult.data ?? []) as Array<Record<string, unknown>>).map((plan) => [
      asString(plan.id),
      asString(plan.label),
    ]),
  );
  const wallets = new Map<string, Record<string, unknown>>();
  for (const wallet of (walletsResult.data ?? []) as Array<Record<string, unknown>>) {
    wallets.set(asString(wallet.user_id), wallet);
  }

  const users = new Map<string, UserAccumulator>();
  for (const profile of (profilesResult.data ?? []) as Array<Record<string, unknown>>) {
    const userId = asString(profile.id);
    if (!userId) continue;
    const wallet = wallets.get(userId);
    const plan = asString(wallet?.plan) || "unknown";
    users.set(
      userId,
      createAccumulator({
        userId,
        displayName: asString(profile.display_name),
        plan,
        planLabel: planLabels.get(plan) || (plan === "unknown" ? "No wallet" : plan),
        subscriptionStatus: asString(wallet?.subscription_status) || "unknown",
        accountCreatedAt: isoOrNull(profile.created_at) || new Date(0).toISOString(),
        balance: wallet ? asNumber(wallet.balance) : null,
        lastWalletUseAt: isoOrNull(wallet?.last_used_at),
      }),
    );
  }

  const events = ((eventsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    userId: asString(row.user_id),
    requestId: asString(row.request_id),
    action: asString(row.action),
    model: asString(row.model),
    status: asString(row.status),
    credits: asNumber(row.credits),
    costAud: asNumber(row.cost_aud),
    createdAt: isoOrNull(row.created_at) || new Date(0).toISOString(),
  }));
  const requests = ((requestsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    userId: asString(row.user_id),
    requestId: asString(row.request_id),
    action: asString(row.action),
    status: asString(row.status),
    errorCode: optionalString(row.error_code),
    credits: asNumber(row.credits),
    createdAt: isoOrNull(row.created_at) || new Date(0).toISOString(),
    completedAt: isoOrNull(row.completed_at),
  }));
  const transactions = ((transactionsResult.data ?? []) as Array<Record<string, unknown>>).map(
    (row) => ({
      id: asString(row.id),
      userId: asString(row.user_id),
      requestId: optionalString(row.request_id),
      kind: asString(row.kind),
      creditsDelta: asNumber(row.credits_delta),
      reason: transactionReason(row.metadata),
      createdAt: isoOrNull(row.created_at) || new Date(0).toISOString(),
    }),
  );
  const rejections = ((rejectionsResult.data ?? []) as Array<Record<string, unknown>>).map(
    (row) => ({
      userId: asString(row.user_id),
      requestId: asString(row.request_id),
      reason: asString(row.reason),
      createdAt: isoOrNull(row.created_at) || new Date(0).toISOString(),
    }),
  );

  for (const event of events) addEvent(users, event);
  for (const request of requests) addCreditRequest(users, request);
  for (const transaction of transactions) addTransaction(users, transaction);
  for (const rejection of rejections) addRejection(users, rejection);

  const limitations = [
    "Activity is based on recorded AI usage, credit requests, credit transactions and wallet use. It does not include general app browsing.",
    "Detection thresholds are basic operational estimates, not fraud findings. No alert automatically changes access or billing.",
    "Authentication monitoring is unavailable because the schema stores no sign-in, failed-login or lockout history.",
    "The dashboard evaluates up to 1,000 recent profiles and 5,000 usage records per request; totals are exact only while those caps are not reached.",
  ];

  return buildResult({
    source: "supabase",
    range,
    query,
    totalAccounts: profilesResult.count ?? users.size,
    users: [...users.values()],
    transactions,
    reviews,
    limitations,
  });
}

function loadLocalMonitoring(
  range: AnalyticsRange,
  query: AdminActivityMonitoringQuery,
): AdminActivityMonitoring {
  const credits = creditOverview();
  const usage = summariseUsage();
  const users = new Map<string, UserAccumulator>();

  for (const account of credits.accounts) {
    users.set(
      account.userId,
      createAccumulator({
        userId: account.userId,
        displayName: `User ${account.userShortId}`,
        plan: account.plan,
        planLabel: account.planLabel,
        subscriptionStatus: account.subscriptionStatus,
        accountCreatedAt: account.createdAt,
        balance: account.balance,
        lastWalletUseAt: account.lastUsedAt || null,
      }),
    );
  }

  for (const event of usage.recentRequests) {
    if (!inIsoRange(event.timestamp, range)) continue;
    addEvent(users, {
      userId: event.userId,
      requestId: event.requestId,
      action: event.action,
      model: event.model,
      status: event.status,
      credits: event.credits,
      costAud: event.costAud,
      createdAt: event.timestamp,
    });
  }

  const transactions = credits.history
    .filter(
      (entry) =>
        entry.createdAt >= range.from &&
        entry.createdAt < range.to &&
        entry.status === "succeeded",
    )
    .map((entry) => ({
      id: entry.id,
      userId: entry.userId,
      requestId: entry.requestId,
      kind: "settle",
      creditsDelta: -entry.credits,
      reason: entry.actionLabel,
      createdAt: entry.createdAt,
    }));

  for (const transaction of transactions) addTransaction(users, transaction);

  return buildResult({
    source: "local",
    range,
    query,
    totalAccounts: credits.accounts.length,
    users: [...users.values()],
    transactions,
    reviews: localReviews(),
    limitations: [
      "Local activity covers up to 100 credit accounts and the most recent 100 AI request records only; older local activity may not be available.",
      "Local credit-request error details, spend-rejection records and request concurrency are not stored, so those detectors may stay empty in local mode.",
      "Detection thresholds are basic operational estimates, not fraud findings. No alert automatically changes access or billing.",
      "Authentication monitoring is unavailable because no authentication-event history is stored.",
    ],
  });
}

export async function loadAdminActivityMonitoring(
  query: AdminActivityMonitoringQuery,
): Promise<AdminActivityMonitoring> {
  const range = resolveAnalyticsRange(query.preset, query.from, query.to);
  try {
    return await loadSupabaseMonitoring(range, query);
  } catch (error) {
    if (error instanceof MonitoringError) throw error;
    if (error instanceof SupabaseClientConfigError) {
      return loadLocalMonitoring(range, query);
    }
    throw new MonitoringError(
      "User activity and security monitoring could not be read.",
      503,
      "monitoring_unavailable",
    );
  }
}

/** Validate and normalise a review request without trusting client fields. */
export function normaliseAlertReview(input: unknown): {
  alertKey: string;
  status: MonitoringAlertStatus;
  note: string | null;
} {
  const body =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const alertKey = asString(body.alertKey).trim();
  if (!/^[a-z_]+:[a-zA-Z0-9:._-]{4,220}$/.test(alertKey)) {
    throw new MonitoringError("Choose a valid alert to review.", 400, "bad_alert_key");
  }
  const status: MonitoringAlertStatus = body.status === "open" ? "open" : "reviewed";
  const rawNote = typeof body.note === "string" ? body.note.trim() : "";
  if (rawNote.length > 1_000) {
    throw new MonitoringError(
      "Investigation notes must be 1,000 characters or fewer.",
      400,
      "note_too_long",
    );
  }
  return { alertKey, status, note: rawNote || null };
}
