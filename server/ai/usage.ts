/**
 * Spending and usage ledger.
 *
 * The app has no database and no user accounts on the server, so the only
 * server-side record is this small JSON file: counts and estimated cost per
 * day and month, globally, per provider, per model, per anonymous install and
 * per opaque user hash. It also keeps content-free health counters: failed
 * calls, rate-limit errors, fallbacks, latency totals and safety events.
 *
 * It holds no message content, no email, no display name and no id that can be
 * turned back into an account: the user key is a SHA-256 digest the server
 * receives from the browser and cannot reverse. It exists to enforce budgets
 * and show the operator how the system is behaving, not to profile anyone.
 */

import fs from "fs";
import path from "path";
import { BillingCurrency, ModelSpec, ProviderId, audPerCurrency } from "./config";

export interface UsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costAud: number;
  credits?: number;
  failedRequests?: number;
  /** Failed provider calls, including retries that later succeeded elsewhere. */
  failures?: number;
  /** Subset of failures caused by HTTP 429. */
  rateLimited?: number;
  /** Replies served after at least one provider failed. */
  fallbacks?: number;
  latencyTotalMs?: number;
  latencySamples?: number;
}

export interface UserLedger {
  day: string;
  month: string;
  today: UsageTotals;
  thisMonth: UsageTotals;
  allTime: UsageTotals;
}

/** One content-free request record. Never add prompts, replies or context here. */
export interface UsageRequest {
  requestId: string;
  userId: string;
  provider: string;
  model: string;
  action: string;
  plan: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  credits: number;
  costUsd: number;
  costAud: number;
  durationMs: number;
  status: "success" | "failed";
  timestamp: string;
  estimatedUsage: boolean;
}

export interface SafetyCounters {
  moderationEvents: number;
  blockedRequests: number;
  reportedResponses: number;
  errors: number;
  /** Flag name to count. Flag names are fixed identifiers, never message text. */
  byFlag: Record<string, number>;
}

export interface Ledger {
  day: string;
  month: string;
  today: UsageTotals;
  thisMonth: UsageTotals;
  /** Lifetime totals since this ledger was introduced. */
  allTime: UsageTotals;
  byModel: Record<string, UsageTotals>;
  byProvider: Record<string, UsageTotals>;
  /** All-time action and subscription-tier breakdowns. */
  byAction: Record<string, UsageTotals>;
  byPlan: Record<string, UsageTotals>;
  /** Anonymous per-install counters; capped so the file cannot grow forever. */
  byClient: Record<string, UsageTotals>;
  /** Per-user counters, keyed by a one-way hash. Capped for the same reason. */
  byUser: Record<string, UserLedger>;
  /** One row per calendar day, pruned after 35 days. */
  history: Record<string, UsageTotals>;
  /** One row per calendar month, pruned after 24 months. */
  monthlyHistory: Record<string, UsageTotals>;
  /** Content-free per-request records, capped for storage and privacy. */
  requestLog: UsageRequest[];
  safety: SafetyCounters;
  /** Replies served from the cache, which cost nothing. */
  cacheHits: number;
}

const MAX_CLIENTS = 500;
const MAX_USERS = 500;
const MAX_HISTORY_DAYS = 35;
const MAX_HISTORY_MONTHS = 24;
const MAX_REQUEST_LOG = 5_000;
const MAX_RECENT_REQUESTS = 100;

const emptyTotals = (): UsageTotals => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  costAud: 0,
  credits: 0,
  failedRequests: 0,
  failures: 0,
  rateLimited: 0,
  fallbacks: 0,
  latencyTotalMs: 0,
  latencySamples: 0,
});

const emptySafety = (): SafetyCounters => ({
  moderationEvents: 0,
  blockedRequests: 0,
  reportedResponses: 0,
  errors: 0,
  byFlag: {},
});

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

const DATA_DIR = path.join(process.cwd(), "data");
const LEDGER_FILE = path.join(DATA_DIR, "ai-usage.json");

const freshLedger = (): Ledger => ({
  day: today(),
  month: thisMonth(),
  today: emptyTotals(),
  thisMonth: emptyTotals(),
  allTime: emptyTotals(),
  byModel: {},
  byProvider: {},
  byAction: {},
  byPlan: {},
  byClient: {},
  byUser: {},
  history: {},
  monthlyHistory: {},
  requestLog: [],
  safety: emptySafety(),
  cacheHits: 0,
});

