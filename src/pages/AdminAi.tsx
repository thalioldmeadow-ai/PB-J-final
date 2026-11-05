import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  BarChart3,
  Brain,
  Check,
  CheckCircle2,
  Clock,
  Coins,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from '../components/icons';
import { cn } from '../lib/utils';
import {
  AdminActivityAlert,
  AdminActivityMonitoring,
  AdminAiAnalytics,
  AdminAnalyticsPreset,
  AdminAnalyticsTimeseriesPoint,
  AdminCreditsOverview,
  AdminManagedCreditsOverview,
  AdminManagedCreditUserDetail,
  AdminMonitoringAlertStatus,
  AdminMonitoringSeverity,
  AdminOverview,
  AdminRequestError,
  AdminSettingsBody,
  AdminSettingsPreview,
  AdminSpendingOverview,
  AdminSupabaseOverview,
  AdminTestResult,
  AdminUserUsage,
  aud,
  compact,
  clearAdminToken,
  loadAdminCredits,
  loadAdminManagedCredits,
  loadAdminManagedCreditUser,
  loadAdminActivityMonitoring,
  loadAdminAnalytics,
  loadAdminOverview,
  loadAdminSpending,
  loadAdminSupabaseOverview,
  loadAdminUserUsage,
  ratio,
  readAdminToken,
  reviewAdminActivityAlert,
  saveAdminCredits,
  saveAdminManagedCreditSettings,
  saveAdminSettings,
  saveAdminSpending,
  saveAdminToken,
  setAdminEmergency,
  restoreAdminSettings,
  setAdminCreditPlan,
  setAdminSubscriptionStatus,
  adjustAdminManagedCredits,
  testAdminProvider,
  testAdminSettings,
} from '../lib/aiAdmin';

const SAVE_NOTE = 'Saved. The change applies immediately, no restart needed.';

const AI_FEATURE_LABELS: Record<string, string> = {
  planning: 'Planning',
  budget: 'Budget',
  habits: 'Routines and habits',
  progress: 'Progress',
  lists: 'Lists',
  general: 'General / Coach',
};

const providerLabel = (id: string): string =>
  id === 'freebuff' ? 'Freebuff' : id === 'openai' ? 'OpenAI' : id === 'huggingface' ? 'Hugging Face' : id;

const utcDate = (value: string | Date): string =>
  new Date(value).toLocaleDateString(undefined, { timeZone: 'UTC' });

const utcDateTime = (value: string): string =>
  new Date(value).toLocaleString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

const Section: React.FC<{ title: string; hint?: string; icon: React.ReactNode; children: React.ReactNode }> = ({
  title,
  hint,
  icon,
  children,
}) => (
  <section className="space-y-3">
    <div className="flex items-start gap-2">
      <span className="p-1.5 rounded-full bg-primary/10 text-primary shrink-0">{icon}</span>
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-foreground">{title}</h2>
        {hint && <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5">{hint}</p>}
      </div>
    </div>
    {children}
  </section>
);

const Stat: React.FC<{ label: string; value: string; note?: string; tone?: 'normal' | 'warn' | 'bad' }> = ({
  label,
  value,
  note,
  tone = 'normal',
}) => (
  <div className="p-3 rounded-2xl bg-card border border-border">
    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
    <p
      className={cn(
        'text-lg font-black mt-0.5',
        tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-rose-600' : 'text-foreground',
      )}
    >
      {value}
    </p>
    {note && <p className="text-[9px] text-muted-foreground leading-relaxed mt-0.5">{note}</p>}
  </div>
);

const Meter: React.FC<{ used: number; limit: number }> = ({ used, limit }) => {
  const usedRatio = ratio(used, limit);
  return (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
      <div
        className={cn(
          'h-full rounded-full transition-all',
          usedRatio >= 1 ? 'bg-rose-500' : usedRatio >= 0.8 ? 'bg-amber-500' : 'bg-primary',
        )}
        style={{ width: `${Math.round(usedRatio * 100)}%` }}
      />
    </div>
  );
};

const AnalyticsBars: React.FC<{
  points: AdminAnalyticsTimeseriesPoint[];
  value: (point: AdminAnalyticsTimeseriesPoint) => number;
  title: (point: AdminAnalyticsTimeseriesPoint) => string;
  tone?: 'primary' | 'emerald' | 'amber';
}> = ({ points, value, title, tone = 'primary' }) => {
  if (points.length === 0) {
    return <p className="text-[10px] text-muted-foreground">No data in this range.</p>;
  }
  const max = Math.max(1, ...points.map(value));
  return (
    <div className="flex items-end gap-1 h-20" aria-label="Time series">
      {points.map((point) => (
        <div key={point.day} className="flex-1 min-w-0 flex flex-col items-center gap-1" title={title(point)}>
          <div
            className={cn(
              'w-full rounded-t',
              tone === 'emerald' ? 'bg-emerald-500/70' : tone === 'amber' ? 'bg-amber-500/70' : 'bg-primary/60',
            )}
            style={{ height: `${Math.max(2, Math.round((value(point) / max) * 64))}px` }}
          />
          <span className="text-[7px] text-muted-foreground truncate w-full text-center">
            {point.day.slice(5)}
          </span>
        </div>
      ))}
    </div>
  );
};

const AnalyticsBreakdown: React.FC<{
  rows: Array<{
    label: string;
    detail: string;
    requests: number;
    actualCostAud: number;
    estimatedCostAud: number;
    costAud: number;
  }>;
}> = ({ rows }) => {
  if (rows.length === 0) {
    return <p className="text-[10px] text-muted-foreground">No data in this range.</p>;
  }
  const max = Math.max(1, ...rows.map((row) => row.costAud));
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={`${row.label}-${row.detail}`} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-[10px]">
            <span className="font-semibold truncate">{row.label}</span>
            <span className="text-muted-foreground shrink-0">{aud(row.costAud)}</span>
          </div>
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary/60"
              style={{ width: `${Math.max(2, Math.round((row.costAud / max) * 100))}%` }}
            />
          </div>
          <p className="text-[8px] text-muted-foreground">
            {row.detail} · actual {aud(row.actualCostAud)} · est. {aud(row.estimatedCostAud)}
          </p>
        </div>
      ))}
    </div>
  );
};

