/**
 * Browser side of the AI management dashboard.
 *
 * The administrator access token (a Supabase access token or the temporary
 * break-glass token) is typed by the operator, held in sessionStorage for this
 * tab only, and sent as a bearer header. It is never written to the account
 * vault, localStorage or a log, and the server never returns it.
 */

const TOKEN_KEY = 'serene.admin.token.v1';

export const readAdminToken = (): string => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

export const saveAdminToken = (token: string): void => {
  try {
    sessionStorage.setItem(TOKEN_KEY, token.trim());
  } catch {
    // A blocked sessionStorage only means the token must be typed each visit.
  }
};

export const clearAdminToken = (): void => {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clear.
  }
};

export class AdminRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AdminRequestError';
  }
}

export interface AdminPrice {
  inputPerMillion: number;
  outputPerMillion: number;
  source: string;
}

export interface AdminModel {
  id: string;
  label: string;
  enabled: boolean;
  disabledBy: 'environment' | 'admin' | null;
  price: AdminPrice | null;
  capabilities: { streaming: boolean; tools: boolean; structuredOutputs: boolean };
}

export interface AdminProvider {
  id: 'freebuff' | 'openai' | 'huggingface';
  label: string;
  keyPresent: boolean;
  configured: boolean;
  enabled: boolean;
  disabledReason?: string;
  baseUrl: string;
  pinnedProvider?: string;
  limits: { requestsPerDay: number; maxOutputTokens: number };
  isPrimary: boolean;
  isBackup: boolean;
  models: AdminModel[];
}

export interface AdminTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  /** Provider-billing-currency cost kept for historical compatibility. */
  costUsd: number;
  /** Server-converted AUD cost used by the budget controls. */
  costAud: number;
  credits?: number;
  failedRequests?: number;
  failures?: number;
  rateLimited?: number;
  fallbacks?: number;
  latencyTotalMs?: number;
  latencySamples?: number;
}

export interface AdminUsageRequest {
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
  status: 'success' | 'failed';
  timestamp: string;
  estimatedUsage: boolean;
}

export interface AdminUserUsage {
  usage: {
    userId: string;
    today: AdminTotals;
    thisMonth: AdminTotals;
    allTime: AdminTotals;
    requests: AdminUsageRequest[];
  };
  account: AdminCreditAccount | null;
}

export interface AdminHistoryRow extends AdminTotals {
  date: string;
  avgLatencyMs: number;
}

export interface AdminPerformance {
  requests: number;
  failures: number;
  rateLimited: number;
  fallbacks: number;
  avgLatencyMs: number;
  errorRate: number;
}

export interface AdminTestResult {
  at: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
  modelsAvailable?: number;
  configuredModels?: { id: string; available: boolean }[];
}

export interface AdminLimits {
  requestsPerDay: number;
  tokensPerDay: number;
  /** Monthly warning target in AUD. */
  monthlyBudgetAud: number;
  /** Monthly hard ceiling in AUD; requests stop at this amount. */
  monthlyHardLimitAud: number;
  /** Daily spending ceiling in AUD. */
  dailyLimitAud: number;
  /** Legacy USD mirrors retained for older API consumers. */
  costPerDayUsd: number;
  costPerMonthUsd: number;
  requestsPerMinutePerClient: number;
  requestsPerDayPerClient: number;
  requestsPerDayPerUser: number;
  tokensPerDayPerUser: number;
  /** Per-person ceiling is still enforced in USD by the AI service. */
  costPerMonthPerUserUsd: number;
  /** Per-person AUD ceilings enforced before provider calls. */
  perUserDailyLimitAud: number;
  perUserMonthlyLimitAud: number;
}

export interface AdminModelLimit {
  dailyAud?: number;
  monthlyAud?: number;
}

export interface AdminBudgetAlert {
  code: string;
  level: 'warning' | 'critical' | 'info';
  message: string;
}