const normaliseTotals = (
  raw: Partial<UsageTotals> | undefined,
  currency: BillingCurrency = "USD",
): UsageTotals => {
  const totals = { ...emptyTotals(), ...(raw || {}) };
  // Older ledgers have USD only. Seed AUD from that value once, using the
  // configured USD rate, so introducing AUD does not hide existing spend.
  if (raw && typeof raw.costAud !== "number") {
    totals.costAud = Number(((Number(raw.costUsd) || 0) * audPerCurrency(currency)).toFixed(6));
  }
  return totals;
};

const normaliseTotalsMap = (
  raw: Record<string, UsageTotals> | undefined,
): Record<string, UsageTotals> =>
  Object.fromEntries(
    Object.entries(raw || {}).map(([key, totals]) => [key, normaliseTotals(totals)]),
  );

const normaliseUser = (entry: Partial<UserLedger> | undefined): UserLedger | null => {
  if (!entry) return null;
  const currentMonth = entry.month === thisMonth();
  return {
    day: today(),
    month: thisMonth(),
    today:
      currentMonth && entry.day === today() ? normaliseTotals(entry.today) : emptyTotals(),
    thisMonth: currentMonth ? normaliseTotals(entry.thisMonth) : emptyTotals(),
    allTime: normaliseTotals(entry.allTime || entry.thisMonth),
  };
};

const normaliseHistory = (raw: Record<string, UsageTotals> | undefined): Record<string, UsageTotals> => {
  const cutoff = new Date(Date.now() - MAX_HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const out: Record<string, UsageTotals> = {};
  for (const [date, totals] of Object.entries(raw || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < cutoff) continue;
    out[date] = normaliseTotals(totals);
  }
  return out;
};

const normaliseMonthHistory = (
  raw: Record<string, UsageTotals> | undefined,
): Record<string, UsageTotals> => {
  const cutoff = new Date(Date.now() - MAX_HISTORY_MONTHS * 31 * 86_400_000)
    .toISOString()
    .slice(0, 7);
  const out: Record<string, UsageTotals> = {};
  for (const [month, totals] of Object.entries(raw || {})) {
    if (!/^\d{4}-\d{2}$/.test(month) || month < cutoff) continue;
    out[month] = normaliseTotals(totals);
  }
  return out;
};

const safeText = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const safeNumber = (value: unknown, max = 1_000_000_000): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(max, Math.round(parsed));
};

const normaliseRequest = (raw: unknown): UsageRequest | null => {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<UsageRequest>;
  const requestId = safeText(source.requestId, 80);
  const userId = safeText(source.userId, 64);
  const provider = safeText(source.provider, 80);
  const model = safeText(source.model, 120);
  const action = safeText(source.action, 80);
  const plan = safeText(source.plan, 20);
  const timestamp = safeText(source.timestamp, 40);
  const status = source.status === "success" || source.status === "failed" ? source.status : null;
  if (!requestId || !userId || !provider || !model || !action || !plan || !timestamp || !status) {
    return null;
  }
  const inputTokens = safeNumber(source.inputTokens);
  const outputTokens = safeNumber(source.outputTokens);
  return {
    requestId,
    userId,
    provider,
    model,
    action,
    plan,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    credits: safeNumber(source.credits, 10_000),
    costUsd: Math.min(1_000_000, Math.max(0, Number(source.costUsd) || 0)),
    costAud: Math.min(
      1_000_000,
      Math.max(
        0,
        source.costAud === undefined
          ? (Number(source.costUsd) || 0) * audPerCurrency("USD")
          : Number(source.costAud) || 0,
      ),
    ),
    durationMs: safeNumber(source.durationMs, 86_400_000),
    status,
    timestamp,
    estimatedUsage: Boolean(source.estimatedUsage),
  };
};

const normaliseRequestLog = (raw: unknown): UsageRequest[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normaliseRequest)
    .filter((entry): entry is UsageRequest => Boolean(entry))
    .slice(0, MAX_REQUEST_LOG);
};