const AdminAi: React.FC = () => {
  const [token, setToken] = useState(readAdminToken());
  const [tokenInput, setTokenInput] = useState('');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(Boolean(readAdminToken()));
  const [error, setError] = useState<string | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, AdminTestResult>>({});
  const [credits, setCredits] = useState<AdminCreditsOverview | null>(null);
  const [creditCostsDraft, setCreditCostsDraft] = useState<Record<string, string>>({});
  const [planDrafts, setPlanDrafts] = useState<
    Record<
      string,
      {
        creditsPerPeriod: string;
        periodDays: string;
        requestsPerDay: string;
        tokensPerDay: string;
        memoryLimit: string;
        historyLimit: string;
        historyCharLimit: string;
        maxAttachments: string;
        advancedFeatures: boolean;
      }
    >
  >({});
  const [creditSaving, setCreditSaving] = useState(false);
  const [creditBusy, setCreditBusy] = useState<string | null>(null);
  const [usageUser, setUsageUser] = useState<string | null>(null);
  const [userUsage, setUserUsage] = useState<AdminUserUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [supabaseOverview, setSupabaseOverview] = useState<AdminSupabaseOverview | null>(null);
  const [supabaseLoading, setSupabaseLoading] = useState(false);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
  const [analyticsPreset, setAnalyticsPreset] = useState<AdminAnalyticsPreset>('last30');
  const [analyticsFrom, setAnalyticsFrom] = useState('');
  const [analyticsTo, setAnalyticsTo] = useState('');
  const [analyticsProvider, setAnalyticsProvider] = useState('');
  const [analyticsModel, setAnalyticsModel] = useState('');
  const [analyticsAction, setAnalyticsAction] = useState('');
  const [analyticsSearchDraft, setAnalyticsSearchDraft] = useState('');
  const [analyticsSearch, setAnalyticsSearch] = useState('');
  const [analyticsPage, setAnalyticsPage] = useState(0);
  const [analytics, setAnalytics] = useState<AdminAiAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const analyticsRequestSeq = useRef(0);
  const [monitoringPreset, setMonitoringPreset] = useState<AdminAnalyticsPreset>('last30');
  const [monitoringFrom, setMonitoringFrom] = useState('');
  const [monitoringTo, setMonitoringTo] = useState('');
  const [monitoringSearchDraft, setMonitoringSearchDraft] = useState('');
  const [monitoringSearch, setMonitoringSearch] = useState('');
  const [monitoringSeverity, setMonitoringSeverity] = useState<AdminMonitoringSeverity | ''>('');
  const [monitoringAlertStatus, setMonitoringAlertStatus] = useState<AdminMonitoringAlertStatus | ''>('');
  const [monitoring, setMonitoring] = useState<AdminActivityMonitoring | null>(null);
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [monitoringError, setMonitoringError] = useState<string | null>(null);
  const [monitoringNotice, setMonitoringNotice] = useState<string | null>(null);
  const [monitoringNotes, setMonitoringNotes] = useState<Record<string, string>>({});
  const [monitoringBusy, setMonitoringBusy] = useState<string | null>(null);
  const [monitoringRefresh, setMonitoringRefresh] = useState(0);
  const monitoringRequestSeq = useRef(0);
  const [managedCredits, setManagedCredits] = useState<AdminManagedCreditsOverview | null>(null);
  const [managedLoading, setManagedLoading] = useState(false);
  const [managedError, setManagedError] = useState<string | null>(null);
  const [managedNotice, setManagedNotice] = useState<string | null>(null);
  const [managedSearchDraft, setManagedSearchDraft] = useState('');
  const [managedSearch, setManagedSearch] = useState('');
  const [managedPage, setManagedPage] = useState(0);
  const [managedActionDrafts, setManagedActionDrafts] = useState<Record<string, string>>({});
  const [managedPlanDrafts, setManagedPlanDrafts] = useState<
    Record<string, { creditsPerPeriod: string; periodDays: string }>
  >({});
  const [managedSaving, setManagedSaving] = useState(false);
  const [managedUser, setManagedUser] = useState<AdminManagedCreditUserDetail | null>(null);
  const [managedUserLoading, setManagedUserLoading] = useState(false);
  const [managedAdjustAmount, setManagedAdjustAmount] = useState('');
  const [managedAdjustReason, setManagedAdjustReason] = useState('');
  const [managedAdjustBusy, setManagedAdjustBusy] = useState<'add' | 'remove' | null>(null);

  const [providerDraft, setProviderDraft] = useState<Record<string, boolean>>({});
  const [defaultDraft, setDefaultDraft] = useState('');
  const [fallbackDrafts, setFallbackDrafts] = useState(['', '', '']);
  const [featureModelDraft, setFeatureModelDraft] = useState<Record<string, string>>({});
  const [modelEnabledDraft, setModelEnabledDraft] = useState<Record<string, boolean>>({});
  const [settingsTest, setSettingsTest] = useState<AdminSettingsPreview | null>(null);
  const [testingSettings, setTestingSettings] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [limitsDraft, setLimitsDraft] = useState({
    monthlyBudgetAud: '',
    monthlyHardLimitAud: '',
    dailyLimitAud: '',
    requestsPerDay: '',
    tokensPerDay: '',
    requestsPerDayPerUser: '',
    tokensPerDayPerUser: '',
    costPerMonthPerUserUsd: '',
    perUserDailyLimitAud: '',
    perUserMonthlyLimitAud: '',
  });
  const [providerLimitsDraft, setProviderLimitsDraft] = useState<Record<string, string>>({});
  const [spending, setSpending] = useState<AdminSpendingOverview | null>(null);
  const [spendingReason, setSpendingReason] = useState('');
  const [thresholdDraft, setThresholdDraft] = useState('50, 75, 90');
  const [modelLimitDrafts, setModelLimitDrafts] = useState<
    Record<string, { dailyAud: string; monthlyAud: string }>
  >({});
  const [emergencyReason, setEmergencyReason] = useState('');
  const [emergencyBusy, setEmergencyBusy] = useState(false);

  const syncDrafts = useCallback((data: AdminOverview) => {
    setProviderDraft(
      Object.fromEntries(data.providers.map((provider) => [provider.id, provider.enabled])),
    );
    setDefaultDraft(data.defaultModel || '');
    setFallbackDrafts([...(data.fallbackModels || []).slice(0, 3), '', '', ''].slice(0, 3));
    setFeatureModelDraft(
      Object.fromEntries(
        Object.entries(data.featureModels || {}).map(([feature, ref]) => [feature, ref || '']),
      ),
    );
    setModelEnabledDraft(
      Object.fromEntries(
        data.providers.flatMap((provider) =>
          provider.models.map((model) => [`${provider.id}:${model.id}`, model.enabled !== false]),
        ),
      ),
    );
    setProviderLimitsDraft(
      Object.fromEntries(data.providers.map((provider) => [provider.id, String(provider.limits.requestsPerDay)])),
    );
    setLimitsDraft({
      monthlyBudgetAud: String(data.limits.monthlyBudgetAud),
      monthlyHardLimitAud: String(data.limits.monthlyHardLimitAud),
      dailyLimitAud: String(data.limits.dailyLimitAud),
      requestsPerDay: String(data.limits.requestsPerDay),
      tokensPerDay: String(data.limits.tokensPerDay),
      requestsPerDayPerUser: String(data.limits.requestsPerDayPerUser),
      tokensPerDayPerUser: String(data.limits.tokensPerDayPerUser),
      costPerMonthPerUserUsd: String(data.limits.costPerMonthPerUserUsd),
      perUserDailyLimitAud: String(data.limits.perUserDailyLimitAud),
      perUserMonthlyLimitAud: String(data.limits.perUserMonthlyLimitAud),
    });
    setThresholdDraft((data.warningThresholds || [50, 75, 90]).join(', '));
    setModelLimitDrafts(
      Object.fromEntries(
        data.providers.flatMap((provider) =>
          provider.models.map((model) => {
            const ref = `${provider.id}:${model.id}`;
            return [
              ref,
              {
                dailyAud: String(data.modelLimits?.[ref]?.dailyAud ?? ''),
                monthlyAud: String(data.modelLimits?.[ref]?.monthlyAud ?? ''),
              },
            ];
          }),
        ),
      ),
    );
    setTests((current) => ({ ...data.tests, ...current }));
  }, []);

  const syncCreditDrafts = useCallback((data: AdminCreditsOverview) => {
    setCreditCostsDraft(
      Object.fromEntries(data.config.actions.map((action) => [action.key, String(action.cost)])),
    );
    setPlanDrafts(
      Object.fromEntries(
        data.config.plans.map((plan) => [
          plan.id,
          {
            creditsPerPeriod: String(plan.creditsPerPeriod),
            periodDays: String(plan.periodDays),
            requestsPerDay: String(plan.requestsPerDay),
            tokensPerDay: String(plan.tokensPerDay),
            memoryLimit: String(plan.memoryLimit),
            historyLimit: String(plan.historyLimit),
            historyCharLimit: String(plan.historyCharLimit),
            maxAttachments: String(plan.maxAttachments),
            advancedFeatures: plan.advancedFeatures,
          },
        ]),
      ),
    );
  }, []);

  const syncManagedDrafts = useCallback((data: AdminManagedCreditsOverview) => {
    setManagedActionDrafts(
      Object.fromEntries(data.config.actions.map((action) => [action.key, String(action.cost)])),
    );
    setManagedPlanDrafts(
      Object.fromEntries(
        data.config.plans.map((plan) => [
          plan.id,
          { creditsPerPeriod: String(plan.creditsPerPeriod), periodDays: String(plan.periodDays) },
        ]),
      ),
    );
  }, []);

  const loadSupabaseStats = useCallback(async (useToken: string) => {
    if (!useToken.trim()) return;
    setSupabaseLoading(true);
    setSupabaseError(null);
    try {
      setSupabaseOverview(await loadAdminSupabaseOverview(useToken.trim()));
    } catch (err) {
      setSupabaseOverview(null);
      setSupabaseError(
        err instanceof AdminRequestError
          ? err.message
          : 'Supabase statistics could not be loaded. Try again.',
      );
    } finally {
      setSupabaseLoading(false);
    }
  }, []);

  const loadSpending = useCallback(async (useToken: string) => {
    if (!useToken.trim()) return;
    try {
      setSpending(await loadAdminSpending(useToken.trim()));
    } catch {
      setSpending(null);
    }
  }, []);

  const loadManagedCredits = useCallback(
    async (useToken: string, search: string, page: number) => {
      if (!useToken.trim()) return;
      setManagedLoading(true);
      setManagedError(null);
      try {
        const data = await loadAdminManagedCredits(useToken.trim(), {
          search: search.trim() || undefined,
          limit: 25,
          offset: page * 25,
        });
        setManagedCredits(data);
        syncManagedDrafts(data);
      } catch (err) {
        setManagedCredits(null);
        setManagedError(
          err instanceof AdminRequestError
            ? err.message
            : 'Credit management could not be loaded. Try again.',
        );
      } finally {
        setManagedLoading(false);
      }
    },
    [syncManagedDrafts],
  );

  const loadAnalytics = useCallback(
    async (useToken: string) => {
      if (!useToken.trim()) return;
      const seq = analyticsRequestSeq.current + 1;
      analyticsRequestSeq.current = seq;
      if (analyticsPreset === 'custom' && (!analyticsFrom || !analyticsTo)) {
        setAnalytics(null);
        setAnalyticsError('Choose both a start and end date for a custom range.');
        setAnalyticsLoading(false);
        return;
      }
      setAnalyticsLoading(true);
      setAnalyticsError(null);
      try {
        const data = await loadAdminAnalytics(useToken.trim(), {
          preset: analyticsPreset,
          from: analyticsPreset === 'custom' ? analyticsFrom : undefined,
          to: analyticsPreset === 'custom' ? analyticsTo : undefined,
          provider: analyticsProvider || undefined,
          model: analyticsModel || undefined,
          action: analyticsAction || undefined,
          search: analyticsSearch || undefined,
          limit: 25,
          offset: analyticsPage * 25,
        });
        if (seq !== analyticsRequestSeq.current) return;
        setAnalytics(data);
      } catch (err) {
        if (seq !== analyticsRequestSeq.current) return;
        setAnalytics(null);
        setAnalyticsError(
          err instanceof AdminRequestError
            ? err.message
            : 'AI usage analytics could not be loaded. Try again.',
        );
      } finally {
        if (seq === analyticsRequestSeq.current) setAnalyticsLoading(false);
      }
    },
    [
      analyticsAction,
      analyticsFrom,
      analyticsModel,
      analyticsPage,
      analyticsPreset,
      analyticsProvider,
      analyticsSearch,
      analyticsTo,
    ],
  );

  useEffect(() => {
    if (token) void loadAnalytics(token);
  }, [token, loadAnalytics]);

  useEffect(() => {
    if (!token) return;
    if (monitoringPreset === 'custom' && (!monitoringFrom || !monitoringTo)) {
      setMonitoring(null);
      setMonitoringError('Choose both a start and end date for a custom range.');
      return;
    }
    const seq = monitoringRequestSeq.current + 1;
    monitoringRequestSeq.current = seq;
    setMonitoringLoading(true);
    setMonitoringError(null);
    void loadAdminActivityMonitoring(token, {
      preset: monitoringPreset,
      from: monitoringPreset === 'custom' ? monitoringFrom : undefined,
      to: monitoringPreset === 'custom' ? monitoringTo : undefined,
      search: monitoringSearch || undefined,
      severity: monitoringSeverity,
      alertStatus: monitoringAlertStatus,
      limit: 50,
    })
      .then((data) => {
        if (seq === monitoringRequestSeq.current) setMonitoring(data);
      })
      .catch((err) => {
        if (seq !== monitoringRequestSeq.current) return;
        setMonitoring(null);
        setMonitoringError(
          err instanceof AdminRequestError
            ? err.message
            : 'User activity monitoring could not be loaded. Try again.',
        );
      })
      .finally(() => {
        if (seq === monitoringRequestSeq.current) setMonitoringLoading(false);
      });
  }, [
    token,
    monitoringPreset,
    monitoringFrom,
    monitoringTo,
    monitoringSearch,
    monitoringSeverity,
    monitoringAlertStatus,
    monitoringRefresh,
  ]);

  const reviewMonitoringAlert = async (
    alert: AdminActivityAlert,
    status: AdminMonitoringAlertStatus,
  ) => {
    if (!token) return;
    setMonitoringBusy(alert.key);
    setMonitoringError(null);
    setMonitoringNotice(null);
    try {
      await reviewAdminActivityAlert(token, {
        alertKey: alert.key,
        status,
        note: monitoringNotes[alert.key] ?? alert.note ?? '',
      });
      setMonitoringNotice(
        status === 'reviewed'
          ? 'Alert marked reviewed. The note and review were added to the administrator audit log.'
          : 'Alert reopened. The change was added to the administrator audit log.',
      );
      setMonitoringRefresh((value) => value + 1);
    } catch (err) {
      setMonitoringError(
        err instanceof AdminRequestError ? err.message : 'The alert review could not be saved.',
      );
    } finally {
      setMonitoringBusy(null);
    }
  };

  const load = useCallback(
    async (useToken: string) => {
      if (!useToken.trim()) return;
      setLoading(true);
      setError(null);
      setSetupNeeded(false);
      void loadSupabaseStats(useToken.trim());
      void loadSpending(useToken.trim());
      try {
        const [data, creditData] = await Promise.all([
          loadAdminOverview(useToken.trim()),
          loadAdminCredits(useToken.trim()),
        ]);
        saveAdminToken(useToken.trim());
        setToken(useToken.trim());
        setOverview(data);
        setCredits(creditData);
        syncDrafts(data);
        syncCreditDrafts(creditData);
      } catch (err) {
        const adminError = err instanceof AdminRequestError ? err : null;
        setOverview(null);
        if (adminError?.code === 'admin_not_configured') {
          setSetupNeeded(true);
          setError(null);
        } else if (adminError?.status === 401) {
          clearAdminToken();
          setToken('');
          setError(adminError.message);
        } else {
          setError(adminError?.message || 'The dashboard could not be loaded.');
        }
      } finally {
        setLoading(false);
      }
    },
    [loadSupabaseStats, syncDrafts, syncCreditDrafts],
  );

  useEffect(() => {
    if (token) void load(token);
  }, [token, load]);

  useEffect(() => {
    if (token) void loadManagedCredits(token, managedSearch, managedPage);
  }, [token, managedSearch, managedPage, loadManagedCredits]);

  const modelOptions = useMemo(() => {
    if (!overview) return [] as { ref: string; label: string; enabled: boolean; disabledBy: string | null }[];
    return overview.providers.flatMap((provider) =>
      provider.models.map((model) => ({
        ref: `${provider.id}:${model.id}`,
        label: `${provider.label} · ${model.label}`,
        enabled: model.enabled !== false && model.disabledBy !== 'environment',
        disabledBy: model.disabledBy,
      })),
    );
  }, [overview]);

  const warnings = useMemo(() => {
    if (!overview) return [] as string[];
    const messages: string[] = [];
    const month = overview.budget.percentageUsed;
    const hard = overview.budget.hardLimitPercentage;
    const day = ratio(overview.usage.today.costAud, overview.limits.dailyLimitAud);
    if (month >= 0.8) {
      messages.push(
        `Monthly budget is ${Math.round(month * 100)}% used (${aud(overview.budget.currentMonthAud)} of ${aud(
          overview.budget.monthlyBudgetAud,
        )}). Requests are blocked at the hard limit.`,
      );
    }
    if (hard >= 0.8 && overview.budget.monthlyHardLimitAud !== overview.budget.monthlyBudgetAud) {
      messages.push(
        `Monthly hard limit is ${Math.round(hard * 100)}% used (${aud(
          overview.budget.currentMonthAud,
        )} of ${aud(overview.budget.monthlyHardLimitAud)}). Requests stop at this limit.`,
      );
    }
    if (day >= 0.8) {
      messages.push(
        `Today's spending is ${Math.round(day * 100)}% of the daily limit (${aud(
          overview.usage.today.costAud,
        )} of ${aud(overview.limits.dailyLimitAud)}).`,
      );
    }
    for (const provider of overview.providers) {
      const performance = overview.usage.providerPerformance[provider.id];
      if (provider.enabled && performance && performance.errorRate >= 0.2 && performance.requests > 0) {
        messages.push(
          `${provider.label} is failing ${Math.round(performance.errorRate * 100)}% of calls. Test the connection.`,
        );
      }
    }
    return messages;
  }, [overview]);

  const save = async (body: AdminSettingsBody, tone: 'provider' | 'cost') => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveAdminSettings(token, body);
      setOverview(result.overview);
      syncDrafts(result.overview);
      setNotice(SAVE_NOTE);
      if (tone === 'provider') setTests({});
    } catch (err) {
      setError(err instanceof AdminRequestError ? err.message : 'That change could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const settingsBody = (): AdminSettingsBody => ({
    providers: providerDraft,
    defaultModel: defaultDraft || null,
    backupModel: fallbackDrafts[0] || null,
    fallbackModels: fallbackDrafts.filter(Boolean),
    featureModels: featureModelDraft,
    disabledModels: Object.entries(modelEnabledDraft)
      .filter(([, enabled]) => !enabled)
      .map(([ref]) => ref),
  });

  const saveProviders = () => void save(settingsBody(), 'provider');

  const testSettings = async () => {
    setTestingSettings(true);
    setError(null);
    setNotice(null);
    setSettingsTest(null);
    try {
      const result = await testAdminSettings(token, settingsBody());
      setSettingsTest(result);
    } catch (err) {
      setError(
        err instanceof AdminRequestError
          ? err.message
          : 'The model configuration could not be validated.',
      );
    } finally {
      setTestingSettings(false);
    }
  };

  const restoreSettings = async () => {
    setRestoring(true);
    setError(null);
    setNotice(null);
    try {
      const result = await restoreAdminSettings(token);
      setOverview(result.overview);
      syncDrafts(result.overview);
      setTests({});
      setNotice('Previous AI configuration restored. The change is recorded in the audit log.');
    } catch (err) {
      setError(
        err instanceof AdminRequestError ? err.message : 'The previous configuration could not be restored.',
      );
    } finally {
      setRestoring(false);
    }
  };

  const saveCosts = async () => {
    if (!token) return;
    const numeric = (value: string): number | undefined => {
      if (value.trim() === '') return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const limits: NonNullable<AdminSettingsBody['limits']> & {
      perUserDailyLimitAud?: number;
      perUserMonthlyLimitAud?: number;
    } = {};
    const entries: [keyof typeof limits, string][] = [
      ['monthlyBudgetAud', limitsDraft.monthlyBudgetAud],
      ['monthlyHardLimitAud', limitsDraft.monthlyHardLimitAud],
      ['dailyLimitAud', limitsDraft.dailyLimitAud],
      ['requestsPerDay', limitsDraft.requestsPerDay],
      ['tokensPerDay', limitsDraft.tokensPerDay],
      ['requestsPerDayPerUser', limitsDraft.requestsPerDayPerUser],
      ['tokensPerDayPerUser', limitsDraft.tokensPerDayPerUser],
      ['costPerMonthPerUserUsd', limitsDraft.costPerMonthPerUserUsd],
      ['perUserDailyLimitAud', limitsDraft.perUserDailyLimitAud],
      ['perUserMonthlyLimitAud', limitsDraft.perUserMonthlyLimitAud],
    ];
    for (const [key, value] of entries) {
      const parsed = numeric(value);
      if (parsed !== undefined) limits[key] = parsed;
    }
    const warningThresholds = thresholdDraft
      .split(',')
      .map((value) => Math.round(Number(value.trim())))
      .filter((value) => Number.isFinite(value) && value > 0 && value < 100);
    if (warningThresholds.length === 0) {
      setError('Use at least one warning threshold between 1 and 99 percent.');
      return;
    }
    const modelLimits: Record<string, { dailyAud?: number; monthlyAud?: number }> = {};
    for (const [ref, draft] of Object.entries(modelLimitDrafts)) {
      const next: { dailyAud?: number; monthlyAud?: number } = {};
      const existing = overview?.modelLimits?.[ref];
      for (const key of ['dailyAud', 'monthlyAud'] as const) {
        if (draft[key].trim() === '') {
          if (existing?.[key] !== undefined) next[key] = 0;
          continue;
        }
        const parsed = Number(draft[key]);
        if (!Number.isFinite(parsed) || parsed < 0) {
          setError(`Use a valid non-negative AUD limit for ${ref}.`);
          return;
        }
        next[key] = parsed;
      }
      if (Object.keys(next).length > 0) modelLimits[ref] = next;
    }
    if (!spendingReason.trim()) {
      setError('Record a short reason before changing spending limits.');
      return;
    }
    if (!window.confirm('Apply these spending limits? This affects new AI requests immediately.')) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveAdminSpending(token, {
        limits,
        warningThresholds,
        modelLimits,
        reason: spendingReason.trim(),
        confirm: true,
      });
      setSpending(result.spending);
      setOverview(result.overview);
      syncDrafts(result.overview);
      setSpendingReason('');
      setNotice('Spending controls saved. The change is recorded in the audit log.');
    } catch (err) {
      setError(err instanceof AdminRequestError ? err.message : 'Those spending limits could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const toggleEmergency = async (paused: boolean) => {
    if (!token) return;
    if (emergencyReason.trim().length < 3) {
      setError('Record a reason before changing the emergency state.');
      return;
    }
    if (!window.confirm(paused ? 'Pause all new AI requests now? Running requests will finish.' : 'Resume new AI requests now?')) {
      return;
    }
    setEmergencyBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await setAdminEmergency(token, {
        paused,
        reason: emergencyReason.trim(),
        confirm: true,
      });
      setSpending(result.spending);
      setOverview(result.overview);
      syncDrafts(result.overview);
      setEmergencyReason('');
      setNotice(paused ? 'AI is paused. Running requests are not cancelled.' : 'AI requests resumed.');
    } catch (err) {
      setError(err instanceof AdminRequestError ? err.message : 'The emergency state could not be changed.');
    } finally {
      setEmergencyBusy(false);
    }
  };

  const saveCreditSettings = async () => {
    if (!credits) return;
    setCreditSaving(true);
    setError(null);
    setNotice(null);
    try {
      const actions: Record<string, number> = {};
      for (const [key, value] of Object.entries(creditCostsDraft)) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) actions[key] = Math.max(0, Math.round(parsed));
      }
      const plans: NonNullable<Parameters<typeof saveAdminCredits>[1]['plans']> = {};
      const numberOr = (value: string, fallback: number) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
      };
      for (const [id, value] of Object.entries(planDrafts)) {
        const current = credits.config.plans.find((plan) => plan.id === id);
        if (!current) continue;
        plans[id] = {
          creditsPerPeriod: Math.max(0, Math.round(numberOr(value.creditsPerPeriod, current.creditsPerPeriod))),
          periodDays: Math.max(1, Math.round(numberOr(value.periodDays, current.periodDays))),
          requestsPerDay: Math.max(1, Math.round(numberOr(value.requestsPerDay, current.requestsPerDay))),
          tokensPerDay: Math.max(1_000, Math.round(numberOr(value.tokensPerDay, current.tokensPerDay))),
          memoryLimit: Math.max(0, Math.round(numberOr(value.memoryLimit, current.memoryLimit))),
          historyLimit: Math.max(0, Math.round(numberOr(value.historyLimit, current.historyLimit))),
          historyCharLimit: Math.max(500, Math.round(numberOr(value.historyCharLimit, current.historyCharLimit))),
          maxAttachments: Math.max(0, Math.round(numberOr(value.maxAttachments, current.maxAttachments))),
          advancedFeatures: value.advancedFeatures,
        };
      }
      const result = await saveAdminCredits(token, { actions, plans });
      setCredits(result.credits);
      syncCreditDrafts(result.credits);
      setNotice('Subscription settings saved. New periods use the updated limits.');
    } catch (err) {
      setError(err instanceof AdminRequestError ? err.message : 'Credit settings could not be saved.');
    } finally {
      setCreditSaving(false);
    }
  };

  const assignPlan = async (userId: string, plan: 'free' | 'plus') => {
    setCreditBusy(userId);
    setError(null);
    setNotice(null);
    try {
      const result = await setAdminCreditPlan(token, userId, plan);
      setCredits(result.credits);
      syncCreditDrafts(result.credits);
      setNotice('Plan changed. The wallet was reset to the new allocation.');
    } catch (err) {
      setError(err instanceof AdminRequestError ? err.message : 'That plan could not be changed.');
    } finally {
      setCreditBusy(null);
    }
  };

  const setSubscriptionStatus = async (
    userId: string,
    status: AdminCreditsOverview['accounts'][number]['subscriptionStatus'],
  ) => {
    setCreditBusy(userId);
    setError(null);
    setNotice(null);
    try {
      const result = await setAdminSubscriptionStatus(token, userId, status);
      setCredits(result.credits);
      syncCreditDrafts(result.credits);
      setNotice('Subscription status updated.');
    } catch (err) {
      setError(err instanceof AdminRequestError ? err.message : 'That subscription status could not be changed.');
    } finally {
      setCreditBusy(null);
    }
  };

  const saveManagedSettings = async () => {
    if (!managedCredits) return;
    const actions: Record<string, number> = {};
    for (const [key, value] of Object.entries(managedActionDrafts)) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setManagedError('Each action cost must be a non-negative whole number.');
        return;
      }
      actions[key] = Math.round(parsed);
    }
    const plans: Record<string, { creditsPerPeriod: number; periodDays: number }> = {};
    for (const [id, draft] of Object.entries(managedPlanDrafts)) {
      const credits = Number(draft.creditsPerPeriod);
      const days = Number(draft.periodDays);
      if (!Number.isFinite(credits) || credits < 0 || !Number.isFinite(days) || days < 1) {
        setManagedError('Allocations must be zero or more credits over at least one day.');
        return;
      }
      plans[id] = { creditsPerPeriod: Math.round(credits), periodDays: Math.round(days) };
    }
    setManagedSaving(true);
    setManagedError(null);
    setManagedNotice(null);
    try {
      await saveAdminManagedCreditSettings(token, { actions, plans });
      setManagedNotice(
        'Credit settings saved. Existing wallet balances were not changed; new periods and new wallets use the new allocation.',
      );
      await loadManagedCredits(token, managedSearch, managedPage);
    } catch (err) {
      setManagedError(
        err instanceof AdminRequestError ? err.message : 'Credit settings could not be saved.',
      );
    } finally {
      setManagedSaving(false);
    }
  };

  const openManagedUser = async (userId: string) => {
    setManagedUser(null);
    setManagedUserLoading(true);
    setManagedError(null);
    setManagedNotice(null);
    setManagedAdjustAmount('');
    setManagedAdjustReason('');
    try {
      setManagedUser(await loadAdminManagedCreditUser(token, userId));
    } catch (err) {
      setManagedError(
        err instanceof AdminRequestError ? err.message : 'That user\'s credit history could not be loaded.',
      );
    } finally {
      setManagedUserLoading(false);
    }
  };

  const adjustManagedCredits = async (direction: 'add' | 'remove') => {
    if (!managedUser) return;
    const amount = Number(managedAdjustAmount);
    const reason = managedAdjustReason.trim();
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      setManagedError('Enter a positive whole number of credits.');
      return;
    }
    if (reason.length < 3) {
      setManagedError('A reason of at least 3 characters is required for every adjustment.');
      return;
    }
    if (direction === 'remove' && amount > managedUser.user.balance) {
      setManagedError('A removal cannot take the balance below zero.');
      return;
    }
    const requestId = `adj_${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
    setManagedAdjustBusy(direction);
    setManagedError(null);
    setManagedNotice(null);
    try {
      const result = await adjustAdminManagedCredits(token, {
        userId: managedUser.user.userId,
        delta: direction === 'add' ? amount : -amount,
        reason,
        requestId,
      });
      setManagedNotice(
        result.duplicate
          ? 'That adjustment request was already applied; no duplicate transaction was created.'
          : `${direction === 'add' ? 'Added' : 'Removed'} ${amount.toLocaleString()} credits. Balance ${result.balanceBefore.toLocaleString()} → ${result.balanceAfter.toLocaleString()}.`,
      );
      setManagedAdjustAmount('');
      setManagedAdjustReason('');
      await loadManagedCredits(token, managedSearch, managedPage);
      try {
        setManagedUser(await loadAdminManagedCreditUser(token, managedUser.user.userId));
      } catch {
        // The adjustment already succeeded; keep the visible history if refresh fails.
      }
    } catch (err) {
      setManagedError(
        err instanceof AdminRequestError ? err.message : 'The credit adjustment could not be applied.',
      );
    } finally {
      setManagedAdjustBusy(null);
    }
  };

  const viewUserUsage = async (userId: string) => {
    setUsageUser(userId);
    setUsageLoading(true);
    setError(null);
    try {
      setUserUsage(await loadAdminUserUsage(token, userId));
    } catch (err) {
      setError(err instanceof AdminRequestError ? err.message : 'That user\'s usage could not be loaded.');
      setUserUsage(null);
    } finally {
      setUsageLoading(false);
    }
  };

  const runTest = async (id: string) => {
    setTesting(id);
    setError(null);
    try {
      const result = await testAdminProvider(token, id);
      setTests((current) => ({ ...current, [id]: result }));
    } catch (err) {
      setError(err instanceof AdminRequestError ? err.message : 'The connection test failed.');
    } finally {
      setTesting(null);
    }
  };

  const unlock = (event: React.FormEvent) => {
    event.preventDefault();
    if (tokenInput.trim()) void load(tokenInput);
  };

  // The gate comes before any dashboard content: without a server-verified
  // token there is nothing to show and nothing to call.
  if (!overview) {
    return (
      <div className="space-y-4 animate-in fade-in duration-300">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-primary/20 text-primary">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">AI management</h1>
            <p className="text-[10px] text-muted-foreground">Administrators only</p>
          </div>
        </div>

        <form onSubmit={unlock} className="p-4 rounded-2xl bg-card border border-border shadow-sm space-y-3">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Administrator access
          </h2>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            This area is protected on the server. Use a Supabase administrator access token, or the
            temporary AI_ADMIN_TOKEN break-glass token. It is checked on every request and stays in
            this tab only. It is not your account password.
          </p>
          <input
            type="password"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            aria-label="Administrator access token"
            autoComplete="off"
            placeholder="Paste the access token"
            className="w-full px-3 py-2.5 rounded-xl bg-background border border-border text-sm"
          />
          <button
            type="submit"
            disabled={!tokenInput.trim() || loading}
            className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
          >
            {loading ? 'Checking...' : 'Unlock dashboard'}
          </button>
          {error && <p className="text-[10px] leading-relaxed text-rose-600">{error}</p>}
          {setupNeeded && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-800">
                One setup step
              </p>
              <p className="text-[10px] leading-relaxed text-amber-900">
                Add this Supabase user to public.admin_users, or set AI_ADMIN_TOKEN for temporary
                break-glass access, then restart. For example:
                <code className="block mt-1 px-2 py-1 rounded bg-amber-100 font-mono text-[10px] break-all">
                  AI_ADMIN_TOKEN=$(openssl rand -hex 24)
                </code>
                The token is never stored in the app and never sent to browsers.
              </p>
            </div>
          )}
        </form>

        <Link to="/settings" className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Back to Settings
        </Link>
      </div>
    );
  }

  const { usage, limits, budget } = overview;
  const history = usage.history.slice(-14);
  const peak = Math.max(1, ...history.map((row) => row.requests));
  const liveCount = (value: number | null) =>
    value === null ? 'Not tracked' : compact(value);

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-6">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-full bg-primary/20 text-primary">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold tracking-tight">AI management</h1>
          <p className="text-[10px] text-muted-foreground">
            {overview.enabled ? 'Assistant online' : 'Assistant offline'} · updated{' '}
            {new Date(overview.generatedAt).toLocaleTimeString()}
          </p>
        </div>
        <button
          onClick={() => {
            void load(token);
            void loadAnalytics(token);
            void loadManagedCredits(token, managedSearch, managedPage);
          }}
          disabled={loading}
          aria-label="Refresh dashboard"
          className="p-2 rounded-full border border-border text-muted-foreground hover:text-primary"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
        <button
          onClick={() => {
            clearAdminToken();
            setToken('');
            setOverview(null);
          }}
          aria-label="Lock dashboard"
          className="p-2 rounded-full border border-border text-muted-foreground hover:text-rose-600"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {warnings.length > 0 && (
        <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 space-y-1.5">
          {warnings.map((warning) => (
            <p key={warning} className="text-[10px] leading-relaxed text-amber-900 flex gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {warning}
            </p>
          ))}
        </div>
      )}

      {error && (
        <p className="text-[10px] leading-relaxed text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-3">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-[10px] leading-relaxed text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" /> {notice}
        </p>
      )}

      <Section
        title="Providers and models"
        hint="Manage providers and models, assign models by feature, validate the selection, and restore the last configuration. Keys stay server-side."
        icon={<Brain className="w-4 h-4" />}
      >
        <div className="space-y-2">
          {overview.providers.map((provider) => {
            const test = tests[provider.id];
            return (
              <div key={provider.id} className="p-3 rounded-2xl bg-card border border-border space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="text-[12px] font-bold">{provider.label}</h3>
                      {provider.isPrimary && (
                        <span className="text-[8px] font-black uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                          Primary
                        </span>
                      )}
                      {provider.isBackup && (
                        <span className="text-[8px] font-black uppercase tracking-wider bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                          Backup
                        </span>
                      )}
                    </div>
                    <p className="text-[9px] text-muted-foreground mt-0.5">
                      {provider.keyPresent ? 'Key set on server' : 'No key on server'}
                      {provider.pinnedProvider ? ` · pinned to ${provider.pinnedProvider}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={cn(
                        'w-2 h-2 rounded-full',
                        provider.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/30',
                      )}
                      aria-hidden
                    />
                    <button
                      onClick={() =>
                        setProviderDraft((current) => ({ ...current, [provider.id]: !current[provider.id] }))
                      }
                      aria-pressed={Boolean(providerDraft[provider.id])}
                      aria-label={`Enable ${provider.label}`}
                      disabled={!provider.keyPresent}
                      className={cn(
                        'w-11 h-6 rounded-full transition-all relative shrink-0',
                        providerDraft[provider.id] ? 'bg-primary' : 'bg-muted',
                        !provider.keyPresent && 'opacity-40',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-1 w-4 h-4 rounded-full bg-card transition-all',
                          providerDraft[provider.id] ? 'left-6' : 'left-1',
                        )}
                      />
                    </button>
                  </div>
                </div>

                {provider.disabledReason && (
                  <p className="text-[9px] leading-relaxed text-muted-foreground">{provider.disabledReason}</p>
                )}

                <div className="space-y-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                    Models
                  </span>
                  {provider.models.length === 0 ? (
                    <p className="text-[9px] text-muted-foreground">None configured.</p>
                  ) : (
                    provider.models.map((model) => {
                      const ref = `${provider.id}:${model.id}`;
                      const enabled = modelEnabledDraft[ref] !== false;
                      const environmentLocked = model.disabledBy === 'environment';
                      return (
                        <div
                          key={ref}
                          className="flex items-center justify-between gap-2 rounded-xl border border-border/70 px-2 py-1.5"
                        >
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold truncate">
                              {model.label}{' '}
                              <span className="font-mono text-[8px] text-muted-foreground">{model.id}</span>
                            </p>
                            <p
                              className={cn(
                                'text-[8px] leading-relaxed',
                                model.price ? 'text-muted-foreground' : 'text-amber-700',
                              )}
                            >
                              {model.price
                                ? `$${model.price.inputPerMillion.toFixed(2)}/M in · $${model.price.outputPerMillion.toFixed(2)}/M out`
                                : 'Pricing not configured'}
                              {environmentLocked ? ' · disabled by environment' : ''}
                            </p>
                          </div>
                          <label className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-muted-foreground shrink-0">
                            <input
                              type="checkbox"
                              checked={enabled}
                              disabled={environmentLocked || !providerDraft[provider.id]}
                              onChange={(event) =>
                                setModelEnabledDraft((current) => ({
                                  ...current,
                                  [ref]: event.target.checked,
                                }))
                              }
                              aria-label={`Enable ${model.label}`}
                              className="accent-primary"
                            />
                            {enabled ? 'On' : 'Off'}
                          </label>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => void runTest(provider.id)}
                    disabled={!provider.keyPresent || testing === provider.id}
                    className="px-2.5 py-1.5 rounded-lg border border-border text-[9px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary disabled:opacity-40"
                  >
                    {testing === provider.id ? 'Testing...' : 'Test connection'}
                  </button>
                  {test && (
                    <p
                      className={cn(
                        'text-[9px] leading-snug text-right',
                        test.ok ? 'text-emerald-700' : 'text-rose-600',
                      )}
                    >
                      {test.ok
                        ? `OK · ${test.latencyMs}ms · ${test.modelsAvailable || 0} models`
                        : test.error || 'Failed'}
                    </p>
                  )}
                </div>

                {test?.ok && test.configuredModels && test.configuredModels.some((entry) => !entry.available) && (
                  <p className="text-[9px] text-amber-800 leading-relaxed">
                    Not in the provider list:{' '}
                    {test.configuredModels
                      .filter((entry) => !entry.available)
                      .map((entry) => entry.id)
                      .join(', ')}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-3 rounded-2xl bg-card border border-border space-y-2.5">
          <label className="block space-y-1">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              Primary model
            </span>
            <select
              value={defaultDraft}
              onChange={(event) => setDefaultDraft(event.target.value)}
              aria-label="Primary model"
              className="w-full px-2.5 py-2 rounded-xl bg-background border border-border text-[11px]"
            >
              <option value="">Automatic (first enabled)</option>
              {modelOptions.map((option) => (
                <option key={option.ref} value={option.ref} disabled={!option.enabled}>
                  {option.label}{option.enabled ? '' : ' (disabled)'}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {fallbackDrafts.map((value, index) => (
              <label key={index} className="block space-y-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  Fallback {index + 1}
                </span>
                <select
                  value={value}
                  onChange={(event) =>
                    setFallbackDrafts((current) =>
                      current.map((entry, slot) => (slot === index ? event.target.value : entry)),
                    )
                  }
                  aria-label={`Fallback model ${index + 1}`}
                  className="w-full px-2 py-2 rounded-xl bg-background border border-border text-[10px]"
                >
                  <option value="">{index === 0 ? 'Automatic' : 'None'}</option>
                  {modelOptions.map((option) => (
                    <option key={option.ref} value={option.ref} disabled={!option.enabled}>
                      {option.label}{option.enabled ? '' : ' (disabled)'}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="space-y-2 border-t border-border pt-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              Feature assignments
            </p>
            {Object.keys(overview.featureModels || {}).map((feature) => (
              <label key={feature} className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold">
                  {AI_FEATURE_LABELS[feature] || feature}
                </span>
                <select
                  value={featureModelDraft[feature] ?? ''}
                  onChange={(event) =>
                    setFeatureModelDraft((current) => ({ ...current, [feature]: event.target.value }))
                  }
                  aria-label={`Model for ${AI_FEATURE_LABELS[feature] || feature}`}
                  className="max-w-[58%] px-2 py-1.5 rounded-lg bg-background border border-border text-[10px]"
                >
                  <option value="">Use primary model</option>
                  {modelOptions.map((option) => (
                    <option key={option.ref} value={option.ref} disabled={!option.enabled}>
                      {option.label}{option.enabled ? '' : ' (disabled)'}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="text-[9px] text-muted-foreground leading-relaxed">
            The assistant tries the feature model, then the primary, then fallbacks in order. An empty
            feature assignment keeps using the primary. Switching clears cached replies.
          </p>
          {settingsTest && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2">
              <p className="text-[9px] font-bold text-emerald-800">Configuration valid; no live AI request was sent.</p>
              <p className="text-[9px] text-emerald-700 break-words">
                Effective order: {settingsTest.chain.length > 0 ? settingsTest.chain.join(' → ') : 'automatic fallback'}
              </p>
              {Object.entries(settingsTest.featureChains || {})
                .filter(([feature, chain]) => chain.length > 0 && chain[0] !== settingsTest.chain[0])
                .map(([feature, chain]) => (
                  <p key={feature} className="text-[9px] text-emerald-700 break-words">
                    {AI_FEATURE_LABELS[feature] || feature}: {chain.join(' → ')}
                  </p>
                ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => void testSettings()}
              disabled={testingSettings || saving}
              className="py-2.5 rounded-xl border border-border text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary disabled:opacity-40"
            >
              {testingSettings ? 'Testing...' : 'Test configuration'}
            </button>
            <button
              onClick={saveProviders}
              disabled={saving || testingSettings}
              className="py-2.5 rounded-xl bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
          <button
            onClick={() => void restoreSettings()}
            disabled={!overview.restore.available || restoring || saving}
            className="w-full py-2 rounded-xl border border-amber-300 text-[9px] font-black uppercase tracking-widest text-amber-800 disabled:opacity-40"
          >
            {restoring
              ? 'Restoring...'
              : overview.restore.available
                ? `Restore previous configuration${overview.restore.previousAt ? ` (${new Date(overview.restore.previousAt).toLocaleString()})` : ''}`
                : 'No previous configuration to restore'}
          </button>
        </div>
      </Section>

      <Section
        title="Live overview"
        hint="Aggregated directly from Supabase. Actual spend excludes estimated usage; active users are shown only when app activity is recorded."
        icon={<TrendingUp className="w-4 h-4" />}
      >
        {supabaseLoading ? (
          <div className="p-3 rounded-2xl bg-card border border-border flex items-center gap-2 text-[10px] text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Loading live statistics...
          </div>
        ) : supabaseError ? (
          <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 space-y-2">
            <p className="text-[10px] leading-relaxed text-rose-700">{supabaseError}</p>
            <button
              type="button"
              onClick={() => void loadSupabaseStats(token)}
              className="px-2.5 py-1.5 rounded-lg border border-rose-300 text-[9px] font-black uppercase tracking-widest text-rose-700"
            >
              Retry statistics
            </button>
          </div>
        ) : supabaseOverview ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Registered users" value={compact(supabaseOverview.users.total)} />
              <Stat
                label="Active today"
                value={liveCount(supabaseOverview.users.activeToday)}
                note={supabaseOverview.users.activity.available ? 'recorded app activity' : 'activity not recorded'}
              />
              <Stat
                label="Active last 30 days"
                value={liveCount(supabaseOverview.users.activeLast30Days)}
                note={supabaseOverview.users.activity.available ? 'recorded app activity' : 'activity not recorded'}
              />
              <Stat label="Free users" value={compact(supabaseOverview.users.free)} note="current wallet plan" />
              <Stat
                label="Plus active"
                value={compact(supabaseOverview.users.plusActive)}
                note="verified active subscription"
              />
              <Stat label="Total AI requests" value={compact(supabaseOverview.ai.totalRequests)} />
              <Stat label="Successful AI requests" value={compact(supabaseOverview.ai.successfulRequests)} />
              <Stat
                label="Failed AI requests"
                value={compact(supabaseOverview.ai.failedRequests)}
                tone={supabaseOverview.ai.failedRequests > 0 ? 'warn' : 'normal'}
              />
              <Stat label="Credits used" value={compact(supabaseOverview.ai.creditsUsed)} note="successful requests" />
              <Stat
                label="Actual spend today"
                value={aud(supabaseOverview.ai.actualSpendTodayAud)}
                note="provider-reported, excluding estimates"
              />
              <Stat
                label="Actual spend this month"
                value={aud(supabaseOverview.ai.actualSpendMonthAud)}
                note="provider-reported, excluding estimates"
              />
              <Stat
                label="Estimated spend today"
                value={aud(supabaseOverview.ai.estimatedSpendTodayAud)}
                note="estimated usage only"
              />
              <Stat
                label="Estimated spend this month"
                value={aud(supabaseOverview.ai.estimatedSpendMonthAud)}
                note="estimated usage only"
              />
            </div>

            <div className="p-3 rounded-2xl bg-card border border-border space-y-1.5">
              <p className="text-[9px] leading-relaxed text-muted-foreground">
                Actual and estimated spend are shown separately and are never added together. Actual
                means the provider reported exact billing usage; estimated means the provider did
                not return a usage block.
              </p>
              <p className="text-[9px] leading-relaxed text-muted-foreground">
                Source: Supabase · updated{' '}
                {new Date(supabaseOverview.generatedAt).toLocaleTimeString()}
              </p>
              {!supabaseOverview.users.activity.available && (
                <p className="text-[9px] leading-relaxed text-amber-800">
                  Active users unavailable: {supabaseOverview.users.activity.reason}
                </p>
              )}
            </div>
          </>
        ) : null}
      </Section>

      <Section
        title="Usage"
        hint="Counts and estimated cost. No message text is stored or shown."
        icon={<BarChart3 className="w-4 h-4" />}
      >
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Requests today" value={compact(usage.today.requests)} note={`${limits.requestsPerDay} daily limit`} />
          <Stat label="Requests this month" value={compact(usage.thisMonth.requests)} />
          <Stat
            label="Tokens this month"
            value={compact(usage.thisMonth.inputTokens + usage.thisMonth.outputTokens)}
            note={`${compact(usage.today.inputTokens + usage.today.outputTokens)} today`}
          />
          <Stat
            label="Estimated cost (AUD)"
            value={aud(usage.thisMonth.costAud)}
            note={`of ${aud(limits.monthlyBudgetAud)} monthly`}
            tone={ratio(usage.thisMonth.costAud, limits.monthlyBudgetAud) >= 0.8 ? 'warn' : 'normal'}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Stat label="Total requests" value={compact(usage.totals.requests)} note="all recorded requests" />
          <Stat label="Total credits" value={compact(usage.totals.credits)} note="consumed" />
          <Stat label="Total API cost (AUD)" value={aud(usage.totals.costAud)} note="provider-reported usage" />
          <Stat
            label="Failed requests"
            value={compact(usage.totals.failedRequests)}
            tone={usage.totals.failedRequests > 0 ? 'warn' : 'normal'}
          />
          <Stat label="Today (AUD)" value={aud(usage.today.costAud)} note={`${compact(usage.today.requests)} requests`} />
          <Stat label="This month (AUD)" value={aud(usage.thisMonth.costAud)} note={`${compact(usage.thisMonth.requests)} requests`} />
          <Stat label="Avg cost / request (AUD)" value={aud(usage.totals.averageCostPerRequestAud)} />
          <Stat label="Avg cost / user (AUD)" value={aud(usage.totals.averageCostPerUserAud)} note={`${usage.totals.trackedUsers} users`} />
        </div>

        <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
            Requests over the last 14 days
          </p>
          {history.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">No usage recorded yet.</p>
          ) : (
            <div className="flex items-end gap-1 h-16" aria-label="Request trend">
              {history.map((row) => (
                <div key={row.date} className="flex-1 flex flex-col items-center gap-1" title={`${row.date}: ${row.requests} requests`}>
                  <div
                    className="w-full rounded-t bg-primary/60"
                    style={{ height: `${Math.max(2, Math.round((row.requests / peak) * 56))}px` }}
                  />
                  <span className="text-[7px] text-muted-foreground">{row.date.slice(8)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">By provider</p>
          {Object.keys(usage.byProvider).length === 0 ? (
            <p className="text-[10px] text-muted-foreground">Nothing yet.</p>
          ) : (
            Object.entries(usage.byProvider).map(([id, totals]) => (
              <div key={id} className="flex items-center justify-between gap-2 text-[10px]">
                <span className="font-semibold">{providerLabel(id)}</span>
                <span className="text-muted-foreground">
                  {compact(totals.requests)} req · {compact(totals.inputTokens + totals.outputTokens)} tok ·{' '}
                  {aud(totals.costAud)}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">By model</p>
          {Object.keys(usage.byModel).length === 0 ? (
            <p className="text-[10px] text-muted-foreground">Nothing yet.</p>
          ) : (
            Object.entries(usage.byModel).map(([ref, totals]) => (
              <div key={ref} className="flex items-center justify-between gap-2 text-[10px]">
                <span className="font-semibold truncate">{ref}</span>
                <span className="text-muted-foreground shrink-0">
                  {compact(totals.requests)} req · {aud(totals.costAud)}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
            Free vs Plus
          </p>
          {Object.keys(usage.byPlan).length === 0 ? (
            <p className="text-[10px] text-muted-foreground">Nothing yet.</p>
          ) : (
            Object.entries(usage.byPlan).map(([plan, totals]) => (
              <div key={plan} className="flex items-center justify-between gap-2 text-[10px]">
                <span className="font-semibold capitalize">{plan}</span>
                <span className="text-muted-foreground">
                  {compact(totals.requests)} req · {compact(totals.credits || 0)} credits · {aud(totals.costAud)}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
            Most expensive actions
          </p>
          {Object.keys(usage.byAction).length === 0 ? (
            <p className="text-[10px] text-muted-foreground">Nothing yet.</p>
          ) : (
            Object.entries(usage.byAction)
              .sort(([, a], [, b]) => b.costAud - a.costAud)
              .slice(0, 6)
              .map(([key, totals]) => (
                <div key={key} className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="font-semibold truncate">{key.replace(/_/g, ' ')}</span>
                  <span className="text-muted-foreground shrink-0">
                    {aud(totals.costAud)} · {compact(totals.credits || 0)} cr
                  </span>
                </div>
              ))
          )}
        </div>

        <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
            Most active users
          </p>
          {Object.keys(usage.byUser).length === 0 ? (
            <p className="text-[10px] text-muted-foreground">Nothing yet.</p>
          ) : (
            Object.entries(usage.byUser)
              .sort(([, a], [, b]) => (b.allTime.requests || 0) - (a.allTime.requests || 0))
              .slice(0, 6)
              .map(([key, entry]) => (
                <div key={key} className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="font-mono text-[9px] truncate">{key.slice(0, 12)}...</span>
                  <span className="text-muted-foreground shrink-0">
                    {compact(entry.allTime.requests)} req · {compact(entry.allTime.credits || 0)} cr
                  </span>
                </div>
              ))
          )}
        </div>

        <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
            Recent failed requests
          </p>
          {usage.recentRequests.filter((entry) => entry.status === 'failed').length === 0 ? (
            <p className="text-[10px] text-muted-foreground">No failed requests recorded.</p>
          ) : (
            usage.recentRequests
              .filter((entry) => entry.status === 'failed')
              .slice(0, 6)
              .map((entry) => (
                <div key={`${entry.requestId}-${entry.timestamp}`} className="flex items-center justify-between gap-2 text-[9px]">
                  <span className="truncate">
                    {entry.action.replace(/_/g, ' ')} · {entry.provider}/{entry.model}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {new Date(entry.timestamp).toLocaleDateString()}
                  </span>
                </div>
              ))
          )}
        </div>
      </Section>

      <Section
        title="User activity & security monitoring"
        hint="Searchable account activity, advisory alerts and investigation notes. Rules are basic thresholds or estimates; nothing here suspends, bans or changes a user."
        icon={<ShieldCheck className="w-4 h-4" />}
      >
        <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              Activity filters
            </p>
            <button
              type="button"
              onClick={() => setMonitoringRefresh((value) => value + 1)}
              disabled={monitoringLoading}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-[8px] font-black uppercase tracking-widest text-muted-foreground disabled:opacity-40"
            >
              <RefreshCw className={cn('w-3 h-3', monitoringLoading && 'animate-spin')} />
              Refresh
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Date range</span>
              <select
                value={monitoringPreset}
                onChange={(event) => setMonitoringPreset(event.target.value as AdminAnalyticsPreset)}
                className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[10px]"
              >
                <option value="today">Today (UTC)</option>
                <option value="last7">Last 7 days</option>
                <option value="last30">Last 30 days</option>
                <option value="month">This month (UTC)</option>
                <option value="custom">Custom range</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Alert severity</span>
              <select
                value={monitoringSeverity}
                onChange={(event) => setMonitoringSeverity(event.target.value as AdminMonitoringSeverity | '')}
                className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[10px]"
              >
                <option value="">All severities</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Review status</span>
              <select
                value={monitoringAlertStatus}
                onChange={(event) => setMonitoringAlertStatus(event.target.value as AdminMonitoringAlertStatus | '')}
                className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[10px]"
              >
                <option value="">All alerts</option>
                <option value="open">Open</option>
                <option value="reviewed">Reviewed</option>
              </select>
            </label>
            <div className="space-y-1">
              <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Search accounts</span>
              <div className="flex gap-1">
                <input
                  value={monitoringSearchDraft}
                  onChange={(event) => setMonitoringSearchDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setMonitoringSearch(monitoringSearchDraft.trim());
                  }}
                  placeholder="Name or account id"
                  className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[10px]"
                />
                <button
                  type="button"
                  onClick={() => setMonitoringSearch(monitoringSearchDraft.trim())}
                  className="px-2 rounded-lg border border-border text-[8px] font-black uppercase text-muted-foreground"
                >
                  Find
                </button>
              </div>
            </div>
            {monitoringPreset === 'custom' && (
              <>
                <label className="space-y-1">
                  <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground">From (UTC)</span>
                  <input
                    type="date"
                    value={monitoringFrom}
                    onChange={(event) => setMonitoringFrom(event.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[10px]"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground">To (UTC)</span>
                  <input
                    type="date"
                    value={monitoringTo}
                    onChange={(event) => setMonitoringTo(event.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[10px]"
                  />
                </label>
              </>
            )}
          </div>
          {monitoring?.source === 'local' && (
            <p className="text-[9px] leading-relaxed text-amber-800">
              Local records are shown because Supabase is not configured. The local ledger keeps only recent request detail.
            </p>
          )}
          {monitoringNotice && (
            <p className="text-[9px] leading-relaxed text-emerald-700">{monitoringNotice}</p>
          )}
          {monitoringError && (
            <p className="text-[9px] leading-relaxed text-rose-700">{monitoringError}</p>
          )}
        </div>

        {monitoringLoading ? (
          <div className="p-3 rounded-2xl bg-card border border-border flex items-center gap-2 text-[10px] text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Loading activity records...
          </div>
        ) : monitoring ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="Registered accounts" value={compact(monitoring.summary.totalAccounts)} note="all profiles" />
              <Stat label="Active in range" value={compact(monitoring.summary.activeInRange)} note="recorded activity" />
              <Stat label="Active today" value={compact(monitoring.summary.activeToday)} note="UTC" />
              <Stat label="Plus active" value={compact(monitoring.summary.plusActive)} />
              <Stat label="AI requests" value={compact(monitoring.summary.totalRequests)} note="in range" />
              <Stat label="Failed requests" value={compact(monitoring.summary.failedRequests)} tone={monitoring.summary.failedRequests > 0 ? 'warn' : 'normal'} />
              <Stat label="Credits spent" value={compact(monitoring.summary.creditsSpent)} note="successful requests" />
              <Stat label="Open alerts" value={compact(monitoring.summary.alertsOpen)} tone={monitoring.summary.highSeverityOpen > 0 ? 'bad' : monitoring.summary.alertsOpen > 0 ? 'warn' : 'normal'} note={`${monitoring.summary.highSeverityOpen} high severity`} />
            </div>

            <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  Alerts ({monitoring.alerts.length})
                </p>
                <p className="text-[8px] text-muted-foreground">Reviewed: {monitoring.summary.alertsReviewed}</p>
              </div>
              {monitoring.alerts.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">No alerts match these filters.</p>
              ) : (
                monitoring.alerts.map((alert) => (
                  <div key={alert.key} className={cn('rounded-xl border p-2.5 space-y-1.5', alert.status === 'reviewed' ? 'border-border bg-background/50' : alert.severity === 'high' ? 'border-rose-300 bg-rose-50/50' : 'border-amber-200 bg-amber-50/40')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black truncate">{alert.ruleLabel}</p>
                        <p className="text-[8px] text-muted-foreground">
                          {alert.displayName} · {alert.userShortId} · {alert.plan}
                        </p>
                      </div>
                      <span className={cn('shrink-0 px-1.5 py-0.5 rounded-md text-[7px] font-black uppercase tracking-wider', alert.severity === 'high' ? 'bg-rose-200 text-rose-800' : alert.severity === 'medium' ? 'bg-amber-200 text-amber-800' : 'bg-slate-200 text-slate-700')}>
                        {alert.severity}
                      </span>
                    </div>
                    <p className="text-[9px] leading-relaxed">{alert.message}</p>
                    <p className="text-[8px] text-muted-foreground leading-relaxed">
                      {alert.kind === 'estimate' ? 'Estimate' : 'Basic threshold'} · {alert.evidence}
                    </p>
                    {alert.relatedRequests.length > 0 && (
                      <p className="text-[8px] text-muted-foreground break-all">
                        Related requests: {alert.relatedRequests.map((request) => request.requestId).join(', ')}
                      </p>
                    )}
                    <p className="text-[8px] text-muted-foreground">
                      {alert.status === 'reviewed' ? `Reviewed ${alert.reviewedAt ? new Date(alert.reviewedAt).toLocaleString() : ''}` : 'Open'}
                      {alert.reviewedBy ? ` · ${alert.reviewedBy.slice(0, 16)}` : ''}
                    </p>
                    {alert.note && (
                      <p className="text-[9px] rounded-lg bg-background border border-border p-1.5 whitespace-pre-wrap break-words">
                        {alert.note}
                      </p>
                    )}
                    <textarea
                      value={monitoringNotes[alert.key] ?? alert.note ?? ''}
                      onChange={(event) => setMonitoringNotes((notes) => ({ ...notes, [alert.key]: event.target.value }))}
                      placeholder="Investigation note (no passwords, tokens or journal content)"
                      maxLength={1000}
                      rows={2}
                      className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[9px] resize-y"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void reviewMonitoringAlert(alert, 'reviewed')}
                        disabled={monitoringBusy === alert.key}
                        className="px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-[8px] font-black uppercase tracking-widest disabled:opacity-40"
                      >
                        {monitoringBusy === alert.key ? 'Saving...' : alert.status === 'reviewed' ? 'Update note' : 'Mark reviewed'}
                      </button>
                      {alert.status === 'reviewed' && (
                        <button
                          type="button"
                          onClick={() => void reviewMonitoringAlert(alert, 'open')}
                          disabled={monitoringBusy === alert.key}
                          className="px-2.5 py-1.5 rounded-lg border border-border text-[8px] font-black uppercase tracking-widest text-muted-foreground disabled:opacity-40"
                        >
                          Reopen
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                Accounts ({monitoring.totalUsers})
              </p>
              {monitoring.users.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">No accounts match this search.</p>
              ) : (
                monitoring.users.map((user) => (
                  <div key={user.userId} className="rounded-xl border border-border p-2 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black truncate">{user.displayName}</p>
                        <p className="text-[8px] text-muted-foreground">{user.userShortId} · {user.planLabel} · {user.subscriptionStatus}</p>
                      </div>
                      {user.highestSeverity && (
                        <span className={cn('shrink-0 px-1.5 py-0.5 rounded-md text-[7px] font-black uppercase', user.highestSeverity === 'high' ? 'bg-rose-200 text-rose-800' : 'bg-amber-200 text-amber-800')}>
                          {user.alerts} alert{user.alerts === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-2 gap-y-1 text-[8px] text-muted-foreground">
                      <span>Created: {utcDate(user.accountCreatedAt)}</span>
                      <span>Last activity: {user.lastActivityAt ? utcDateTime(user.lastActivityAt) : 'None recorded'}</span>
                      <span>Requests: {compact(user.requests)} ({compact(user.failedRequests)} failed)</span>
                      <span>Credits spent: {compact(user.creditsSpent)} · {aud(user.spendAud)}</span>
                      <span>Balance: {user.balance === null ? 'No wallet' : compact(user.balance)}</span>
                      <span>Recent transactions: {user.recentTransactions.length}</span>
                    </div>
                    {user.recentTransactions.length > 0 && (
                      <p className="text-[8px] text-muted-foreground break-all">
                        {user.recentTransactions.map((transaction) => `${transaction.kind} ${transaction.creditsDelta > 0 ? '+' : ''}${transaction.creditsDelta}`).join(' · ')}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="p-3 rounded-2xl bg-card border border-border space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                Recent credit transactions
              </p>
              {monitoring.recentTransactions.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">No credit transactions recorded in this range.</p>
              ) : (
                monitoring.recentTransactions.slice(0, 12).map((transaction) => (
                  <div key={transaction.id} className="flex items-center justify-between gap-2 text-[8px]">
                    <span className="truncate">{transaction.userShortId} · {transaction.kind}{transaction.reason ? ` · ${transaction.reason}` : ''}</span>
                    <span className={transaction.creditsDelta >= 0 ? 'text-emerald-700 shrink-0' : 'text-muted-foreground shrink-0'}>
                      {transaction.creditsDelta > 0 ? '+' : ''}{transaction.creditsDelta} · {utcDate(transaction.createdAt)}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="p-3 rounded-2xl bg-card border border-border space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                Detection rules and limits
              </p>
              {monitoring.rules.map((rule) => (
                <div key={rule.key} className="text-[8px] leading-relaxed">
                  <span className={cn('font-black', rule.available ? 'text-foreground' : 'text-amber-800')}>
                    {rule.label}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    · {rule.kind === 'threshold' ? 'basic threshold' : rule.kind === 'estimate' ? 'estimate' : 'unavailable'} · {rule.threshold}
                  </span>
                </div>
              ))}
              {monitoring.limitations.map((limitation) => (
                <p key={limitation} className="text-[8px] text-muted-foreground leading-relaxed">{limitation}</p>
              ))}
              <p className="text-[8px] text-emerald-700 leading-relaxed">
                No automatic suspension or ban is applied. All reviews and notes are administrator actions in the audit log.
              </p>
            </div>
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground">No activity records loaded.</p>
        )}
      </Section>

      <Section
        title="AI usage & spending"
        hint="Aggregated request, credit and cost records from Supabase. Actual and estimated spend are kept separate; reserved spend is never added to either."
        icon={<BarChart3 className="w-4 h-4" />}
      >
        <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              Filters
            </p>
            <button
              type="button"
              onClick={() => void loadAnalytics(token)}
              disabled={analyticsLoading}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-[8px] font-black uppercase tracking-widest text-muted-foreground disabled:opacity-40"
            >
              <RefreshCw className={cn('w-3 h-3', analyticsLoading && 'animate-spin')} />
              Refresh
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                Date range
              </span>
              <select
                value={analyticsPreset}
                onChange={(event) => {
                  setAnalyticsPreset(event.target.value as AdminAnalyticsPreset);
                  setAnalyticsPage(0);
                }}
                className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[10px]"
              >
                <option value="today">Today (UTC)</option>
                <option value="last7">Last 7 days</option>
                <option value="last30">Last 30 days</option>
                <option value="month">This month (UTC)</option>
                <option value="custom">Custom range</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                Provider
              </span>
              <select
                value={analyticsProvider}
                onChange={(event) => {
                  setAnalyticsProvider(event.target.value);
                  setAnalyticsPage(0);
                }}
                className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[10px]"
              >
                <option value="">All providers</option>
                {(analytics?.filters.options.providers ?? []).map((provider) => (
                  <option key={provider} value={provider}>
                    {providerLabel(provider)}
                  </option>
                ))}
                {analyticsProvider &&
                  !(analytics?.filters.options.providers ?? []).includes(analyticsProvider) && (
                    <option value={analyticsProvider}>{providerLabel(analyticsProvider)}</option>
                  )}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                Model
              </span>
              <select
                value={analyticsModel}
                onChange={(event) => {
                  setAnalyticsModel(event.target.value);
                  setAnalyticsPage(0);
                }}
                className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[10px]"
              >
                <option value="">All models</option>
                {(analytics?.filters.options.models ?? []).map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
                {analyticsModel &&
                  !(analytics?.filters.options.models ?? []).includes(analyticsModel) && (
                    <option value={analyticsModel}>{analyticsModel}</option>
                  )}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                Feature / action
              </span>
              <select
                value={analyticsAction}
                onChange={(event) => {
                  setAnalyticsAction(event.target.value);
                  setAnalyticsPage(0);
                }}
                className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[10px]"
              >
                <option value="">All features</option>
                {(analytics?.filters.options.actions ?? []).map((action) => (
                  <option key={action} value={action}>
                    {action.replace(/_/g, ' ')}
                  </option>
                ))}
                {analyticsAction &&
                  !(analytics?.filters.options.actions ?? []).includes(analyticsAction) && (
                    <option value={analyticsAction}>{analyticsAction.replace(/_/g, ' ')}</option>
                  )}
              </select>
            </label>
          </div>
          {analyticsPreset === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                  From
                </span>
                <input
                  type="date"
                  value={analyticsFrom}
                  onChange={(event) => {
                    setAnalyticsFrom(event.target.value);
                    setAnalyticsPage(0);
                  }}
                  className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[10px]"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                  To
                </span>
                <input
                  type="date"
                  value={analyticsTo}
                  onChange={(event) => {
                    setAnalyticsTo(event.target.value);
                    setAnalyticsPage(0);
                  }}
                  className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[10px]"
                />
              </label>
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="search"
              value={analyticsSearchDraft}
              onChange={(event) => setAnalyticsSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setAnalyticsSearch(analyticsSearchDraft.trim());
                  setAnalyticsPage(0);
                }
              }}
              placeholder="Search request ID, user, model or feature"
              aria-label="Search usage history"
              className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-background border border-border text-[10px]"
            />
            <button
              type="button"
              onClick={() => {
                setAnalyticsSearch(analyticsSearchDraft.trim());
                setAnalyticsPage(0);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-[8px] font-black uppercase tracking-widest"
            >
              Search
            </button>
            {(analyticsSearch ||
              analyticsProvider ||
              analyticsModel ||
              analyticsAction ||
              analyticsSearchDraft) && (
              <button
                type="button"
                onClick={() => {
                  setAnalyticsSearch('');
                  setAnalyticsSearchDraft('');
                  setAnalyticsProvider('');
                  setAnalyticsModel('');
                  setAnalyticsAction('');
                  setAnalyticsPage(0);
                }}
                className="px-2 py-1.5 rounded-lg border border-border text-[8px] font-black uppercase tracking-widest text-muted-foreground"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-[9px] leading-relaxed text-muted-foreground">
            Day boundaries and displayed dates use UTC. Provider, model and feature filters apply
            to requests, spend, breakdowns and history. Reserved spend is shown across all traffic.
          </p>
        </div>

        {analyticsLoading ? (
          <div className="p-3 rounded-2xl bg-card border border-border flex items-center gap-2 text-[10px] text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Loading usage analytics...
          </div>
        ) : analyticsError ? (
          <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 space-y-2">
            <p className="text-[10px] leading-relaxed text-rose-700">{analyticsError}</p>
            <button
              type="button"
              onClick={() => void loadAnalytics(token)}
              className="px-2.5 py-1.5 rounded-lg border border-rose-300 text-[9px] font-black uppercase tracking-widest text-rose-700"
            >
              Retry analytics
            </button>
          </div>
        ) : analytics ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Total requests" value={compact(analytics.summary.totalRequests)} />
              <Stat
                label="Successful"
                value={compact(analytics.summary.successfulRequests)}
              />
              <Stat
                label="Failed"
                value={compact(analytics.summary.failedRequests)}
                tone={analytics.summary.failedRequests > 0 ? 'warn' : 'normal'}
              />
              <Stat
                label="Cancelled"
                value={
                  analytics.summary.cancelledAvailable
                    ? compact(analytics.summary.cancelledRequests ?? 0)
                    : 'Not tracked'
                }
                note={
                  analytics.summary.cancelledAvailable
                    ? 'recorded cancellations'
                    : analytics.summary.cancelledReason
                }
              />
              <Stat label="Credits used" value={compact(analytics.summary.creditsUsed)} note="successful requests" />
              <Stat
                label="Average cost / request"
                value={aud(analytics.summary.averageCostPerRequestAud)}
                note={`${aud(analytics.summary.averageActualCostPerRequestAud)} actual only`}
              />
              <Stat
                label="Actual spend today"
                value={aud(analytics.summary.actualSpendTodayAud)}
                note="provider-reported"
              />
              <Stat
                label="Actual spend this month"
                value={aud(analytics.summary.actualSpendMonthAud)}
                note="provider-reported"
              />
              <Stat
                label="Estimated spend (range)"
                value={aud(analytics.summary.estimatedSpendAud)}
                note="estimated usage only"
              />
              <Stat
                label="Estimated spend today"
                value={aud(analytics.summary.estimatedSpendTodayAud)}
                note="estimated usage only"
              />
              <Stat
                label="Estimated spend this month"
                value={aud(analytics.summary.estimatedSpendMonthAud)}
                note="estimated usage only"
              />
              <Stat
                label="Reserved now"
                value={aud(analytics.summary.reservedAud)}
                note={
                  analytics.summary.uncertainReservedAud > 0
                    ? `${aud(analytics.summary.uncertainReservedAud)} uncertain`
                    : 'held, not settled spend'
                }
              />
            </div>

            <div className="p-3 rounded-2xl bg-card border border-border space-y-1.5">
              <p className="text-[9px] leading-relaxed text-muted-foreground">
                Actual spend is the sum of settled requests where the provider returned exact
                billing usage. Estimated spend covers requests without an exact usage block and is
                labeled separately. Reserved spend is an in-flight hold and is never added to
                actual or estimated spend.
              </p>
              <p className="text-[9px] leading-relaxed text-muted-foreground">
                Range: {utcDate(analytics.range.from)} –{' '}
                {utcDate(new Date(new Date(analytics.range.to).getTime() - 1))} · source:
                Supabase · updated {new Date(analytics.generatedAt).toLocaleTimeString()}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  AI spending over time (AUD)
                </p>
                <AnalyticsBars
                  points={analytics.timeseries}
                  value={(point) => point.costAud}
                  title={(point) =>
                    `${point.day}: ${aud(point.costAud)} total · ${aud(point.actualCostAud)} actual · ${aud(point.estimatedCostAud)} estimated`
                  }
                />
              </div>
              <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  AI requests over time
                </p>
                <AnalyticsBars
                  points={analytics.timeseries}
                  value={(point) => point.requests}
                  title={(point) =>
                    `${point.day}: ${point.requests} total · ${point.successful} successful · ${point.failed} failed`
                  }
                  tone="emerald"
                />
              </div>
              <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  Credit usage over time
                </p>
                <AnalyticsBars
                  points={analytics.timeseries}
                  value={(point) => point.credits}
                  title={(point) => `${point.day}: ${point.credits} credits`}
                  tone="amber"
                />
              </div>
              <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  Successful versus failed
                </p>
                {analytics.summary.totalRequests === 0 ? (
                  <p className="text-[10px] text-muted-foreground">No requests in this range.</p>
                ) : (
                  <>
                    <div className="h-3 rounded-full bg-rose-200 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500"
                        style={{
                          width: `${Math.round(
                            (analytics.summary.successfulRequests / analytics.summary.totalRequests) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="text-emerald-700">
                        {compact(analytics.summary.successfulRequests)} successful
                      </span>
                      <span className="text-rose-700">
                        {compact(analytics.summary.failedRequests)} failed
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  Spending by provider
                </p>
                <AnalyticsBreakdown
                  rows={analytics.byProvider.map((row) => ({
                    label: providerLabel(row.provider || 'unknown'),
                    detail: `${compact(row.requests)} req · ${compact(row.credits)} cr`,
                    requests: row.requests,
                    actualCostAud: row.actualCostAud,
                    estimatedCostAud: row.estimatedCostAud,
                    costAud: row.costAud,
                  }))}
                />
              </div>
              <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  Spending by model
                </p>
                <AnalyticsBreakdown
                  rows={analytics.byModel.map((row) => ({
                    label: row.model || 'unknown',
                    detail: `${providerLabel(row.provider || 'unknown')} · ${compact(row.requests)} req`,
                    requests: row.requests,
                    actualCostAud: row.actualCostAud,
                    estimatedCostAud: row.estimatedCostAud,
                    costAud: row.costAud,
                  }))}
                />
              </div>
              <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  Usage by feature
                </p>
                <AnalyticsBreakdown
                  rows={analytics.byAction.map((row) => ({
                    label: (row.action || 'unknown').replace(/_/g, ' '),
                    detail: `${compact(row.requests)} req · ${compact(row.credits)} cr`,
                    requests: row.requests,
                    actualCostAud: row.actualCostAud,
                    estimatedCostAud: row.estimatedCostAud,
                    costAud: row.costAud,
                  }))}
                />
              </div>
              <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  Usage by user
                </p>
                <AnalyticsBreakdown
                  rows={analytics.byUser.map((row) => ({
                    label: row.userLabel,
                    detail: `${row.userShortId} · ${compact(row.requests)} req`,
                    requests: row.requests,
                    actualCostAud: row.actualCostAud,
                    estimatedCostAud: row.estimatedCostAud,
                    costAud: row.costAud,
                  }))}
                />
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  Usage history
                </p>
                <p className="text-[9px] text-muted-foreground">
                  {compact(analytics.historyTotal)} matching
                </p>
              </div>
              {analytics.history.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">
                  No requests match these filters.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[9px]">
                    <thead>
                      <tr className="text-[8px] uppercase tracking-wider text-muted-foreground">
                        <th className="py-1 pr-2">Request</th>
                        <th className="py-1 pr-2">User</th>
                        <th className="py-1 pr-2">Feature</th>
                        <th className="py-1 pr-2">Model</th>
                        <th className="py-1 pr-2">Provider</th>
                        <th className="py-1 pr-2 text-right">Credits</th>
                        <th className="py-1 pr-2 text-right">Actual cost</th>
                        <th className="py-1 pr-2">Status</th>
                        <th className="py-1">Date / time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.history.map((row) => (
                        <tr
                          key={`${row.userShortId}-${row.requestId}`}
                          className="border-t border-border align-top"
                        >
                          <td className="py-1.5 pr-2 font-mono" title={row.requestId}>
                            {row.requestId.slice(0, 12)}…
                          </td>
                          <td className="py-1.5 pr-2">
                            <span className="block">{row.userLabel}</span>
                            <span className="block text-[8px] text-muted-foreground">{row.userShortId}</span>
                          </td>
                          <td className="py-1.5 pr-2">{row.action.replace(/_/g, ' ')}</td>
                          <td className="py-1.5 pr-2">{row.model}</td>
                          <td className="py-1.5 pr-2">{providerLabel(row.provider)}</td>
                          <td className="py-1.5 pr-2 text-right">{compact(row.credits)}</td>
                          <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                            {aud(row.actualCostAud)}
                            {row.estimated && (
                              <span className="block text-[8px] text-amber-700">
                                est. {aud(row.estimatedCostAud)}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 pr-2">
                            <span
                              className={cn(
                                'inline-flex px-1.5 py-0.5 rounded-full text-[8px] font-bold',
                                row.status === 'success'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-rose-100 text-rose-700',
                              )}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="py-1.5 whitespace-nowrap text-muted-foreground">
                            {utcDateTime(row.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setAnalyticsPage((page) => Math.max(0, page - 1))}
                  disabled={analyticsPage === 0 || analyticsLoading}
                  className="px-2 py-1 rounded-lg border border-border text-[8px] font-black uppercase tracking-widest text-muted-foreground disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-[8px] text-muted-foreground">
                  Page {analyticsPage + 1} of{' '}
                  {Math.max(1, Math.ceil(analytics.historyTotal / 25))}
                </span>
                <button
                  type="button"
                  onClick={() => setAnalyticsPage((page) => page + 1)}
                  disabled={(analyticsPage + 1) * 25 >= analytics.historyTotal || analyticsLoading}
                  className="px-2 py-1 rounded-lg border border-border text-[8px] font-black uppercase tracking-widest text-muted-foreground disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : null}
      </Section>

      <Section
        title="Credit management"
        hint="Supabase credit ledger. Balances change only through audited server operations; every adjustment requires a reason and records before/after balances."
        icon={<Coins className="w-4 h-4" />}
      >
        <div className="space-y-4">
          {managedError && (
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-[10px] text-rose-700 flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{managedError}</span>
            </div>
          )}
          {managedNotice && (
            <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-[10px] text-emerald-800 flex gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{managedNotice}</span>
            </div>
          )}
          {managedLoading && !managedCredits && (
            <p className="text-[10px] text-muted-foreground">Loading Supabase credit settings…</p>
          )}
          {!managedLoading && !managedCredits && (
            <button
              type="button"
              onClick={() => void loadManagedCredits(token, managedSearch, managedPage)}
              className="px-3 py-2 rounded-xl border border-border text-[9px] font-black uppercase tracking-widest"
            >
              Retry credit management
            </button>
          )}

          {managedCredits && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  ['Wallets', managedCredits.summary.wallets.toLocaleString()],
                  ['Held credits', managedCredits.summary.heldCredits.toLocaleString()],
                  ['Allocated', managedCredits.summary.allocatedCredits.toLocaleString()],
                  ['Spent', managedCredits.summary.totalSpentCredits.toLocaleString()],
                ].map(([label, value]) => (
                  <div key={label} className="p-2.5 rounded-xl bg-card border border-border">
                    <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
                    <p className="text-sm font-bold mt-1">{value}</p>
                  </div>
                ))}
              </div>

              <div className="p-3 rounded-2xl bg-card border border-border space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-black">Credit settings</p>
                    <p className="text-[9px] text-muted-foreground">
                      Source: Supabase · updated {utcDateTime(managedCredits.config.updatedAt)}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[8px] font-black uppercase tracking-widest">
                    Live config
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Action costs</p>
                    {managedCredits.config.actions.map((action) => (
                      <label key={action.key} className="flex items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block text-[10px] leading-snug">{action.label}</span>
                          <span className="block text-[8px] text-muted-foreground leading-snug">{action.description}</span>
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={managedActionDrafts[action.key] ?? ''}
                          onChange={(event) =>
                            setManagedActionDrafts((current) => ({ ...current, [action.key]: event.target.value }))
                          }
                          aria-label={`${action.label} credit cost`}
                          className="w-20 px-2 py-1.5 rounded-lg bg-background border border-border text-[11px] text-right"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Plan allocations</p>
                    {managedCredits.config.plans.map((plan) => {
                      const draft = managedPlanDrafts[plan.id] || { creditsPerPeriod: '', periodDays: '' };
                      return (
                        <div key={plan.id} className="rounded-xl border border-border p-2 space-y-2">
                          <p className="text-[10px] font-bold">{plan.label}</p>
                          <label className="flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
                            Credits per period
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={draft.creditsPerPeriod}
                              onChange={(event) =>
                                setManagedPlanDrafts((current) => ({
                                  ...current,
                                  [plan.id]: { ...draft, creditsPerPeriod: event.target.value },
                                }))
                              }
                              aria-label={`${plan.label} credits per period`}
                              className="w-24 px-2 py-1.5 rounded-lg bg-background border border-border text-[11px] text-right text-foreground"
                            />
                          </label>
                          <label className="flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
                            Allocation frequency (days)
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={draft.periodDays}
                              onChange={(event) =>
                                setManagedPlanDrafts((current) => ({
                                  ...current,
                                  [plan.id]: { ...draft, periodDays: event.target.value },
                                }))
                              }
                              aria-label={`${plan.label} allocation frequency in days`}
                              className="w-20 px-2 py-1.5 rounded-lg bg-background border border-border text-[11px] text-right text-foreground"
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="text-[8px] text-muted-foreground leading-relaxed">
                  Allocation changes affect future periods and newly created wallets only. Existing balances are not topped up or reduced. Credits reset at the end of each allocation period; there is no separate expiry or rollover configuration in this ledger.
                </p>
                <button
                  type="button"
                  onClick={() => void saveManagedSettings()}
                  disabled={managedSaving}
                  className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-[9px] font-black uppercase tracking-widest disabled:opacity-50"
                >
                  {managedSaving ? 'Saving…' : 'Save credit settings'}
                </button>
              </div>

              <div className="p-3 rounded-2xl bg-card border border-border space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-black">User credits</p>
                  <span className="text-[9px] text-muted-foreground">{managedCredits.total.toLocaleString()} matching</span>
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setManagedPage(0);
                    setManagedSearch(managedSearchDraft.trim());
                  }}
                >
                  <input
                    type="search"
                    value={managedSearchDraft}
                    onChange={(event) => setManagedSearchDraft(event.target.value)}
                    placeholder="Search name or user UUID"
                    aria-label="Search credit wallets"
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-background border border-border text-[10px]"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 rounded-xl border border-border text-[9px] font-black uppercase tracking-widest"
                  >
                    Search
                  </button>
                  {managedSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setManagedSearchDraft('');
                        setManagedSearch('');
                        setManagedPage(0);
                      }}
                      className="px-2 py-2 rounded-xl border border-border text-[9px] text-muted-foreground"
                    >
                      Clear
                    </button>
                  )}
                </form>

                {managedCredits.users.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">No credit wallets match this search.</p>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {managedCredits.users.map((user) => (
                      <button
                        type="button"
                        key={user.userId}
                        onClick={() => void openManagedUser(user.userId)}
                        className={cn(
                          'text-left p-3 rounded-xl border bg-background space-y-2 hover:border-primary/50',
                          managedUser?.user.userId === user.userId && 'border-primary ring-1 ring-primary/20',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold truncate">{user.displayName || 'Unnamed user'}</p>
                            <p className="text-[8px] font-mono text-muted-foreground break-all">{user.userId}</p>
                          </div>
                          <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[8px] font-black uppercase shrink-0">
                            {user.planLabel || user.plan}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-[9px]">
                          <div>
                            <p className="text-muted-foreground">Balance</p>
                            <p className="font-bold">{user.balance.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground" title="Current allocation basis">Received</p>
                            <p className="font-bold">{user.totalReceivedCredits.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Spent</p>
                            <p className="font-bold">{user.totalSpentCredits.toLocaleString()}</p>
                          </div>
                        </div>
                        <p className="text-[8px] text-muted-foreground">
                          {user.subscriptionStatus} · {user.transactionCount} transactions · last used{' '}
                          {user.lastUsedAt ? utcDateTime(user.lastUsedAt) : 'never'}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setManagedPage((page) => Math.max(0, page - 1))}
                    disabled={managedPage === 0 || managedLoading}
                    className="px-2 py-1 rounded-lg border border-border text-[8px] font-black uppercase tracking-widest text-muted-foreground disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="text-[8px] text-muted-foreground">
                    Page {managedPage + 1} of {Math.max(1, Math.ceil(managedCredits.total / 25))}
                  </span>
                  <button
                    type="button"
                    onClick={() => setManagedPage((page) => page + 1)}
                    disabled={(managedPage + 1) * 25 >= managedCredits.total || managedLoading}
                    className="px-2 py-1 rounded-lg border border-border text-[8px] font-black uppercase tracking-widest text-muted-foreground disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
                <p className="text-[8px] text-muted-foreground">
                  Total received uses the wallet's current allocation basis. Historical grant rows are not all persisted in the existing ledger.
                </p>
              </div>
            </>
          )}

          {managedUserLoading && (
            <p className="text-[10px] text-muted-foreground">Loading user credit history…</p>
          )}
          {managedUser && !managedUserLoading && (
            <div className="p-3 rounded-2xl bg-card border border-primary/30 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-black">{managedUser.user.displayName || 'Unnamed user'}</p>
                  <p className="text-[8px] font-mono text-muted-foreground break-all">{managedUser.user.userId}</p>
                  <p className="text-[9px] text-muted-foreground mt-1">
                    {managedUser.user.planLabel || managedUser.user.plan} · {managedUser.user.subscriptionStatus} · balance{' '}
                    <strong className="text-foreground">{managedUser.user.balance.toLocaleString()}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setManagedUser(null)}
                  aria-label="Close user credit details"
                  className="p-1.5 rounded-full border border-border text-muted-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[9px]">
                <div className="p-2 rounded-xl bg-background border border-border">
                  <p className="text-muted-foreground">Received</p>
                  <p className="font-bold">{managedUser.user.totalReceivedCredits.toLocaleString()}</p>
                </div>
                <div className="p-2 rounded-xl bg-background border border-border">
                  <p className="text-muted-foreground">Spent</p>
                  <p className="font-bold">{managedUser.user.totalSpentCredits.toLocaleString()}</p>
                </div>
                <div className="p-2 rounded-xl bg-background border border-border">
                  <p className="text-muted-foreground">Transactions</p>
                  <p className="font-bold">{managedUser.user.transactionCount.toLocaleString()}</p>
                </div>
              </div>

              <div className="p-2.5 rounded-xl border border-border space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Adjust credits</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={managedAdjustAmount}
                    onChange={(event) => setManagedAdjustAmount(event.target.value)}
                    placeholder="Credits"
                    aria-label="Credit adjustment amount"
                    className="w-full sm:w-28 px-3 py-2 rounded-xl bg-background border border-border text-[10px]"
                  />
                  <input
                    type="text"
                    value={managedAdjustReason}
                    onChange={(event) => setManagedAdjustReason(event.target.value)}
                    placeholder="Reason (required, min. 3 characters)"
                    maxLength={500}
                    aria-label="Credit adjustment reason"
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-background border border-border text-[10px]"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void adjustManagedCredits('add')}
                    disabled={managedAdjustBusy !== null || !managedAdjustAmount || !managedAdjustReason.trim()}
                    className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-[9px] font-black uppercase tracking-widest disabled:opacity-40"
                  >
                    {managedAdjustBusy === 'add' ? 'Adding…' : 'Add credits'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void adjustManagedCredits('remove')}
                    disabled={managedAdjustBusy !== null || !managedAdjustAmount || !managedAdjustReason.trim()}
                    className="px-3 py-2 rounded-xl bg-rose-600 text-white text-[9px] font-black uppercase tracking-widest disabled:opacity-40"
                  >
                    {managedAdjustBusy === 'remove' ? 'Removing…' : 'Remove credits'}
                  </button>
                </div>
                <p className="text-[8px] text-muted-foreground">
                  Add/remove is server-validated, idempotent per request, and cannot produce a negative balance.
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Recent credit transactions</p>
                {managedUser.transactions.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">No credit transactions yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[9px]">
                      <thead className="text-[8px] uppercase tracking-widest text-muted-foreground">
                        <tr>
                          <th className="py-1.5 pr-2">When</th>
                          <th className="py-1.5 pr-2">Type</th>
                          <th className="py-1.5 pr-2 text-right">Delta</th>
                          <th className="py-1.5 pr-2 text-right">Before</th>
                          <th className="py-1.5 pr-2 text-right">After</th>
                          <th className="py-1.5">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {managedUser.transactions.map((transaction) => (
                          <tr key={transaction.id}>
                            <td className="py-1.5 pr-2 whitespace-nowrap text-muted-foreground">{utcDateTime(transaction.createdAt)}</td>
                            <td className="py-1.5 pr-2">{transaction.kind.replace(/_/g, ' ')}</td>
                            <td className={cn('py-1.5 pr-2 text-right font-bold', transaction.creditsDelta < 0 ? 'text-rose-600' : 'text-emerald-600')}>
                              {transaction.creditsDelta > 0 ? '+' : ''}{transaction.creditsDelta.toLocaleString()}
                            </td>
                            <td className="py-1.5 pr-2 text-right">{transaction.balanceBefore.toLocaleString()}</td>
                            <td className="py-1.5 pr-2 text-right">{transaction.balanceAfter.toLocaleString()}</td>
                            <td className="py-1.5 max-w-[220px] truncate" title={transaction.reason || ''}>
                              {transaction.reason || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Section>

      {credits && (
        <Section
          title="Local credit settings (legacy)"
          hint="Local JSON-backed settings and wallets used by the current assistant runtime. Separate from the Supabase credit ledger above."
          icon={<Coins className="w-4 h-4" />}
        >
          <div className="p-3 rounded-2xl bg-card border border-border space-y-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              Action costs
            </p>
            {credits.config.actions.map((action) => (
              <label key={action.key} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-[10px] text-foreground leading-snug">{action.label}</span>
                  <span className="block text-[9px] text-muted-foreground leading-snug">{action.description}</span>
                </span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={creditCostsDraft[action.key] ?? ''}
                  onChange={(event) =>
                    setCreditCostsDraft((current) => ({ ...current, [action.key]: event.target.value }))
                  }
                  aria-label={`${action.label} credit cost`}
                  className="w-20 px-2 py-1.5 rounded-lg bg-background border border-border text-[11px] text-right"
                />
              </label>
            ))}

            <div className="pt-2 border-t border-border space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                Plan allocations
              </p>
              {credits.config.plans.map((plan) => {
                const draft = planDrafts[plan.id] || {
                  creditsPerPeriod: '',
                  periodDays: '',
                  requestsPerDay: '',
                  tokensPerDay: '',
                  memoryLimit: '',
                  historyLimit: '',
                  historyCharLimit: '',
                  maxAttachments: '',
                  advancedFeatures: false,
                };
                const update = (key: keyof typeof draft, value: string | boolean) =>
                  setPlanDrafts((current) => ({
                    ...current,
                    [plan.id]: { ...draft, [key]: value },
                  }));
                const numberField = (
                  key: keyof Pick<
                    typeof draft,
                    | 'requestsPerDay'
                    | 'tokensPerDay'
                    | 'memoryLimit'
                    | 'historyLimit'
                    | 'historyCharLimit'
                    | 'maxAttachments'
                  >,
                  label: string,
                  min: number,
                ) => (
                  <label key={key} className="space-y-0.5">
                    <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                      {label}
                    </span>
                    <input
                      type="number"
                      min={min}
                      step="1"
                      value={draft[key]}
                      onChange={(event) => update(key, event.target.value)}
                      aria-label={`${plan.label} ${label}`}
                      className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[11px] text-right"
                    />
                  </label>
                );
                return (
                  <div key={plan.id} className="space-y-2 pb-2 border-b border-border/50 last:border-0 last:pb-0">
                    <div className="grid grid-cols-[1fr_72px_64px] gap-2 items-end">
                      <span className="text-[10px] text-foreground pb-1.5">{plan.label}</span>
                      <label className="space-y-0.5">
                        <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                          Credits
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={draft.creditsPerPeriod}
                          onChange={(event) => update('creditsPerPeriod', event.target.value)}
                          aria-label={`${plan.label} credits per period`}
                          className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[11px] text-right"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                          Days
                        </span>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={draft.periodDays}
                          onChange={(event) => update('periodDays', event.target.value)}
                          aria-label={`${plan.label} period days`}
                          className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[11px] text-right"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {numberField('requestsPerDay', 'Req/day', 1)}
                      {numberField('tokensPerDay', 'Tokens/day', 1000)}
                      {numberField('memoryLimit', 'Memory', 0)}
                      {numberField('historyLimit', 'History', 0)}
                      {numberField('historyCharLimit', 'Hist. chars', 500)}
                      {numberField('maxAttachments', 'Attach.', 0)}
                    </div>
                    <label className="flex items-center gap-2 text-[9px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={draft.advancedFeatures}
                        onChange={(event) => update('advancedFeatures', event.target.checked)}
                        className="w-3.5 h-3.5 accent-primary"
                      />
                      Allow advanced features (file attachments)
                    </label>
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => void saveCreditSettings()}
              disabled={creditSaving}
              className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
            >
              {creditSaving ? 'Saving...' : 'Save credit settings'}
            </button>
          </div>

          <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                Accounts
              </p>
              <span className="text-[9px] text-muted-foreground">{credits.accounts.length} shown</span>
            </div>
            {credits.accounts.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">No credit accounts yet.</p>
            ) : (
              credits.accounts.map((account) => (
                <div key={account.userId} className="p-2.5 rounded-xl bg-muted/30 border border-border/60 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-mono text-muted-foreground">
                      {account.userShortId}...
                    </span>
                    <span className="text-[8px] font-black uppercase tracking-wider rounded-full bg-primary/10 text-primary px-1.5 py-0.5">
                      {account.planLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="font-semibold">
                      {account.balance} / {account.total} credits
                    </span>
                    <span className="text-muted-foreground">
                      resets {new Date(account.periodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] text-muted-foreground">{account.periodCreditsUsed} used this period</span>
                    <div className="flex items-center gap-1">
                      <select
                        value={account.plan}
                        onChange={(event) => void assignPlan(account.userId, event.target.value as 'free' | 'plus')}
                        disabled={creditBusy === account.userId}
                        aria-label={`Plan for ${account.userShortId}`}
                        className="px-2 py-1 rounded-lg bg-background border border-border text-[10px] disabled:opacity-50"
                      >
                        <option value="free">Free</option>
                        <option value="plus">Plus</option>
                      </select>
                      <select
                        value={account.subscriptionStatus}
                        onChange={(event) =>
                          void setSubscriptionStatus(
                            account.userId,
                            event.target.value as AdminCreditsOverview['accounts'][number]['subscriptionStatus'],
                          )
                        }
                        disabled={creditBusy === account.userId}
                        aria-label={`Subscription status for ${account.userShortId}`}
                        className="px-2 py-1 rounded-lg bg-background border border-border text-[10px] disabled:opacity-50"
                      >
                        <option value="active">Active</option>
                        <option value="past_due">Past due</option>
                        <option value="canceled">Canceled</option>
                        <option value="expired">Expired</option>
                      </select>
                    </div>
                  </div>
                  <p className="text-[9px] text-muted-foreground">
                    Renews {new Date(account.renewalAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · expires{' '}
                    {new Date(account.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </p>
                  <button
                    type="button"
                    onClick={() => void viewUserUsage(account.userId)}
                    className="text-[9px] font-bold uppercase tracking-wider text-primary text-left"
                  >
                    View usage details
                  </button>
                </div>
              ))
            )}
          </div>

          {usageUser && (
            <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  User usage · {usageUser.slice(0, 10)}...
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setUsageUser(null);
                    setUserUsage(null);
                  }}
                  className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Close
                </button>
              </div>
              {usageLoading ? (
                <p className="text-[10px] text-muted-foreground">Loading usage...</p>
              ) : !userUsage ? (
                <p className="text-[10px] text-muted-foreground">No usage found for that user.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="rounded-xl bg-muted/40 p-2">
                      <p className="text-[8px] uppercase tracking-wider text-muted-foreground">Tier</p>
                      <p className="font-semibold">{userUsage.account?.planLabel || 'Unknown'}</p>
                    </div>
                    <div className="rounded-xl bg-muted/40 p-2">
                      <p className="text-[8px] uppercase tracking-wider text-muted-foreground">Remaining</p>
                      <p className="font-semibold">
                        {userUsage.account ? `${userUsage.account.balance} / ${userUsage.account.total}` : 'Not found'}
                      </p>
                    </div>
                    <div className="rounded-xl bg-muted/40 p-2">
                      <p className="text-[8px] uppercase tracking-wider text-muted-foreground">Total requests</p>
                      <p className="font-semibold">{compact(userUsage.usage.allTime.requests)}</p>
                    </div>
                    <div className="rounded-xl bg-muted/40 p-2">
                      <p className="text-[8px] uppercase tracking-wider text-muted-foreground">Credits used</p>
                      <p className="font-semibold">{compact(userUsage.usage.allTime.credits || 0)}</p>
                    </div>
                    <div className="rounded-xl bg-muted/40 p-2">
                      <p className="text-[8px] uppercase tracking-wider text-muted-foreground">API spend</p>
                      <p className="font-semibold">{aud(userUsage.usage.allTime.costAud)}</p>
                    </div>
                    <div className="rounded-xl bg-muted/40 p-2">
                      <p className="text-[8px] uppercase tracking-wider text-muted-foreground">Failed</p>
                      <p className="font-semibold">{compact(userUsage.usage.allTime.failedRequests || 0)}</p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {userUsage.usage.requests.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground">No request history yet.</p>
                    ) : (
                      userUsage.usage.requests.slice(0, 10).map((entry) => (
                        <div key={`${entry.requestId}-${entry.timestamp}`} className="border-b border-border/50 last:border-0 pb-1.5 last:pb-0 space-y-0.5">
                          <div className="flex items-center justify-between gap-2 text-[9px]">
                            <span className="font-semibold truncate">{entry.action.replace(/_/g, ' ')}</span>
                            <span className={entry.status === 'failed' ? 'text-rose-600 font-bold' : 'text-emerald-700 font-bold'}>
                              {entry.status}
                            </span>
                          </div>
                          <p className="text-[8px] text-muted-foreground truncate">
                            {entry.provider}/{entry.model} · {entry.totalTokens} tok · {entry.credits} cr · {aud(entry.costAud)} · {entry.durationMs}ms
                          </p>
                          <p className="text-[8px] text-muted-foreground">
                            {new Date(entry.timestamp).toLocaleString()}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              Recent credit history
            </p>
            {credits.history.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">No credit activity yet.</p>
            ) : (
              credits.history.slice(0, 12).map((entry) => (
                <div key={entry.id} className="flex items-start justify-between gap-2 text-[9px] border-b border-border/50 last:border-0 pb-1.5 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold truncate">{entry.actionLabel}</p>
                    <p className="text-muted-foreground font-mono truncate">
                      {entry.userShortId}... · {entry.requestId.slice(0, 14)}...
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={cn(
                        'font-bold uppercase tracking-wider',
                        entry.status === 'failed' ? 'text-rose-600' : entry.status === 'pending' ? 'text-amber-700' : 'text-emerald-700',
                      )}
                    >
                      {entry.status} · {entry.credits} cr
                    </p>
                    <p className="text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Section>
      )}

      <Section
        title="Spending and safety controls"
        hint="Limits are reserved before a request reaches a provider, including outstanding reservations. Changes are audited with a reason."
        icon={<Wallet className="w-4 h-4" />}
      >
        <div className="p-3 rounded-2xl bg-card border border-border space-y-3">
          <div className="rounded-xl bg-muted/40 p-2.5 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  AI system status
                </p>
                <p className={cn('text-sm font-black', spending?.status.paused ? 'text-rose-600' : 'text-emerald-700')}>
                  {spending?.status.paused ? 'Paused' : 'Online'}
                </p>
              </div>
              <span className="text-[8px] font-mono text-muted-foreground">
                {spending?.source === 'supabase' ? 'Supabase protection' : 'Local protection'}
              </span>
            </div>
            <p className="text-[9px] leading-relaxed text-muted-foreground">
              {spending?.status.emergency.reason || (spending?.status.paused ? 'AI is paused by an administrator.' : 'New requests are accepted while budget and reservation checks pass.')}
            </p>
            {spending?.fallbackReason && (
              <p className="text-[9px] leading-relaxed text-amber-700">
                Supabase summary unavailable; showing the local ledger. {spending.fallbackReason}
              </p>
            )}
          </div>

          {spending && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat
                  label="Daily spending"
                  value={aud(spending.spending.dayAud)}
                  note={`${Math.round(spending.spending.dailyPercentage * 100)}% used · ${aud(spending.spending.remainingDailyAud)} left`}
                  tone={spending.spending.dailyPercentage >= 0.9 ? 'bad' : spending.spending.dailyPercentage >= 0.75 ? 'warn' : 'normal'}
                />
                <Stat
                  label="Monthly spending"
                  value={aud(spending.spending.monthAud)}
                  note={`${Math.round(spending.spending.monthlyPercentage * 100)}% used · ${aud(spending.spending.remainingMonthlyAud)} left`}
                  tone={spending.spending.monthlyPercentage >= 0.9 ? 'bad' : spending.spending.monthlyPercentage >= 0.75 ? 'warn' : 'normal'}
                />
                <Stat
                  label="Outstanding reservations"
                  value={aud(spending.reservations.reservedAud)}
                  note={`${spending.reservations.active} active · ${spending.reservations.uncertain} uncertain`}
                  tone={spending.reservations.uncertain > 0 ? 'warn' : 'normal'}
                />
                <Stat
                  label="Remaining hard budget"
                  value={aud(spending.spending.remainingMonthlyAud)}
                  note="After actual spend and reservations"
                  tone={spending.spending.remainingMonthlyAud <= 0 ? 'bad' : 'normal'}
                />
              </div>

              {spending.alerts.length > 0 && (
                <div className="space-y-1.5">
                  {spending.alerts.map((alert) => (
                    <p
                      key={alert.code}
                      className={cn(
                        'text-[9px] leading-relaxed rounded-lg px-2 py-1.5',
                        alert.level === 'critical'
                          ? 'bg-rose-50 text-rose-700'
                          : alert.level === 'warning'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-muted/50 text-muted-foreground',
                      )}
                    >
                      {alert.message}
                    </p>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  Spending by provider and model
                </p>
                {Object.entries(spending.spending.byProvider).map(([provider, cost]) => (
                  <div key={`provider-${provider}`} className="flex justify-between text-[10px]">
                    <span className="font-semibold">{providerLabel(provider)}</span>
                    <span className="text-muted-foreground">{aud(cost)}</span>
                  </div>
                ))}
                {Object.entries(spending.spending.byModel)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 6)
                  .map(([model, cost]) => (
                    <div key={`model-${model}`} className="flex justify-between text-[9px] text-muted-foreground">
                      <span className="font-mono truncate">{model}</span>
                      <span>{aud(cost)}</span>
                    </div>
                  ))}
              </div>
            </>
          )}

          {[
            { key: 'monthlyBudgetAud', label: 'Monthly budget target (AUD)', step: '0.5' },
            { key: 'monthlyHardLimitAud', label: 'Monthly hard limit (AUD)', step: '0.5' },
            { key: 'dailyLimitAud', label: 'Daily spending limit (AUD)', step: '0.5' },
            { key: 'requestsPerDay', label: 'All requests per day', step: '1' },
            { key: 'tokensPerDay', label: 'All tokens per day', step: '1000' },
            { key: 'requestsPerDayPerUser', label: 'Per person requests per day', step: '1' },
            { key: 'tokensPerDayPerUser', label: 'Per person tokens per day', step: '1000' },
            { key: 'costPerMonthPerUserUsd', label: 'Per person monthly cost (USD legacy)', step: '0.5' },
            { key: 'perUserDailyLimitAud', label: 'Per person daily limit (AUD)', step: '0.5' },
            { key: 'perUserMonthlyLimitAud', label: 'Per person monthly limit (AUD)', step: '0.5' },
          ].map((field) => (
            <label key={field.key} className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-muted-foreground leading-snug">{field.label}</span>
              <input
                type="number"
                min="0"
                step={field.step}
                value={limitsDraft[field.key as keyof typeof limitsDraft]}
                onChange={(event) =>
                  setLimitsDraft((current) => ({ ...current, [field.key]: event.target.value }))
                }
                aria-label={field.label}
                className="w-24 px-2 py-1.5 rounded-lg bg-background border border-border text-[11px] text-right"
              />
            </label>
          ))}

          <div className="pt-2 border-t border-border space-y-1.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              Provider daily requests
            </p>
            {overview.providers.map((provider) => (
              <label key={provider.id} className="flex items-center justify-between gap-3">
                <span className="text-[10px] text-muted-foreground">{provider.label}</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={providerLimitsDraft[provider.id] ?? ''}
                  onChange={(event) =>
                    setProviderLimitsDraft((current) => ({ ...current, [provider.id]: event.target.value }))
                  }
                  aria-label={`${provider.label} daily requests`}
                  className="w-24 px-2 py-1.5 rounded-lg bg-background border border-border text-[11px] text-right"
                />
              </label>
            ))}
          </div>

          <div className="pt-2 border-t border-border space-y-1.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              Per-model monthly limits (AUD, blank = no ceiling)
            </p>
            {overview.providers.flatMap((provider) =>
              provider.models.map((model) => {
                const ref = `${provider.id}:${model.id}`;
                return (
                  <label key={ref} className="flex items-center justify-between gap-2">
                    <span className="text-[9px] text-muted-foreground truncate">{provider.label} · {model.label}</span>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={modelLimitDrafts[ref]?.monthlyAud ?? ''}
                      onChange={(event) =>
                        setModelLimitDrafts((current) => ({
                          ...current,
                          [ref]: { ...(current[ref] || { dailyAud: '', monthlyAud: '' }), monthlyAud: event.target.value },
                        }))
                      }
                      aria-label={`${model.label} monthly spending limit`}
                      className="w-24 px-2 py-1 rounded-lg bg-background border border-border text-[10px] text-right"
                    />
                  </label>
                );
              }),
            )}
          </div>

          <div className="pt-2 border-t border-border space-y-2">
            <label className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-muted-foreground">Warning thresholds (%)</span>
              <input
                value={thresholdDraft}
                onChange={(event) => setThresholdDraft(event.target.value)}
                aria-label="Warning thresholds"
                placeholder="50, 75, 90"
                className="w-32 px-2 py-1.5 rounded-lg bg-background border border-border text-[11px] text-right"
              />
            </label>
            <label className="space-y-1 block">
              <span className="text-[10px] text-muted-foreground">Reason for this change</span>
              <input
                value={spendingReason}
                onChange={(event) => setSpendingReason(event.target.value)}
                maxLength={300}
                placeholder="Why are these limits changing?"
                className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[11px]"
              />
            </label>
          </div>

          <p className="text-[9px] leading-relaxed text-muted-foreground">
            Limits are stored in AUD and enforced before a provider call. Outstanding reservations
            count toward the ceiling, so concurrent requests cannot spend the same budget twice.
          </p>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[9px] text-muted-foreground">
              <span>Monthly budget target</span>
              <span>
                {aud(budget.currentMonthAud)} / {aud(budget.monthlyBudgetAud)}
              </span>
            </div>
            <Meter used={budget.currentMonthAud} limit={budget.monthlyBudgetAud} />
            <div className="flex items-center justify-between text-[9px] text-muted-foreground">
              <span>Monthly hard limit</span>
              <span>
                {aud(budget.currentMonthAud)} / {aud(budget.monthlyHardLimitAud)}
              </span>
            </div>
            <Meter used={budget.currentMonthAud} limit={budget.monthlyHardLimitAud} />
            <div className="flex items-center justify-between text-[9px] text-muted-foreground">
              <span>Daily spending limit</span>
              <span>
                {aud(budget.currentDayAud)} / {aud(budget.dailyLimitAud)}
              </span>
            </div>
            <Meter used={budget.currentDayAud} limit={budget.dailyLimitAud} />
          </div>

          <button
            onClick={() => void saveCosts()}
            disabled={saving}
            className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
          >
            {saving ? 'Saving...' : 'Save spending controls'}
          </button>

          <div className="mt-2 p-2.5 rounded-xl border border-rose-200 bg-rose-50/50 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-rose-700">
              Emergency control
            </p>
            <p className="text-[9px] leading-relaxed text-rose-700/80">
              Pausing blocks new AI requests. Requests already running are allowed to finish and are
              not cancelled or corrupted.
            </p>
            <input
              value={emergencyReason}
              onChange={(event) => setEmergencyReason(event.target.value)}
              maxLength={300}
              placeholder="Reason for pausing or resuming"
              className="w-full px-2 py-1.5 rounded-lg bg-background border border-rose-200 text-[11px]"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void toggleEmergency(true)}
                disabled={emergencyBusy || spending?.status.paused === true}
                className="py-2 rounded-lg bg-rose-600 text-white text-[9px] font-black uppercase tracking-widest disabled:opacity-40"
              >
                Pause AI
              </button>
              <button
                type="button"
                onClick={() => void toggleEmergency(false)}
                disabled={emergencyBusy || spending?.status.paused !== true}
                className="py-2 rounded-lg border border-emerald-300 text-emerald-700 text-[9px] font-black uppercase tracking-widest disabled:opacity-40"
              >
                Resume AI
              </button>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Performance"
        hint="Turn-level timings from the server ledger. Failed calls include those that fell back successfully."
        icon={<Activity className="w-4 h-4" />}
      >
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Avg response" value={`${usage.performance.avgLatencyMs} ms`} note="This month" />
          <Stat
            label="Failed calls"
            value={compact(usage.performance.failures)}
            note={`${(usage.performance.errorRate * 100).toFixed(1)}% error rate`}
            tone={usage.performance.errorRate >= 0.2 ? 'bad' : 'normal'}
          />
          <Stat label="Fallbacks used" value={compact(usage.performance.fallbacks)} />
          <Stat
            label="Rate-limit errors"
            value={compact(usage.performance.rateLimited)}
            tone={usage.performance.rateLimited > 0 ? 'warn' : 'normal'}
          />
          <Stat label="Cache hits" value={compact(usage.cacheHits)} note="Served free" />
          <Stat label="Tracked people" value={compact(usage.trackedUsers)} note="Anonymous hashes" />
        </div>

        <div className="p-3 rounded-2xl bg-card border border-border space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">By provider</p>
          {overview.providers.map((provider) => {
            const stats = usage.providerPerformance[provider.id];
            return (
              <div key={provider.id} className="flex items-center justify-between gap-2 text-[10px]">
                <span className="font-semibold">{provider.label}</span>
                <span className="text-muted-foreground text-right">
                  {stats ? `${stats.avgLatencyMs} ms · ${stats.failures} failed · ${stats.rateLimited} 429` : 'No calls yet'}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="Safety"
        hint="Flag names and counts only. Reported replies are not uploaded, so their text never reaches the server."
        icon={<ShieldCheck className="w-4 h-4" />}
      >
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Moderation events" value={compact(usage.safety.moderationEvents)} />
          <Stat label="Blocked requests" value={compact(usage.safety.blockedRequests)} />
          <Stat label="Reported replies" value={compact(usage.safety.reportedResponses)} />
          <Stat
            label="Safety errors"
            value={compact(usage.safety.errors)}
            tone={usage.safety.errors > 0 ? 'bad' : 'normal'}
          />
        </div>

        <div className="p-3 rounded-2xl bg-card border border-border space-y-1.5">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Top flags</p>
          {Object.keys(usage.safety.byFlag).length === 0 ? (
            <p className="text-[10px] text-muted-foreground">No safety events recorded.</p>
          ) : (
            Object.entries(usage.safety.byFlag)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 6)
              .map(([flag, count]) => (
                <div key={flag} className="flex items-center justify-between text-[10px]">
                  <span className="font-mono">{flag}</span>
                  <span className="text-muted-foreground">{count}</span>
                </div>
              ))
          )}
        </div>
      </Section>

      <div className="p-3 rounded-2xl bg-muted/40 border border-border space-y-1">
        <p className="text-[9px] leading-relaxed text-muted-foreground flex gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          This dashboard never shows conversations, saved notes or account details. The server ledger
          holds counts, tokens, estimated cost and timings only, keyed by an anonymous hash.
        </p>
        <p className="text-[9px] text-muted-foreground flex items-center gap-1">
          <Clock className="w-3 h-3" /> Daily and monthly counters roll over automatically.
        </p>
        <p className="text-[9px] text-muted-foreground flex items-center gap-1">
          <Zap className="w-3 h-3" /> A change here overrides the environment for this server.
        </p>
        <p className="text-[9px] text-muted-foreground flex items-center gap-1">
          <TrendingUp className="w-3 h-3" /> Provider keys are never sent to the browser.
        </p>
        <p className="text-[9px] text-muted-foreground flex items-center gap-1">
          <Check className="w-3 h-3" /> All requests are same-origin and token checked.
        </p>
        <Link to="/settings" className="inline-block pt-1 text-[9px] font-bold uppercase tracking-widest text-primary">
          Back to Settings
        </Link>
      </div>
    </div>
  );
};

export default AdminAi;