export interface AdminBudget {
  currency: 'AUD';
  monthlyBudgetAud: number;
  monthlyHardLimitAud: number;
  dailyLimitAud: number;
  currentMonthAud: number;
  currentDayAud: number;
  remainingBudgetAud: number;
  remainingHardLimitAud: number;
  percentageUsed: number;
  hardLimitPercentage: number;
  monthlyHistory: Array<AdminTotals & { month: string }>;
  alerts: AdminBudgetAlert[];
}

export interface AdminOverview {
  generatedAt: string;
  enabled: boolean;
  defaultModel: string | null;
  backupModel: string | null;
  fallbackModels: string[];
  featureModels: Record<string, string | null>;
  disabledModels: string[];
  restore: { available: boolean; count: number; previousAt: string | null };
  order: string[];
  limits: AdminLimits;
  warningThresholds: number[];
  modelLimits: Record<string, AdminModelLimit>;
  emergency: {
    paused: boolean;
    reason: string | null;
    at: string | null;
    by: string | null;
  };
  currency: {
    code: 'AUD';
    rates: Record<'AUD' | 'USD' | 'EUR' | 'GBP', number>;
  };
  budget: AdminBudget;
  cache: { enabled: boolean; ttlSeconds: number; maxEntries: number };
  overrides: {
    providers?: Record<string, boolean>;
    defaultModel?: string | null;
    backupModel?: string | null;
    fallbackModels?: string[];
    featureModels?: Record<string, string | null>;
    disabledModels?: string[];
    limits?: Partial<AdminLimits>;
    providerLimits?: Record<string, number>;
    warningThresholds?: number[] | null;
    modelLimits?: Record<string, AdminModelLimit>;
    emergencyPaused?: boolean | null;
    updatedAt?: string;
  };
  providers: AdminProvider[];
  usage: {
    day: string;
    month: string;
    today: AdminTotals;
    thisMonth: AdminTotals;
    allTime: AdminTotals;
    byModel: Record<string, AdminTotals>;
    byProvider: Record<string, AdminTotals>;
    byAction: Record<string, AdminTotals>;
    byPlan: Record<string, AdminTotals>;
    byUser: Record<string, { today: AdminTotals; thisMonth: AdminTotals; allTime: AdminTotals }>;
    recentRequests: AdminUsageRequest[];
    totals: {
      requests: number;
      credits: number;
      costUsd: number;
      costAud: number;
      failedRequests: number;
      /** Historical USD averages retained for older consumers. */
      averageCostPerRequest: number;
      averageCostPerUser: number;
      averageCostPerRequestAud: number;
      averageCostPerUserAud: number;
      trackedUsers: number;
    };
    history: AdminHistoryRow[];
    safety: {
      moderationEvents: number;
      blockedRequests: number;
      reportedResponses: number;
      errors: number;
      byFlag: Record<string, number>;
    };
    performance: AdminPerformance;
    providerPerformance: Record<string, AdminPerformance>;
    cacheHits: number;
    trackedUsers: number;
  };
  tests: Record<string, AdminTestResult>;
}