const normalise = (raw: Partial<Ledger> | null): Ledger => {
  const base = freshLedger();
  if (!raw) return base;
  const rollDay = raw.day !== base.day;
  const rollMonth = raw.month !== base.month;

  const byUser: Record<string, UserLedger> = {};
  for (const [key, entry] of Object.entries(raw.byUser || {})) {
    const cleaned = normaliseUser(entry);
    if (cleaned) byUser[key] = cleaned;
  }

  const monthlyHistory = normaliseMonthHistory(raw.monthlyHistory);
  if (rollMonth && raw.month && /^\d{4}-\d{2}$/.test(raw.month) && raw.thisMonth) {
    // Preserve the month that just ended before the monthly counters reset.
    monthlyHistory[raw.month] = normaliseTotals(raw.thisMonth);
  }
  const months = Object.keys(monthlyHistory).sort();
  while (months.length > MAX_HISTORY_MONTHS) {
    const oldest = months.shift();
    if (oldest) delete monthlyHistory[oldest];
  }

  return {
    day: base.day,
    month: base.month,
    today: rollDay ? emptyTotals() : normaliseTotals(raw.today),
    thisMonth: rollMonth ? emptyTotals() : normaliseTotals(raw.thisMonth),
    // Existing ledgers predate allTime; the current month is the best available
    // starting point, and every new request is added from here on.
    allTime: normaliseTotals(raw.allTime || raw.thisMonth),
    byModel: rollMonth ? {} : normaliseTotalsMap(raw.byModel),
    byProvider: rollMonth ? {} : normaliseTotalsMap(raw.byProvider),
    byAction: normaliseTotalsMap(raw.byAction),
    byPlan: normaliseTotalsMap(raw.byPlan),
    byClient: rollDay ? {} : normaliseTotalsMap(raw.byClient),
    byUser,
    history: normaliseHistory(raw.history),
    monthlyHistory,
    requestLog: normaliseRequestLog(raw.requestLog),
    safety: rollMonth ? emptySafety() : { ...emptySafety(), ...(raw.safety || {}) },
    cacheHits: rollMonth ? 0 : raw.cacheHits || 0,
  };
};

let cached: Ledger | null = null;

const readLedger = (): Ledger => {
  if (cached) {
    // Roll the counters over at midnight and on the first of the month. The
    // cached object is returned as-is so writes update what later reads see.
    if (cached.day !== today() || cached.month !== thisMonth()) {
      cached = normalise(cached);
      persist(cached);
    }
    return cached;
  }
  try {
    const raw = fs.readFileSync(LEDGER_FILE, "utf8");
    cached = normalise(JSON.parse(raw));
  } catch {
    cached = freshLedger();
  }
  return cached;
};

const persist = (ledger: Ledger) => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger));
  } catch {
    // A read-only filesystem must not break the assistant; the ledger then
    // simply lives in memory for the life of the process.
  }
};

export const estimateCost = (
  model: ModelSpec,
  inputTokens: number,
  outputTokens: number,
): number => {
  if (!model.price) return 0;
  return (
    (inputTokens / 1_000_000) * model.price.inputPerMillion +
    (outputTokens / 1_000_000) * model.price.outputPerMillion
  );
};

export const getUsage = (): Ledger => readLedger();

export const estimateCosts = (
  model: ModelSpec,
  inputTokens: number,
  outputTokens: number,
): { costBilling: number; costUsd: number; costAud: number } => {
  const costBilling = estimateCost(model, inputTokens, outputTokens);
  const costAud = costBilling * audPerCurrency(model.billingCurrency || "USD");
  const costUsd = costAud / audPerCurrency("USD");
  return { costBilling, costUsd, costAud };
};

const bump = (
  totals: UsageTotals,
  entry: { inputTokens: number; outputTokens: number },
  costUsd: number,
  costAud: number,
  credits = 0,
) => {
  totals.requests += 1;
  totals.inputTokens += entry.inputTokens;
  totals.outputTokens += entry.outputTokens;
  totals.costUsd = Number((totals.costUsd + costUsd).toFixed(6));
  totals.costAud = Number((totals.costAud + costAud).toFixed(6));
  totals.credits = Number(((totals.credits || 0) + credits).toFixed(6));
};

const addCredits = (totals: UsageTotals, credits: number) => {
  totals.credits = Number(((totals.credits || 0) + credits).toFixed(6));
};

const noteFailure = (totals: UsageTotals) => {
  totals.failedRequests = (totals.failedRequests || 0) + 1;
};

const noteLatency = (totals: UsageTotals, latencyMs?: number) => {
  if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs) || latencyMs < 0) return;
  totals.latencyTotalMs = (totals.latencyTotalMs || 0) + latencyMs;
  totals.latencySamples = (totals.latencySamples || 0) + 1;
};

