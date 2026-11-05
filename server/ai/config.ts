/**
 * Central AI configuration.
 *
 * Everything the AI layer needs comes from the server environment, never from
 * the browser. Provider keys are read here and are never serialised into a
 * response: the client only ever sees which providers are configured.
 *
 * This file is the single place to change the primary provider, the default
 * model, the backup chain, which providers are enabled, and what each provider
 * is allowed to spend. No feature code refers to a provider by name.
 */

import { loadOverrides } from "./overrides";
import { AI_FEATURES, type AiFeature } from "./features";

export type ProviderId = "freebuff" | "openai" | "huggingface";

export type AgeBand = "child" | "teen" | "adult";
export type BillingCurrency = "USD" | "AUD" | "EUR" | "GBP";

export interface ModelPrice {
  /** Price per 1M input tokens, in the provider's billing currency. */
  inputPerMillion: number;
  /** Price per 1M output tokens, in the provider's billing currency. */
  outputPerMillion: number;
  /** Where the figure came from, so a stale price is obvious in the code. */
  source: string;
}

export interface ModelCapabilities {
  streaming: boolean;
  tools: boolean;
  structuredOutputs: boolean;
}

export interface ModelSpec {
  id: string;
  provider: ProviderId;
  label: string;
  /** False when an administrator or the environment has switched this model off. */
  enabled?: boolean;
  /** Why a disabled model is unavailable; environment blocks cannot be overridden. */
  disabledBy?: "environment" | "admin";
  price?: ModelPrice;
  /** Currency the provider invoices for this model. Defaults to USD. */
  billingCurrency?: BillingCurrency;
  capabilities: ModelCapabilities;
  /** False when the provider has deprecated the model; kept so configs fail loudly. */
  recommended?: boolean;
  notes?: string;
}

export interface ProviderLimits {
  /** Requests this provider may serve per day, across all clients. */
  requestsPerDay: number;
  /** Hard ceiling on output tokens for this provider. */
  maxOutputTokens: number;
}

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  /** Currency this provider invoices in; model prices use this currency. */
  billingCurrency: BillingCurrency;
  baseUrl: string;
  keyPresent: boolean;
  enabled: boolean;
  /** Why a configured provider is not being used, shown in status output. */
  disabledReason?: string;
  models: ModelSpec[];
  limits: ProviderLimits;
  /**
   * Hugging Face fans a request out to a vendor of its choosing unless one is
   * pinned. The default is pinned so requests cannot land on a provider whose
   * terms exclude under-18 end users.
   */
  pinnedProvider?: string;
}

export interface AiLimits {
  requestsPerDay: number;
  tokensPerDay: number;
  /** Monthly target in AUD. Reaching 75% raises an admin warning, not a block. */
  monthlyBudgetAud: number;
  /** Absolute monthly ceiling in AUD. New requests stop when this is reached. */
  monthlyHardLimitAud: number;
  /** Spending ceiling for one calendar day, in AUD. */
  dailyLimitAud: number;
  /** Legacy USD mirrors, kept for old dashboard clients and API consumers. */
  costPerDayUsd: number;
  costPerMonthUsd: number;
  requestsPerMinutePerClient: number;
  requestsPerDayPerClient: number;
  /** Per signed-in person, keyed by an opaque hash the server cannot reverse. */
  requestsPerDayPerUser: number;
  tokensPerDayPerUser: number;
  costPerMonthPerUserUsd: number;
  /** Per-user AUD ceilings added for the spending-protection controls. */
  perUserDailyLimitAud: number;
  perUserMonthlyLimitAud: number;
}

export interface AiModelLimit {
  dailyAud?: number;
  monthlyAud?: number;
}

export interface AiCacheConfig {
  enabled: boolean;
  ttlSeconds: number;
  maxEntries: number;
}