/** Aggregates from the server-only Supabase overview RPC. */
export interface AdminSupabaseOverview {
  generatedAt: string;
  source: 'supabase';
  currency: 'AUD';
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

export type AdminAnalyticsPreset = 'today' | 'last7' | 'last30' | 'month' | 'custom';

export interface AdminAnalyticsQuery {
  preset: AdminAnalyticsPreset;
  from?: string;
  to?: string;
  provider?: string;
  model?: string;
  action?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AdminAnalyticsRange {
  preset: AdminAnalyticsPreset;
  from: string;
  to: string;
  timezone: 'UTC';
}

export interface AdminAnalyticsSummary {
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

export interface AdminAnalyticsTimeseriesPoint {
  day: string;
  requests: number;
  successful: number;
  failed: number;
  credits: number;
  actualCostAud: number;
  estimatedCostAud: number;
  costAud: number;
}

export interface AdminAnalyticsBreakdownRow {
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

export interface AdminAnalyticsUserRow {
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

export interface AdminAnalyticsHistoryRow {
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
  status: 'success' | 'failed';
  estimated: boolean;
  createdAt: string;
}

export interface AdminAiAnalytics {
  generatedAt: string;
  range: AdminAnalyticsRange;
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
  summary: AdminAnalyticsSummary;
  timeseries: AdminAnalyticsTimeseriesPoint[];
  byProvider: AdminAnalyticsBreakdownRow[];
  byModel: AdminAnalyticsBreakdownRow[];
  byAction: AdminAnalyticsBreakdownRow[];
  byUser: AdminAnalyticsUserRow[];
  historyTotal: number;
  history: AdminAnalyticsHistoryRow[];
}

export interface AdminCreditAction {
  key: string;
  label: string;
  description: string;
  cost: number;
}

export interface AdminCreditPlan {
  id: 'free' | 'plus';
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

export interface AdminCreditAccount {
  userId: string;
  userShortId: string;
  plan: 'free' | 'plus';
  planLabel: string;
  subscriptionStatus: 'active' | 'past_due' | 'canceled' | 'expired' | 'refunded';
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

export interface AdminCreditHistory {
  id: string;
  userId: string;
  userShortId: string;
  action: string;
  actionLabel: string;
  credits: number;
  createdAt: string;
  completedAt?: string;
  status: 'pending' | 'succeeded' | 'failed';
  requestId: string;
  plan: 'free' | 'plus';
}

export interface AdminCreditsOverview {
  config: {
    actions: AdminCreditAction[];
    plans: AdminCreditPlan[];
    updatedAt: string;
  };
  accounts: AdminCreditAccount[];
  history: AdminCreditHistory[];
}

export interface AdminManagedCreditAction {
  key: string;
  label: string;
  description: string;
  cost: number;
}

export interface AdminManagedCreditPlan {
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

export interface AdminManagedCreditConfig {
  actions: AdminManagedCreditAction[];
  plans: AdminManagedCreditPlan[];
  updatedAt: string;
}

export interface AdminManagedCreditUser {
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

export interface AdminManagedCreditTransaction {
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

export interface AdminManagedCreditsOverview {
  generatedAt: string;
  source: 'supabase';
  config: AdminManagedCreditConfig;
  summary: {
    wallets: number;
    heldCredits: number;
    allocatedCredits: number;
    totalSpentCredits: number;
  };
  total: number;
  users: AdminManagedCreditUser[];
}

export interface AdminManagedCreditUserDetail {
  generatedAt: string;
  user: AdminManagedCreditUser;
  transactions: AdminManagedCreditTransaction[];
}

export interface AdminManagedCreditAdjustment {
  balance: number;
  balanceBefore: number;
  balanceAfter: number;
  duplicate: boolean;
  transactionId: string;
}

export interface AdminCreditSettingsBody {
  actions?: Record<string, number>;
  plans?: Record<
    string,
    {
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
  >;
}

export interface AdminSettingsBody {
  providers?: Record<string, boolean>;
  defaultModel?: string | null;
  backupModel?: string | null;
  fallbackModels?: string[];
  featureModels?: Record<string, string | null>;
  disabledModels?: string[];
  limits?: Partial<
    Pick<
      AdminLimits,
      | 'requestsPerDay'
      | 'tokensPerDay'
      | 'monthlyBudgetAud'
      | 'monthlyHardLimitAud'
      | 'dailyLimitAud'
      | 'requestsPerDayPerUser'
      | 'tokensPerDayPerUser'
      | 'costPerMonthPerUserUsd'
    >
  >;
  providerLimits?: Record<string, number>;
}

const request = async <T>(path: string, token: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api/ai/admin${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new AdminRequestError(
      typeof body?.error === 'string' ? body.error : 'The dashboard could not be loaded.',
      typeof body?.code === 'string' ? body.code : 'unknown',
      response.status,
    );
  }
  return body as T;
};

export const loadAdminOverview = (token: string): Promise<AdminOverview> =>
  request<AdminOverview>('/overview', token);

export type AdminMonitoringSeverity = 'high' | 'medium' | 'low';
export type AdminMonitoringAlertStatus = 'open' | 'reviewed';
export type AdminMonitoringRuleKind = 'threshold' | 'estimate' | 'unavailable';

export interface AdminActivityMonitoringQuery {
  preset: AdminAnalyticsPreset;
  from?: string;
  to?: string;
  search?: string;
  severity?: AdminMonitoringSeverity | '';
  alertStatus?: AdminMonitoringAlertStatus | '';
  limit?: number;
  offset?: number;
}

export interface AdminActivityRequestRef {
  requestId: string;
  action: string;
  status: string;
  model?: string;
  createdAt: string;
}

export interface AdminActivityTransaction {
  id: string;
  userId: string;
  userShortId: string;
  kind: string;
  creditsDelta: number;
  reason: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface AdminActivityAlert {
  key: string;
  rule: string;
  ruleLabel: string;
  severity: AdminMonitoringSeverity;
  kind: AdminMonitoringRuleKind;
  message: string;
  evidence: string;
  userId: string;
  userShortId: string;
  displayName: string;
  plan: string;
  status: AdminMonitoringAlertStatus;
  reviewedAt: string | null;
  reviewedBy: string | null;
  note: string | null;
  relatedRequests: AdminActivityRequestRef[];
  detectedAt: string;
}

export interface AdminActivityUser {
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
  recentTransactions: AdminActivityTransaction[];
  alerts: number;
  highestSeverity: AdminMonitoringSeverity | null;
}

export interface AdminActivityMonitoring {
  generatedAt: string;
  source: 'supabase' | 'local';
  range: AdminAnalyticsRange;
  filters: {
    search: string | null;
    severity: AdminMonitoringSeverity | null;
    alertStatus: AdminMonitoringAlertStatus | null;
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
  users: AdminActivityUser[];
  totalUsers: number;
  alerts: AdminActivityAlert[];
  recentTransactions: AdminActivityTransaction[];
  rules: Array<{
    key: string;
    label: string;
    severity: AdminMonitoringSeverity;
    kind: AdminMonitoringRuleKind;
    available: boolean;
    description: string;
    threshold: string;
  }>;
  limitations: string[];
}

export const loadAdminActivityMonitoring = (
  token: string,
  query: AdminActivityMonitoringQuery,
): Promise<AdminActivityMonitoring> => {
  const params = new URLSearchParams();
  params.set('preset', query.preset);
  for (const key of ['from', 'to', 'search', 'severity', 'alertStatus'] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  if (query.limit) params.set('limit', String(query.limit));
  if (query.offset) params.set('offset', String(query.offset));
  return request<AdminActivityMonitoring>(`/monitoring?${params.toString()}`, token);
};

export const reviewAdminActivityAlert = (
  token: string,
  body: { alertKey: string; status: AdminMonitoringAlertStatus; note?: string },
): Promise<{
  ok: boolean;
  alertKey: string;
  status: AdminMonitoringAlertStatus;
  note: string | null;
  automaticAction: boolean;
}> =>
  request<{
    ok: boolean;
    alertKey: string;
    status: AdminMonitoringAlertStatus;
    note: string | null;
    automaticAction: boolean;
  }>('/monitoring/alerts/review', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export interface AdminSpendingOverview {
  generatedAt: string;
  source: 'supabase' | 'local';
  fallbackReason: string | null;
  status: {
    enabled: boolean;
    paused: boolean;
    pausedByEmergency: boolean;
    pausedByAdmin: boolean;
    emergency: AdminOverview['emergency'];
    configuredProviders: number;
    availableModels: number;
    defaultModel: string | null;
  };
  limits: {
    dailyLimitAud: number;
    monthlyHardLimitAud: number;
    monthlyBudgetAud: number;
    perUserDailyLimitAud: number;
    perUserMonthlyLimitAud: number;
    warningThresholds: number[];
    modelLimits: Record<string, AdminModelLimit>;
    requestsPerDay: number;
    tokensPerDay: number;
    requestsPerDayPerUser: number;
    tokensPerDayPerUser: number;
    costPerMonthPerUserUsd: number;
  };
  spending: {
    dayAud: number;
    monthAud: number;
    dayReservedAud: number;
    monthReservedAud: number;
    remainingDailyAud: number;
    remainingMonthlyAud: number;
    dailyPercentage: number;
    monthlyPercentage: number;
    byProvider: Record<string, number>;
    byModel: Record<string, number>;
    monthlyHistory: Array<AdminTotals & { month: string }>;
  };
  reservations: { active: number; reservedAud: number; uncertain: number };
  alerts: AdminBudgetAlert[];
  overrides: {
    warningThresholds: number[] | null;
    emergencyPaused: boolean | null;
  };
}

export const loadAdminSpending = (token: string): Promise<AdminSpendingOverview> =>
  request<AdminSpendingOverview>('/spending', token);

export interface AdminSpendingSettingsBody {
  limits?: Partial<
    Pick<
      AdminLimits,
      | 'dailyLimitAud'
      | 'monthlyHardLimitAud'
      | 'monthlyBudgetAud'
      | 'perUserDailyLimitAud'
      | 'perUserMonthlyLimitAud'
      | 'requestsPerDay'
      | 'tokensPerDay'
      | 'requestsPerDayPerUser'
      | 'tokensPerDayPerUser'
      | 'costPerMonthPerUserUsd'
    >
  >;
  warningThresholds?: number[];
  modelLimits?: Record<string, AdminModelLimit>;
  reason: string;
  confirm: true;
}

export const saveAdminSpending = (
  token: string,
  body: AdminSpendingSettingsBody,
): Promise<{ ok: boolean; spending: AdminSpendingOverview; overview: AdminOverview }> =>
  request<{ ok: boolean; spending: AdminSpendingOverview; overview: AdminOverview }>('/spending/settings', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const setAdminEmergency = (
  token: string,
  body: { paused: boolean; reason: string; confirm: true },
): Promise<{ ok: boolean; spending: AdminSpendingOverview; overview: AdminOverview }> =>
  request<{ ok: boolean; spending: AdminSpendingOverview; overview: AdminOverview }>('/spending/emergency', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const loadAdminSupabaseOverview = (token: string): Promise<AdminSupabaseOverview> =>
  request<AdminSupabaseOverview>('/overview/supabase', token);

export const loadAdminAnalytics = (
  token: string,
  query: AdminAnalyticsQuery,
): Promise<AdminAiAnalytics> => {
  const params = new URLSearchParams();
  params.set('preset', query.preset);
  for (const key of ['from', 'to', 'provider', 'model', 'action', 'search'] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  if (query.limit) params.set('limit', String(query.limit));
  if (query.offset) params.set('offset', String(query.offset));
  return request<AdminAiAnalytics>(`/analytics?${params.toString()}`, token);
};

export const saveAdminSettings = (
  token: string,
  body: AdminSettingsBody,
): Promise<{ ok: boolean; overview: AdminOverview }> =>
  request<{ ok: boolean; overview: AdminOverview }>('/settings', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export interface AdminSettingsPreview {
  ok: true;
  defaultModel: string | null;
  backupModel: string | null;
  fallbackModels: string[];
  featureModels: Record<string, string | null>;
  disabledModels: string[];
  chain: string[];
  featureChains: Record<string, string[]>;
  models: Array<{
    ref: string;
    label: string;
    enabled: boolean;
    disabledBy: 'environment' | 'admin' | null;
    price: AdminPrice | null;
  }>;
}

export const testAdminSettings = (
  token: string,
  body: AdminSettingsBody,
): Promise<AdminSettingsPreview> =>
  request<AdminSettingsPreview>('/settings/test', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const restoreAdminSettings = (
  token: string,
): Promise<{ ok: boolean; overview: AdminOverview }> =>
  request<{ ok: boolean; overview: AdminOverview }>('/settings/restore', token, {
    method: 'POST',
  });

export const testAdminProvider = (
  token: string,
  provider: string,
): Promise<AdminTestResult & { provider: string }> =>
  request<AdminTestResult & { provider: string }>('/test', token, {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });

export const loadAdminCredits = (token: string): Promise<AdminCreditsOverview> =>
  request<AdminCreditsOverview>('/credits', token);

export const loadAdminManagedCredits = (
  token: string,
  query: { search?: string; limit?: number; offset?: number } = {},
): Promise<AdminManagedCreditsOverview> => {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.offset) params.set('offset', String(query.offset));
  const suffix = params.toString();
  return request<AdminManagedCreditsOverview>(`/credits/supabase${suffix ? `?${suffix}` : ''}`, token);
};

export const loadAdminManagedCreditUser = (
  token: string,
  userId: string,
): Promise<AdminManagedCreditUserDetail> =>
  request<AdminManagedCreditUserDetail>(`/credits/supabase/users/${encodeURIComponent(userId)}`, token);

export const saveAdminManagedCreditSettings = (
  token: string,
  body: {
    actions?: Record<string, number>;
    plans?: Record<string, { creditsPerPeriod: number; periodDays: number }>;
  },
): Promise<{ ok: boolean; config: AdminManagedCreditConfig }> =>
  request<{ ok: boolean; config: AdminManagedCreditConfig }>('/credits/supabase/settings', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const adjustAdminManagedCredits = (
  token: string,
  body: { userId: string; delta: number; reason: string; requestId: string },
): Promise<{ ok: boolean } & AdminManagedCreditAdjustment> =>
  request<{ ok: boolean } & AdminManagedCreditAdjustment>('/credits/supabase/adjustments', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const loadAdminUserUsage = (token: string, userId: string): Promise<AdminUserUsage> =>
  request<AdminUserUsage>(`/credits/usage/${encodeURIComponent(userId)}`, token);

export const saveAdminCredits = (
  token: string,
  body: AdminCreditSettingsBody,
): Promise<{ ok: boolean; credits: AdminCreditsOverview }> =>
  request<{ ok: boolean; credits: AdminCreditsOverview }>('/credits/settings', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const setAdminCreditPlan = (
  token: string,
  userId: string,
  plan: 'free' | 'plus',
): Promise<{ ok: boolean; credits: AdminCreditsOverview }> =>
  request<{ ok: boolean; credits: AdminCreditsOverview }>('/credits/plan', token, {
    method: 'POST',
    body: JSON.stringify({ userId, plan }),
  });

export const setAdminSubscriptionStatus = (
  token: string,
  userId: string,
  status: AdminCreditAccount['subscriptionStatus'],
): Promise<{ ok: boolean; credits: AdminCreditsOverview }> =>
  request<{ ok: boolean; credits: AdminCreditsOverview }>('/credits/status', token, {
    method: 'POST',
    body: JSON.stringify({ userId, status }),
  });

/** AUD figures must come from server `*Aud` fields, never client-side conversion. */
export const aud = (value: number): string => {
  const amount = Number.isFinite(value) ? value : 0;
  if (amount > 0 && amount < 0.01) return `A$${amount.toFixed(4)}`;
  return `A$${amount.toFixed(2)}`;
};

/** Legacy USD formatter retained for historical consumer-cost fields. */
export const money = (value: number): string => {
  const amount = Number.isFinite(value) ? value : 0;
  if (amount > 0 && amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
};

export const compact = (value: number): string => {
  const amount = Number.isFinite(value) ? value : 0;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}m`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}k`;
  return String(Math.round(amount));
};

/** 0 to 1 of a limit that has been used. */
export const ratio = (used: number, limit: number): number => {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(0, Math.min(1, used / limit));
};