const bumpHistory = (
  ledger: Ledger,
  entry: { inputTokens: number; outputTokens: number },
  costUsd: number,
  costAud: number,
) => {
  const key = today();
  ledger.history[key] = ledger.history[key] || emptyTotals();
  bump(ledger.history[key], entry, costUsd, costAud);
  noteLatency(ledger.history[key], undefined);
  const dates = Object.keys(ledger.history).sort();
  while (dates.length > MAX_HISTORY_DAYS) {
    const oldest = dates.shift();
    if (oldest) delete ledger.history[oldest];
  }

  const month = thisMonth();
  ledger.monthlyHistory[month] = ledger.monthlyHistory[month] || emptyTotals();
  bump(ledger.monthlyHistory[month], entry, costUsd, costAud);
  const months = Object.keys(ledger.monthlyHistory).sort();
  while (months.length > MAX_HISTORY_MONTHS) {
    const oldest = months.shift();
    if (oldest) delete ledger.monthlyHistory[oldest];
  }
};

export const recordUsage = (entry: {
  model: ModelSpec;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  costAud?: number;
  clientId?: string;
  userKey?: string;
  latencyMs?: number;
  fellBack?: boolean;
}): void => {
  const ledger = readLedger();
  const estimated = estimateCosts(entry.model, entry.inputTokens, entry.outputTokens);
  const costUsd = entry.costUsd ?? estimated.costUsd;
  const costAud =
    entry.costAud ?? (entry.costUsd === undefined ? estimated.costAud : costUsd * audPerCurrency("USD"));

  bump(ledger.today, entry, costUsd, costAud);
  bump(ledger.thisMonth, entry, costUsd, costAud);
  bumpHistory(ledger, entry, costUsd, costAud);

  const modelKey = `${entry.model.provider}:${entry.model.id}`;
  ledger.byModel[modelKey] = ledger.byModel[modelKey] || emptyTotals();
  bump(ledger.byModel[modelKey], entry, costUsd, costAud);

  const providerKey = entry.model.provider;
  ledger.byProvider[providerKey] = ledger.byProvider[providerKey] || emptyTotals();
  bump(ledger.byProvider[providerKey], entry, costUsd, costAud);

  // Latency and fallback counts are monthly, matching the rest of byProvider.
  for (const totals of [
    ledger.today,
    ledger.thisMonth,
    ledger.byModel[modelKey],
    ledger.byProvider[providerKey],
  ]) {
    noteLatency(totals, entry.latencyMs);
    if (entry.fellBack) totals.fallbacks = (totals.fallbacks || 0) + 1;
  }

  if (entry.clientId) {
    if (!ledger.byClient[entry.clientId] && Object.keys(ledger.byClient).length >= MAX_CLIENTS) {
      const oldest = Object.keys(ledger.byClient)[0];
      if (oldest) delete ledger.byClient[oldest];
    }
    ledger.byClient[entry.clientId] = ledger.byClient[entry.clientId] || emptyTotals();
    bump(ledger.byClient[entry.clientId], entry, costUsd, costAud);
  }

  if (entry.userKey) {
    if (!ledger.byUser[entry.userKey] && Object.keys(ledger.byUser).length >= MAX_USERS) {
      const oldest = Object.keys(ledger.byUser)[0];
      if (oldest) delete ledger.byUser[oldest];
    }
    const user = ledger.byUser[entry.userKey] || {
      day: today(),
      month: thisMonth(),
      today: emptyTotals(),
      thisMonth: emptyTotals(),
      allTime: emptyTotals(),
    };
    bump(user.today, entry, costUsd, costAud);
    bump(user.thisMonth, entry, costUsd, costAud);
    // The per-request log adds allTime below, so cached and safety-refused
    // requests are represented once as well.
    ledger.byUser[entry.userKey] = user;
  }

  persist(ledger);
};

/**
 * Record the final outcome of one validated AI request. This is the single
 * per-request log: recordUsage above owns provider token/cost aggregates, and
 * this function adds credits, action, plan and success/failure without
 * duplicating those aggregates. It deliberately has no prompt or reply field.
 */