export interface AiConfig {
  enabled: boolean;
  providers: ProviderSpec[];
  /** Providers in the order they will be tried. */
  order: ProviderId[];
  defaultModel?: ModelSpec;
  /** A single compatibility view of the first fallback. */
  backupModel?: ModelSpec;
  /** Ordered fallbacks after the default/feature model. */
  fallbackModels: ModelSpec[];
  /** Optional feature-specific overrides; missing entries use the default. */
  featureModels: Partial<Record<AiFeature, ModelSpec>>;
  /** Model refs currently disabled by the environment or an administrator. */
  disabledModels: string[];
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  historyLimit: number;
  /** Total characters of conversation history accepted for one request. */
  historyCharLimit: number;
  /** Long-term notes considered for one request. */
  memoryLimit: number;
  maxMessageChars: number;
  /** Hard cap applied to the reply after moderation. */
  maxReplyChars: number;
  cache: AiCacheConfig;
  /** Streaming is used by the chat route when the chosen model supports it. */
  streaming: boolean;
  /** Ask each provider for its live model list and reject unknown default models. */
  validateModels: boolean;
  limits: AiLimits;
  /** Percentages of a ceiling that produce an admin warning. */
  warningThresholds: number[];
  /** Optional per-model spending ceilings in AUD. */
  modelLimits: Record<string, AiModelLimit>;
  /** Emergency pause is distinct from the ordinary admin on/off switch. */
  emergency: {
    paused: boolean;
    reason: string | null;
    at: string | null;
    by: string | null;
  };
  /** Operator-managed switches, stored in data/ai-settings.json. */
  disabledUsers: string[];
  disabledByAdmin: boolean;
  /** AUD conversion rates used for the billing currencies above. */
  audRates: Record<BillingCurrency, number>;
}

const numberFromEnv = (name: string, fallback: number, min: number, max: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const flag = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  return fallback;
};

const DEFAULT_AUD_PER: Record<BillingCurrency, number> = {
  AUD: 1,
  USD: 1.55,
  EUR: 1.7,
  GBP: 1.95,
};

/**
 * Conversion is deliberately server-side and configurable. Provider invoices
 * stay in their own currency; the operator supplies the rate used to convert
 * them into the AUD budget. Rates are not fetched from a third party, so a
 * spending decision never depends on an external service being reachable.
 */
export const audPerCurrency = (currency: BillingCurrency): number =>
  numberFromEnv(`AI_AUD_PER_${currency}`, DEFAULT_AUD_PER[currency], 0.01, 1_000);

const currencyFromEnv = (name: string): BillingCurrency => {
  const value = process.env[name]?.trim().toUpperCase();
  if (value === "AUD" || value === "USD" || value === "EUR" || value === "GBP") return value;
  return "USD";
};

/**
 * Freebuff exposes an OpenAI-compatible API. Model ids change over time, so the
 * id is configuration rather than code: FREEBUFF_MODEL (or FREEBUFF_MODELS for a
 * comma-separated list) must name an id that Freebuff actually serves. Prices
 * are optional because the operator's plan decides them; set the two price
 * variables to make the cost figure meaningful.
 */
const freebuffModels = (): ModelSpec[] => {
  const raw =
    process.env.FREEBUFF_MODELS?.trim() || process.env.FREEBUFF_MODEL?.trim() || "";
  if (!raw) return [];

  const input = Number(process.env.FREEBUFF_INPUT_PRICE_PER_MILLION || 0);
  const output = Number(process.env.FREEBUFF_OUTPUT_PRICE_PER_MILLION || 0);
  const price =
    Number.isFinite(input) && Number.isFinite(output) && (input > 0 || output > 0)
      ? {
          inputPerMillion: input,
          outputPerMillion: output,
          source: "FREEBUFF_INPUT/OUTPUT_PRICE_PER_MILLION",
        }
      : undefined;

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 6)
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .map((id) => ({
      id,
      provider: "freebuff" as const,
      label: `Freebuff: ${id}`,
      price,
      capabilities: { streaming: true, tools: true, structuredOutputs: true },
      recommended: true,
      notes: price
        ? undefined
        : "Set FREEBUFF_INPUT_PRICE_PER_MILLION and FREEBUFF_OUTPUT_PRICE_PER_MILLION to budget accurately.",
    }));
};

const OPENAI_MODELS: ModelSpec[] = [
  {
    id: "gpt-6-luna",
    provider: "openai",
    label: "GPT-6 Luna",
    price: { inputPerMillion: 0.1, outputPerMillion: 0.5, source: "developers.openai.com/api/docs/pricing (2026-11)" },
    capabilities: { streaming: true, tools: true, structuredOutputs: true },
    recommended: true,
  },
];

/**
 * Hugging Face hosts many vendors behind one router. Only vendors without an
 * 18+ end-user clause are acceptable for this app, so the default is pinned to
 * one of those and "auto" is deliberately never used.
 */