export const recordRequest = (entry: {
  requestId: string;
  userId: string;
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
  status: "success" | "failed";
  timestamp?: string;
  estimatedUsage?: boolean;
}): void => {
  const ledger = readLedger();
  const timestamp = entry.timestamp || new Date().toISOString();
  const clean = normaliseRequest({ ...entry, timestamp });
  if (!clean) return;

  ledger.requestLog.unshift(clean);
  ledger.requestLog = ledger.requestLog.slice(0, MAX_REQUEST_LOG);

  const tokens = { inputTokens: clean.inputTokens, outputTokens: clean.outputTokens };
  const success = clean.status === "success";

  bump(ledger.allTime, tokens, clean.costUsd, clean.costAud, clean.credits);
  const action = (ledger.byAction[clean.action] = ledger.byAction[clean.action] || emptyTotals());
  bump(action, tokens, clean.costUsd, clean.costAud, clean.credits);
  const plan = (ledger.byPlan[clean.plan] = ledger.byPlan[clean.plan] || emptyTotals());
  bump(plan, tokens, clean.costUsd, clean.costAud, clean.credits);
  if (!success) {
    noteFailure(ledger.allTime);
    noteFailure(action);
    noteFailure(plan);
  }

  // Token and request aggregates were already counted by recordUsage for a
  // successful provider reply. Only credits and failures are new here.
  addCredits(ledger.today, clean.credits);
  addCredits(ledger.thisMonth, clean.credits);
  const day = (ledger.history[today()] = ledger.history[today()] || emptyTotals());
  const month = (ledger.monthlyHistory[thisMonth()] =
    ledger.monthlyHistory[thisMonth()] || emptyTotals());
  addCredits(day, clean.credits);
  addCredits(month, clean.credits);
  if (!success) {
    noteFailure(ledger.today);
    noteFailure(ledger.thisMonth);
    noteFailure(day);
    noteFailure(month);
  }

  const modelKey = `${clean.provider}:${clean.model}`;
  const model = (ledger.byModel[modelKey] = ledger.byModel[modelKey] || emptyTotals());
  const provider = (ledger.byProvider[clean.provider] = ledger.byProvider[clean.provider] || emptyTotals());
  addCredits(model, clean.credits);
  addCredits(provider, clean.credits);

  if (clean.userId) {
    const user = (ledger.byUser[clean.userId] = ledger.byUser[clean.userId] || {
      day: today(),
      month: thisMonth(),
      today: emptyTotals(),
      thisMonth: emptyTotals(),
      allTime: emptyTotals(),
    });
    addCredits(user.today, clean.credits);
    addCredits(user.thisMonth, clean.credits);
    bump(user.allTime, tokens, clean.costUsd, clean.costAud, clean.credits);
    if (!success) {
      noteFailure(user.today);
      noteFailure(user.thisMonth);
      noteFailure(user.allTime);
    }
  }

  persist(ledger);
};

/**
 * A provider attempt that did not produce a reply. Recorded per provider and
 * model so the dashboard can separate a broken key from a busy provider.
 */
export const recordFailure = (entry: {
  provider: ProviderId;
  model?: string;
  /** True when the provider answered 429. */
  rateLimited?: boolean;
}): void => {
  const ledger = readLedger();
  const targets = [
    ledger.today,
    ledger.thisMonth,
    (ledger.byProvider[entry.provider] =
      ledger.byProvider[entry.provider] || emptyTotals()),
    ...(entry.model
      ? [
          (ledger.byModel[`${entry.provider}:${entry.model}`] =
            ledger.byModel[`${entry.provider}:${entry.model}`] || emptyTotals()),
        ]
      : []),
  ];

  for (const totals of targets) {
    totals.failures = (totals.failures || 0) + 1;
    if (entry.rateLimited) totals.rateLimited = (totals.rateLimited || 0) + 1;
  }

  const day = ledger.history[today()] || (ledger.history[today()] = emptyTotals());
  day.failures = (day.failures || 0) + 1;
  if (entry.rateLimited) day.rateLimited = (day.rateLimited || 0) + 1;

  persist(ledger);
};

/** Content-free safety counters. Flags are identifiers such as "self-harm". */
export const recordSafety = (
  kind: "moderation" | "blocked" | "reported" | "error",
  flag?: string,
): void => {
  const ledger = readLedger();
  if (kind === "moderation") ledger.safety.moderationEvents += 1;
  if (kind === "blocked") ledger.safety.blockedRequests += 1;
  if (kind === "reported") ledger.safety.reportedResponses += 1;
  if (kind === "error") ledger.safety.errors += 1;
  if (flag && /^[a-z0-9-]{1,40}$/i.test(flag)) {
    ledger.safety.byFlag[flag] = (ledger.safety.byFlag[flag] || 0) + 1;
    const keys = Object.keys(ledger.safety.byFlag);
    if (keys.length > 40) {
      const first = keys[0];
      if (first) delete ledger.safety.byFlag[first];
    }
  }
  persist(ledger);
};

export const recordCacheHit = (): void => {
  const ledger = readLedger();
  ledger.cacheHits += 1;
  persist(ledger);
};

export interface LimitVerdict {
  allowed: boolean;
  reason?: string;
  scope?: "global" | "provider" | "client" | "user";
  retryAfterSeconds?: number;
}

export interface SpendLimits {
  requestsPerDay: number;
  tokensPerDay: number;
  dailyLimitAud?: number;
  monthlyHardLimitAud?: number;
  monthlyBudgetAud?: number;
  /** Legacy USD fields are accepted so older callers keep their old ceilings. */
  costPerDayUsd?: number;
  costPerMonthUsd?: number;
}

/**
 * Spend committed by requests that are already in flight. Reservations are
 * process-local and short-lived; the persistent ledger remains the source of
 * truth once a provider reports usage. Reserving the worst-case cost of each
 * in-flight request prevents a burst of concurrent requests from all passing
 * the same pre-flight check and blowing through the hard limit together.
 */
let pendingSpendAud = 0;
let reservationSequence = 0;
const pendingReservations = new Map<number, number>();

const spendLimits = (limits: SpendLimits) => {
  const usdRate = audPerCurrency("USD");
  return {
    daily:
      limits.dailyLimitAud ??
      (typeof limits.costPerDayUsd === "number"
        ? limits.costPerDayUsd * usdRate
        : Number.POSITIVE_INFINITY),
    monthly:
      limits.monthlyHardLimitAud ??
      (typeof limits.costPerMonthUsd === "number"
        ? limits.costPerMonthUsd * usdRate
        : Number.POSITIVE_INFINITY),
  };
};

export const checkLimits = (limits: SpendLimits): LimitVerdict => {
  const ledger = readLedger();
  const { daily, monthly } = spendLimits(limits);
  if (ledger.today.requests >= limits.requestsPerDay) {
    return { allowed: false, reason: "daily-requests", scope: "global" };
  }
  if (ledger.today.inputTokens + ledger.today.outputTokens >= limits.tokensPerDay) {
    return { allowed: false, reason: "daily-tokens", scope: "global" };
  }
  if (ledger.today.costAud + pendingSpendAud >= daily) {
    return { allowed: false, reason: "daily-budget", scope: "global", retryAfterSeconds: 3_600 };
  }
  if (ledger.thisMonth.costAud + pendingSpendAud >= monthly) {
    return { allowed: false, reason: "monthly-budget", scope: "global" };
  }
  return { allowed: true };
};

/**
 * Reserve the maximum additional AUD one request could spend before calling a
 * provider. The service releases the reservation in a finally block, including
 * when a stream closes early. A rejected reservation never leaves a balance
 * behind, so a failed request cannot strand budget.
 */
export const reserveSpend = (
  maxCostAud: number,
  limits: Pick<SpendLimits, "dailyLimitAud" | "monthlyHardLimitAud">,
): LimitVerdict & { reservedAud: number; release: () => void } => {
  const ledger = readLedger();
  const { daily, monthly } = spendLimits({ ...limits, requestsPerDay: 1, tokensPerDay: 1 });
  const amount = Math.max(0, Number.isFinite(maxCostAud) ? maxCostAud : 0);
  const noop = { reservedAud: 0, release: () => undefined };

  if (ledger.today.costAud + pendingSpendAud >= daily) {
    return { allowed: false, reason: "daily-budget", scope: "global", retryAfterSeconds: 3_600, ...noop };
  }
  if (ledger.thisMonth.costAud + pendingSpendAud >= monthly) {
    return { allowed: false, reason: "monthly-budget", scope: "global", ...noop };
  }
  if (ledger.today.costAud + pendingSpendAud + amount >= daily) {
    return { allowed: false, reason: "daily-budget", scope: "global", retryAfterSeconds: 3_600, ...noop };
  }
  if (ledger.thisMonth.costAud + pendingSpendAud + amount >= monthly) {
    return { allowed: false, reason: "monthly-budget", scope: "global", ...noop };
  }

  const id = ++reservationSequence;
  pendingSpendAud = Number((pendingSpendAud + amount).toFixed(6));
  pendingReservations.set(id, amount);
  let released = false;
  return {
    allowed: true,
    reservedAud: amount,
    release: () => {
      if (released) return;
      released = true;
      pendingReservations.delete(id);
      pendingSpendAud = Math.max(0, Number((pendingSpendAud - amount).toFixed(6)));
      // Keep the id in the expression so a future multi-reservation refactor
      // has an explicit handle without changing the public return shape.
      void id;
    },
  };
};

/** Outstanding in-process reservations, used by the spending overview. */
export const pendingSpend = (): { reservedAud: number; count: number } => ({
  reservedAud: Number(pendingSpendAud.toFixed(6)),
  count: pendingReservations.size,
});