const HF_SAFE_PROVIDERS = ["together", "cerebras", "deepinfra", "cohere", "hf-inference"];

const hfModels = (): ModelSpec[] => {
  const model = process.env.HF_MODEL?.trim();
  if (!model) return [];
  const input = Number(process.env.HF_INPUT_PRICE_PER_MILLION || 0);
  const output = Number(process.env.HF_OUTPUT_PRICE_PER_MILLION || 0);
  return [
    {
      id: model,
      provider: "huggingface",
      label: `Hugging Face: ${model}`,
      price:
        Number.isFinite(input) && Number.isFinite(output) && (input > 0 || output > 0)
          ? { inputPerMillion: input, outputPerMillion: output, source: "HF_INPUT/OUTPUT_PRICE_PER_MILLION" }
          : undefined,
      capabilities: { streaming: true, tools: false, structuredOutputs: false },
      recommended: true,
      notes: "Prices vary by upstream provider; set HF_INPUT_PRICE_PER_MILLION to budget accurately.",
    },
  ];
};

const resolvePinnedProvider = (): string => {
  const requested = process.env.HF_PROVIDER?.trim().toLowerCase();
  if (requested && HF_SAFE_PROVIDERS.includes(requested)) return requested;
  return "together";
};

/** Models an operator has switched off, as "provider:model,..." */
const disabledModels = (): Set<string> =>
  new Set(
    (process.env.AI_DISABLED_MODELS || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

const providerBaseUrl = (name: string, fallback: string): string =>
  process.env[name]?.trim().replace(/\/+$/, "") || fallback;

const keyFor = (provider: ProviderId): string => {
  if (provider === "freebuff") return process.env.FREEBUFF_API_KEY?.trim() || "";
  if (provider === "openai") return process.env.OPENAI_API_KEY?.trim() || "";
  return (process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || "").trim();
};

const providerLimits = (provider: ProviderId, defaultMaxOutput: number): ProviderLimits => {
  const prefix = provider.toUpperCase();
  return {
    requestsPerDay: Math.round(
      numberFromEnv(`${prefix}_DAILY_REQUESTS`, 1_000, 1, 1_000_000),
    ),
    maxOutputTokens: Math.round(
      numberFromEnv(`${prefix}_MAX_OUTPUT_TOKENS`, defaultMaxOutput, 64, 8192),
    ),
  };
};

const providersFromEnv = (defaultMaxOutput: number): ProviderSpec[] => {
  const blocked = disabledModels();
  const freebuffCurrency = currencyFromEnv("FREEBUFF_BILLING_CURRENCY");
  const openAiCurrency = currencyFromEnv("OPENAI_BILLING_CURRENCY");
  const hfCurrency = currencyFromEnv("HUGGINGFACE_BILLING_CURRENCY");
  const withModels = (provider: ProviderId, currency: BillingCurrency, models: ModelSpec[]) =>
    models
      .map((model) => {
        const ref = `${model.provider}:${model.id}`;
        return {
          ...model,
          billingCurrency: currency,
          enabled: !blocked.has(ref),
          disabledBy: blocked.has(ref) ? ("environment" as const) : undefined,
        };
      });

  // OpenAI is a paid provider and is never activated by a key alone: it needs an
  // explicit OPENAI_ENABLED=true, so adding a key for later does not start spend.
  const openAiEnabled = flag("OPENAI_ENABLED", false);
  const hfPinned = resolvePinnedProvider();
  const hfRequested = process.env.HF_PROVIDER?.trim().toLowerCase();
  const hfTermsOk = !hfRequested || HF_SAFE_PROVIDERS.includes(hfRequested);

  const providers: ProviderSpec[] = [
    {
      id: "freebuff",
      label: "Freebuff",
      billingCurrency: freebuffCurrency,
      baseUrl: providerBaseUrl("FREEBUFF_BASE_URL", "https://freebuff.com/api/v1/paid"),
      keyPresent: Boolean(keyFor("freebuff")),
      enabled:
        Boolean(keyFor("freebuff")) &&
        freebuffModels().length > 0 &&
        flag("FREEBUFF_ENABLED", true),
      disabledReason: !keyFor("freebuff")
        ? "FREEBUFF_API_KEY is not set"
        : freebuffModels().length === 0
          ? "FREEBUFF_MODEL is not set"
          : flag("FREEBUFF_ENABLED", true)
            ? undefined
            : "FREEBUFF_ENABLED is false",
      models: withModels("freebuff", freebuffCurrency, freebuffModels()),
      limits: providerLimits("freebuff", defaultMaxOutput),
    },
    {
      id: "openai",
      label: "OpenAI",
      billingCurrency: openAiCurrency,
      baseUrl: providerBaseUrl("OPENAI_BASE_URL", "https://api.openai.com/v1"),
      keyPresent: Boolean(keyFor("openai")),
      enabled: Boolean(keyFor("openai")) && openAiEnabled,
      disabledReason: !keyFor("openai")
        ? "OPENAI_API_KEY is not set"
        : openAiEnabled
          ? undefined
          : "OPENAI_ENABLED is not true (paid provider, opt-in)",
      models: withModels("openai", openAiCurrency, OPENAI_MODELS),
      limits: providerLimits("openai", defaultMaxOutput),
    },
    {
      id: "huggingface",
      label: "Hugging Face",
      billingCurrency: hfCurrency,
      baseUrl: providerBaseUrl("HUGGINGFACE_BASE_URL", "https://router.huggingface.co/v1"),
      keyPresent: Boolean(keyFor("huggingface")),
      enabled: Boolean(keyFor("huggingface")) && hfModels().length > 0 && hfTermsOk &&
        flag("HUGGINGFACE_ENABLED", true),
      disabledReason: !keyFor("huggingface")
        ? "HUGGINGFACE_API_KEY is not set"
        : hfModels().length === 0
          ? "HF_MODEL is not set"
          : !hfTermsOk
            ? `${hfRequested} does not meet the under-18 terms policy; use one of ${HF_SAFE_PROVIDERS.join(", ")}`
            : flag("HUGGINGFACE_ENABLED", true)
              ? undefined
              : "HUGGINGFACE_ENABLED is false",
      models: withModels("huggingface", hfCurrency, hfModels()),
      pinnedProvider: hfPinned,
      limits: providerLimits("huggingface", defaultMaxOutput),
    },
  ];

  return providers;
};

const providerOrder = (providers: ProviderSpec[]): ProviderId[] => {
  const requested = (process.env.AI_PROVIDER_ORDER || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is ProviderId =>
      entry === "freebuff" || entry === "openai" || entry === "huggingface",
    );
  const seen = new Set<ProviderId>();
  const order: ProviderId[] = [];
  for (const id of [...requested, "freebuff" as ProviderId, "openai" as ProviderId, "huggingface" as ProviderId]) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (providers.some((provider) => provider.id === id)) order.push(id);
  }
  return order;
};

/** "provider:model", the same shape used in the env file and API responses. */
export const formatModelRef = (model?: ModelSpec): string | undefined =>
  model ? `${model.provider}:${model.id}` : undefined;

export const findModel = (providers: ProviderSpec[], ref?: string): ModelSpec | undefined => {
  if (!ref) return undefined;
  const [providerId, ...rest] = ref.split(":");
  const modelId = rest.join(":");
  const provider = providers.find((entry) => entry.id === providerId);
  return provider?.models.find((model) => model.id === modelId);
};

const firstEnabledModel = (providers: ProviderSpec[], order: ProviderId[]): ModelSpec | undefined => {
  for (const id of order) {
    const provider = providers.find((entry) => entry.id === id);
    if (provider?.enabled && provider.models.length > 0) {
      return (
        provider.models.find((model) => model.enabled !== false && model.recommended !== false) ||
        provider.models.find((model) => model.enabled !== false)
      );
    }
  }
  return undefined;
};

export const loadAiConfig = (): AiConfig => {
  const maxOutput = Math.round(numberFromEnv("AI_MAX_OUTPUT_TOKENS", 700, 64, 4096));
  const overrides = loadOverrides();

  // Dashboard switches take effect without a restart. A provider can only be
  // turned on when it has a key, a model and no policy block, so the dashboard
  // cannot bypass the under-18 vendor rule or invent a key.
  const adminDisabled = new Set(overrides.disabledModels || []);
  const providers = providersFromEnv(maxOutput).map((provider) => {
    const forced = overrides.providers?.[provider.id];
    const daily = overrides.providerLimits?.[provider.id];
    const limits = typeof daily === "number" ? { ...provider.limits, requestsPerDay: daily } : provider.limits;
    const models = provider.models.map((model) => {
      const ref = `${model.provider}:${model.id}`;
      if (model.disabledBy === "environment") return model;
      return {
        ...model,
        enabled: !adminDisabled.has(ref),
        disabledBy: adminDisabled.has(ref) ? ("admin" as const) : undefined,
      };
    });
    const base = { ...provider, models, limits };
    if (forced === undefined) return base;

    const blockedByPolicy = /terms policy|HF_MODEL|FREEBUFF_MODEL/.test(
      provider.disabledReason || "",
    );
    const canEnable = provider.keyPresent && provider.models.length > 0 && !blockedByPolicy;
    return {
      ...base,
      enabled: forced ? canEnable : false,
      disabledReason: forced
        ? canEnable
          ? undefined
          : provider.disabledReason || "This provider cannot be enabled until it is configured."
        : provider.keyPresent
          ? "Disabled in the AI dashboard"
          : provider.disabledReason,
    };
  });
  const order = providerOrder(providers);

  const configuredDefault = findModel(
    providers,
    overrides.defaultModel || process.env.AI_DEFAULT_MODEL?.trim(),
  );
  const enabledProvider = (model?: ModelSpec) =>
    Boolean(
      model &&
        model.enabled !== false &&
        providers.find((provider) => provider.id === model.provider)?.enabled,
    );

  const defaultModel =
    (enabledProvider(configuredDefault) ? configuredDefault : undefined) ||
    firstEnabledModel(providers, order);

  const fallbackRefs =
    overrides.fallbackModels && overrides.fallbackModels.length > 0
      ? overrides.fallbackModels
      : [overrides.backupModel || process.env.AI_BACKUP_MODEL?.trim()].filter(
          (value): value is string => Boolean(value),
        );
  const requestedBackupProvider = process.env.AI_BACKUP_PROVIDER?.trim() as ProviderId | undefined;
  const fallbackModels: ModelSpec[] = [];
  for (const ref of fallbackRefs) {
    const model = findModel(providers, ref);
    if (!model || !enabledProvider(model) || model.id === defaultModel?.id) continue;
    if (fallbackModels.some((entry) => entry.provider === model.provider && entry.id === model.id)) continue;
    fallbackModels.push(model);
  }
  if (fallbackModels.length === 0) {
    const auto =
      (requestedBackupProvider
        ? providers.find((provider) => provider.id === requestedBackupProvider && provider.enabled)?.models.find((model) => model.enabled !== false)
        : undefined) ||
      providers
        .filter((provider) => provider.enabled)
        .flatMap((provider) => provider.models)
        .find((model) => model.enabled !== false && model.id !== defaultModel?.id);
    if (auto) fallbackModels.push(auto);
  }
  const backupModel = fallbackModels[0];

  const featureModels: Partial<Record<AiFeature, ModelSpec>> = {};
  for (const feature of AI_FEATURES) {
    const model = findModel(providers, overrides.featureModels?.[feature] || undefined);
    if (model && enabledProvider(model)) featureModels[feature] = model;
  }
  const disabledModels = providers.flatMap((provider) =>
    provider.models
      .filter((model) => model.enabled === false)
      .map((model) => `${model.provider}:${model.id}`),
  );

  const enabledFlag = (process.env.AI_ENABLED || "auto").trim().toLowerCase();
  const anyEnabled = providers.some((provider) => provider.enabled && provider.models.length > 0);
  const environmentEnabled =
    enabledFlag === "false" ? false : enabledFlag === "true" ? true : anyEnabled;
  // The dashboard switch sits on top of the environment. Turning it back on
  // cannot invent a provider, key or model, but it can resume a paused setup.
  const adminEnabled = overrides.aiEnabled;
  const enabled = (adminEnabled === undefined ? environmentEnabled : adminEnabled) && Boolean(defaultModel);

  const audPerUsd = audPerCurrency("USD");
  const legacyMonthlyUsd = numberFromEnv("AI_COST_PER_MONTH_USD", 10, 0, 10_000);
  const legacyDailyUsd = numberFromEnv("AI_COST_PER_DAY_USD", 2, 0, 10_000);
  const envHardLimitAud = numberFromEnv(
    "AI_MONTHLY_HARD_LIMIT_AUD",
    legacyMonthlyUsd * audPerUsd,
    0,
    10_000,
  );
  const envBudgetAud = numberFromEnv("AI_MONTHLY_BUDGET_AUD", envHardLimitAud, 0, 10_000);
  const envDailyAud = numberFromEnv(
    "AI_DAILY_LIMIT_AUD",
    legacyDailyUsd * audPerUsd,
    0,
    10_000,
  );
  const legacyPerUserMonthlyUsd = numberFromEnv("AI_COST_PER_MONTH_PER_USER_USD", 2, 0, 10_000);

  const baseLimits: AiLimits = {
    requestsPerDay: Math.round(numberFromEnv("AI_REQUESTS_PER_DAY", 300, 1, 100_000)),
    tokensPerDay: Math.round(numberFromEnv("AI_TOKENS_PER_DAY", 400_000, 1_000, 100_000_000)),
    monthlyBudgetAud: envBudgetAud,
    monthlyHardLimitAud: envHardLimitAud,
    dailyLimitAud: envDailyAud,
    costPerDayUsd: legacyDailyUsd,
    costPerMonthUsd: legacyMonthlyUsd,
    requestsPerMinutePerClient: Math.round(
      numberFromEnv("AI_REQUESTS_PER_MINUTE", 12, 1, 600),
    ),
    requestsPerDayPerClient: Math.round(
      numberFromEnv("AI_REQUESTS_PER_DAY_PER_CLIENT", 80, 1, 10_000),
    ),
    requestsPerDayPerUser: Math.round(
      numberFromEnv("AI_REQUESTS_PER_DAY_PER_USER", 60, 1, 10_000),
    ),
    tokensPerDayPerUser: Math.round(
      numberFromEnv("AI_TOKENS_PER_DAY_PER_USER", 60_000, 1_000, 100_000_000),
    ),
    costPerMonthPerUserUsd: legacyPerUserMonthlyUsd,
    perUserDailyLimitAud: numberFromEnv("AI_PER_USER_DAILY_LIMIT_AUD", 0, 0, 100_000),
    perUserMonthlyLimitAud: numberFromEnv(
      "AI_PER_USER_MONTHLY_LIMIT_AUD",
      legacyPerUserMonthlyUsd * audPerUsd,
      0,
      100_000,
    ),
  };

  const overrideLimits = overrides.limits || {};
  const legacyOverrideMonthAud =
    typeof overrideLimits.costPerMonthUsd === "number"
      ? overrideLimits.costPerMonthUsd * audPerUsd
      : undefined;
  const legacyOverrideDayAud =
    typeof overrideLimits.costPerDayUsd === "number"
      ? overrideLimits.costPerDayUsd * audPerUsd
      : undefined;
  const monthlyHardLimitAud = Math.min(
    10_000,
    Math.max(
      0,
      overrideLimits.monthlyHardLimitAud ??
        legacyOverrideMonthAud ??
        baseLimits.monthlyHardLimitAud,
    ),
  );
  const dailyLimitAud = Math.min(
    10_000,
    Math.max(0, overrideLimits.dailyLimitAud ?? legacyOverrideDayAud ?? baseLimits.dailyLimitAud),
  );
  const monthlyBudgetAud = Math.min(
    monthlyHardLimitAud,
    Math.max(
      0,
      overrideLimits.monthlyBudgetAud ??
        legacyOverrideMonthAud ??
        baseLimits.monthlyBudgetAud,
    ),
  );

  const limits: AiLimits = {
    ...baseLimits,
    ...overrideLimits,
    monthlyBudgetAud,
    monthlyHardLimitAud,
    dailyLimitAud,
    perUserDailyLimitAud: Math.min(
      100_000,
      Math.max(0, overrideLimits.perUserDailyLimitAud ?? baseLimits.perUserDailyLimitAud),
    ),
    perUserMonthlyLimitAud: Math.min(
      100_000,
      Math.max(0, overrideLimits.perUserMonthlyLimitAud ?? baseLimits.perUserMonthlyLimitAud),
    ),
    // Keep the old fields in sync so existing clients show the same ceiling.
    costPerMonthUsd:
      typeof overrideLimits.costPerMonthUsd === "number"
        ? overrideLimits.costPerMonthUsd
        : Number((monthlyHardLimitAud / audPerUsd).toFixed(4)),
    costPerDayUsd:
      typeof overrideLimits.costPerDayUsd === "number"
        ? overrideLimits.costPerDayUsd
        : Number((dailyLimitAud / audPerUsd).toFixed(4)),
  };

  const configuredThresholds = (overrides.warningThresholds || [])
    .filter((value) => Number.isFinite(value) && value > 0 && value < 100)
    .sort((a, b) => a - b);
  const warningThresholds = configuredThresholds.length > 0 ? configuredThresholds : [50, 75, 90];
  const modelLimits = Object.fromEntries(
    Object.entries(overrides.modelLimits || {})
      .map(([ref, limit]) => {
        const dailyAud = Number(limit.dailyAud);
        const monthlyAud = Number(limit.monthlyAud);
        return [
          ref,
          {
            ...(Number.isFinite(dailyAud) ? { dailyAud: Math.max(0, dailyAud) } : {}),
            ...(Number.isFinite(monthlyAud) ? { monthlyAud: Math.max(0, monthlyAud) } : {}),
          },
        ] as const;
      })
      .filter(([, limit]) => Object.keys(limit).length > 0),
  );
  const emergencyPaused = overrides.emergencyPaused === true;

  return {
    enabled: enabled && !emergencyPaused && Boolean(defaultModel),
    providers,
    order,
    defaultModel,
    backupModel,
    fallbackModels,
    featureModels,
    disabledModels,
    temperature: numberFromEnv("AI_TEMPERATURE", 0.6, 0, 1.5),
    maxOutputTokens: maxOutput,
    timeoutMs: Math.round(numberFromEnv("AI_TIMEOUT_MS", 25_000, 3_000, 120_000)),
    historyLimit: Math.round(numberFromEnv("AI_HISTORY_LIMIT", 12, 0, 40)),
    historyCharLimit: Math.round(numberFromEnv("AI_HISTORY_CHARS", 8_000, 500, 40_000)),
    memoryLimit: Math.round(numberFromEnv("AI_MEMORY_LIMIT", 12, 0, 50)),
    maxMessageChars: Math.round(numberFromEnv("AI_MAX_MESSAGE_CHARS", 4_000, 200, 8000)),
    maxReplyChars: Math.round(numberFromEnv("AI_MAX_REPLY_CHARS", 4_000, 200, 20_000)),
    cache: {
      enabled: flag("AI_CACHE_ENABLED", true),
      ttlSeconds: Math.round(numberFromEnv("AI_CACHE_TTL_SECONDS", 900, 0, 86_400)),
      maxEntries: Math.round(numberFromEnv("AI_CACHE_MAX_ENTRIES", 250, 1, 5_000)),
    },
    streaming: flag("AI_STREAMING", true),
    validateModels: flag("AI_VALIDATE_MODELS", false),
    limits,
    warningThresholds,
    modelLimits,
    emergency: {
      paused: emergencyPaused,
      reason: overrides.emergencyReason?.trim() || null,
      at: overrides.emergencyAt || null,
      by: overrides.emergencyBy?.trim() || null,
    },
    disabledUsers: overrides.disabledUsers || [],
    disabledByAdmin: adminEnabled === false || emergencyPaused,
    audRates: {
      AUD: 1,
      USD: audPerUsd,
      EUR: audPerCurrency("EUR"),
      GBP: audPerCurrency("GBP"),
    },
  };
};

/** Public shape sent to the browser: model names and limits, never keys. */
export const describeConfig = (config: AiConfig) => ({
  enabled: config.enabled,
  cache: { enabled: config.cache.enabled, ttlSeconds: config.cache.ttlSeconds },
  defaultModel: formatModelRef(config.defaultModel) || null,
  backupModel: formatModelRef(config.backupModel) || null,
  fallbackModels: config.fallbackModels.map((model) => formatModelRef(model)).filter(Boolean),
  featureModels: Object.fromEntries(
    AI_FEATURES.map((feature) => [feature, formatModelRef(config.featureModels[feature]) || null]),
  ),
  disabledModels: config.disabledModels,
  streaming: config.streaming,
  order: config.order,
  budgetCurrency: "AUD" as const,
  providers: config.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    billingCurrency: provider.billingCurrency,
    configured: provider.keyPresent && provider.models.length > 0,
    enabled: provider.enabled,
    disabledReason: provider.disabledReason,
    pinnedProvider: provider.pinnedProvider,
    limits: provider.limits,
    models: provider.models.map((model) => ({
      id: model.id,
      label: model.label,
      enabled: model.enabled !== false,
      disabledBy: model.disabledBy || null,
      capabilities: model.capabilities,
    })),
  })),
  limits: config.limits,
  disabledByAdmin: config.disabledByAdmin,
});