/** Check a model's own ceiling against actual recorded spend. */
export const checkModelLimit = (
  modelRef: string,
  limits: { dailyAud?: number; monthlyAud?: number },
): LimitVerdict => {
  if (!limits.dailyAud && !limits.monthlyAud) return { allowed: true };
  const ledger = readLedger();
  const modelId = modelRef.includes(":") ? modelRef.slice(modelRef.indexOf(":") + 1) : modelRef;
  const day = today();
  const month = thisMonth();
  const rows = ledger.requestLog.filter(
    (entry) =>
      entry.model === modelId &&
      entry.status === "success" &&
      entry.timestamp.slice(0, 7) === month,
  );
  const dayCost = rows
    .filter((entry) => entry.timestamp.slice(0, 10) === day)
    .reduce((sum, entry) => sum + entry.costAud, 0);
  const monthCost = rows.reduce((sum, entry) => sum + entry.costAud, 0);
  if (typeof limits.monthlyAud === "number" && limits.monthlyAud > 0 && monthCost >= limits.monthlyAud) {
    return { allowed: false, reason: "model-monthly-budget", scope: "provider" };
  }
  if (typeof limits.dailyAud === "number" && limits.dailyAud > 0 && dayCost >= limits.dailyAud) {
    return { allowed: false, reason: "model-daily-budget", scope: "provider", retryAfterSeconds: 3_600 };
  }
  return { allowed: true };
};

/** A single provider's own daily ceiling, separate from the global one. */
export const checkProviderLimit = (
  provider: ProviderId,
  requestsPerDay: number,
): LimitVerdict => {
  const ledger = readLedger();
  const used = ledger.byProvider[provider]?.requests ?? 0;
  if (used >= requestsPerDay) {
    return { allowed: false, reason: `provider-daily-${provider}`, scope: "provider" };
  }
  return { allowed: true };
};

export const checkClientLimit = (clientId: string, requestsPerDay: number): LimitVerdict => {
  const ledger = readLedger();
  const used = ledger.byClient[clientId]?.requests ?? 0;
  if (used >= requestsPerDay) {
    return { allowed: false, reason: "client-daily", scope: "client", retryAfterSeconds: 3_600 };
  }
  return { allowed: true };
};

/**
 * Per-user ceilings. The key is a hash the server cannot reverse, so this
 * enforces fairness without creating a server-side identity for anyone.
 */
export const checkUserLimits = (
  userKey: string,
  limits: {
    requestsPerDay: number;
    tokensPerDay: number;
    costPerMonthUsd: number;
    dailyLimitAud?: number;
    monthlyLimitAud?: number;
  },
): LimitVerdict => {
  const entry = readLedger().byUser[userKey];
  if (!entry) return { allowed: true };
  if (entry.today.requests >= limits.requestsPerDay) {
    return { allowed: false, reason: "user-daily-requests", scope: "user", retryAfterSeconds: 3_600 };
  }
  if (entry.today.inputTokens + entry.today.outputTokens >= limits.tokensPerDay) {
    return { allowed: false, reason: "user-daily-tokens", scope: "user", retryAfterSeconds: 3_600 };
  }
  if (
    typeof limits.monthlyLimitAud === "number" &&
    limits.monthlyLimitAud > 0 &&
    entry.thisMonth.costAud >= limits.monthlyLimitAud
  ) {
    return { allowed: false, reason: "user-monthly-budget", scope: "user" };
  }
  if (
    typeof limits.dailyLimitAud === "number" &&
    limits.dailyLimitAud > 0 &&
    entry.today.costAud >= limits.dailyLimitAud
  ) {
    return { allowed: false, reason: "user-daily-budget", scope: "user", retryAfterSeconds: 3_600 };
  }
  if (entry.thisMonth.costUsd >= limits.costPerMonthUsd) {
    return { allowed: false, reason: "user-monthly-budget", scope: "user" };
  }
  return { allowed: true };
};

const round = (totals: UsageTotals): UsageTotals => ({
  ...totals,
  costUsd: Number((totals.costUsd || 0).toFixed(4)),
  costAud: Number((totals.costAud || 0).toFixed(4)),
});

const averageLatency = (totals: UsageTotals): number => {
  const samples = totals.latencySamples || 0;
  if (!samples) return 0;
  return Math.round((totals.latencyTotalMs || 0) / samples);
};

const performanceOf = (totals: UsageTotals) => ({
  requests: totals.requests,
  failures: totals.failures || 0,
  rateLimited: totals.rateLimited || 0,
  fallbacks: totals.fallbacks || 0,
  avgLatencyMs: averageLatency(totals),
  errorRate:
    totals.requests + (totals.failures || 0) > 0
      ? Number(
          ((totals.failures || 0) / (totals.requests + (totals.failures || 0))).toFixed(4),
        )
      : 0,
});

export const summariseUsage = () => {
  const ledger = readLedger();
  const history = Object.entries(ledger.history)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, totals]) => ({
      date,
      ...round(totals),
      avgLatencyMs: averageLatency(totals),
    }));
  const monthTotals = round(ledger.thisMonth);
  const monthlyHistory = Object.entries({ ...ledger.monthlyHistory, [ledger.month]: ledger.thisMonth })
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, totals]) => ({ month, ...round(totals) }));
  const allTime = round(ledger.allTime);
  const byUser = Object.fromEntries(
    Object.entries(ledger.byUser).map(([key, entry]) => [
      key,
      {
        today: round(entry.today),
        thisMonth: round(entry.thisMonth),
        allTime: round(entry.allTime),
      },
    ]),
  );
  const trackedUsers = Object.keys(byUser).length;

  return {
    day: ledger.day,
    month: ledger.month,
    today: round(ledger.today),
    thisMonth: monthTotals,
    allTime,
    byModel: Object.fromEntries(Object.entries(ledger.byModel).map(([key, totals]) => [key, round(totals)])),
    byProvider: Object.fromEntries(
      Object.entries(ledger.byProvider).map(([key, totals]) => [key, round(totals)]),
    ),
    byAction: Object.fromEntries(Object.entries(ledger.byAction).map(([key, totals]) => [key, round(totals)])),
    byPlan: Object.fromEntries(Object.entries(ledger.byPlan).map(([key, totals]) => [key, round(totals)])),
    byUser,
    history,
    monthlyHistory,
    recentRequests: ledger.requestLog.slice(0, MAX_RECENT_REQUESTS),
    totals: {
      requests: allTime.requests,
      credits: allTime.credits || 0,
      costUsd: allTime.costUsd,
      costAud: allTime.costAud,
      failedRequests: allTime.failedRequests || 0,
      // Keep the original USD averages for older dashboards, and expose AUD
      // explicitly for the budget view.
      averageCostPerRequest:
        allTime.requests > 0 ? Number((allTime.costUsd / allTime.requests).toFixed(6)) : 0,
      averageCostPerUser:
        trackedUsers > 0 ? Number((allTime.costUsd / trackedUsers).toFixed(6)) : 0,
      averageCostPerRequestAud:
        allTime.requests > 0 ? Number((allTime.costAud / allTime.requests).toFixed(6)) : 0,
      averageCostPerUserAud:
        trackedUsers > 0 ? Number((allTime.costAud / trackedUsers).toFixed(6)) : 0,
      trackedUsers,
    },
    safety: {
      ...ledger.safety,
      byFlag: { ...ledger.safety.byFlag },
    },
    performance: performanceOf(ledger.thisMonth),
    providerPerformance: Object.fromEntries(
      Object.entries(ledger.byProvider).map(([key, totals]) => [
        key,
        performanceOf(totals),
      ]),
    ),
    cacheHits: ledger.cacheHits,
    trackedUsers,
  };
};

/** Individual-user detail for the admin dashboard, without any content. */
export const userUsageDetail = (userKey: string, limit = 100) => {
  const ledger = readLedger();
  const entry = ledger.byUser[userKey];
  const requests = ledger.requestLog
    .filter((request) => request.userId === userKey)
    .slice(0, Math.max(1, Math.min(limit, 500)));
  return {
    userId: userKey,
    today: round(entry?.today || emptyTotals()),
    thisMonth: round(entry?.thisMonth || emptyTotals()),
    allTime: round(entry?.allTime || emptyTotals()),
    requests,
  };
};

/** The client's own counters, used by the status route. */
export const clientUsage = (clientId: string): UsageTotals | null => {
  const totals = readLedger().byClient[clientId];
  return totals ? round(totals) : null;
};

/** The caller's own counters, so Settings can show honest per-person usage. */
export const userUsage = (userKey: string): UserLedger | null => {
  const entry = readLedger().byUser[userKey];
  if (!entry) return null;
  return {
    ...entry,
    today: round(entry.today),
    thisMonth: round(entry.thisMonth),
    allTime: round(entry.allTime),
  };
};

/** Test helper: forget the in-memory ledger so the file is re-read. */
export const resetLedgerCache = () => {
  cached = null;
  pendingSpendAud = 0;
  reservationSequence = 0;
  pendingReservations.clear();
};
