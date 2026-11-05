/**
 * Operator dashboard API.
 *
 * Every route here is gated by requireAdmin. A normal administrator signs in
 * with Supabase Auth and is checked against admin_users server-side. The
 * temporary AI_ADMIN_TOKEN break-glass credential remains available during the
 * migration, is compared in constant time, and is never echoed or logged.
 * Responses contain configuration, counts and timings only: no prompts,
 * replies, note contents or account identifiers.
 */

import { randomUUID } from "node:crypto";
import express, { NextFunction, Request, Response } from "express";
import { ProviderId, describeConfig, findModel, formatModelRef, loadAiConfig, type ModelSpec } from "./config";
import { AI_FEATURES, AI_FEATURE_LABELS, type AiFeature } from "./features";
import {
  CreditError,
  creditOverview,
  setAccountPlan,
  setSubscriptionStatus,
  updateCreditConfig,
} from "./credits";
import { listModels } from "./providers";
import { clearResponseCache } from "./service";
import { summariseUsage, userUsageDetail } from "./usage";
import {
  configHistorySummary,
  loadOverrides,
  restorePreviousOverrides,
  saveOverrides,
  setUserAiDisabled,
} from "./overrides";
import { buildSpendingOverview } from "./spending";
import { AdminAuthError, adminActor, requireAdmin } from "../security/adminAuth";
import { recordAdminAudit } from "../security/adminAudit";
import {
  loadSupabaseAdminOverview,
  SupabaseOverviewError,
} from "./supabaseOverview";
import {
  AnalyticsError,
  isAnalyticsPreset,
  loadAdminAiAnalytics,
} from "./analytics";
import {
  loadAdminActivityMonitoring,
  MonitoringError,
  normaliseAlertReview,
} from "./activityMonitoring";
import {
  adjustAdminCredits,
  CreditAdminError,
  loadAdminCreditManagement,
  loadAdminCreditUser,
  updateAdminCreditSettings,
} from "./creditAdmin";

const router = express.Router();

const asProvider = (value: unknown): ProviderId | undefined => {
  if (value === "freebuff" || value === "openai" || value === "huggingface") return value;
  return undefined;
};

interface ProviderTest {
  at: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
  modelsAvailable?: number;
  configuredModels?: { id: string; available: boolean }[];
}

/** Last connection test per provider, kept in memory only. */
const lastTests = new Map<ProviderId, ProviderTest>();

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  next();
});

router.use(requireAdmin);

type AuditableRequest = Request & { adminAuditRequestId?: string };

const auditRequestId = (req: Request): string => {
  const auditable = req as AuditableRequest;
  if (!auditable.adminAuditRequestId) auditable.adminAuditRequestId = randomUUID();
  return auditable.adminAuditRequestId;
};

const auditAdminAction = async (
  req: Request,
  input: {
    action: string;
    targetUserId?: string | null;
    success: boolean;
    errorCode?: string | null;
    metadata?: Record<string, unknown>;
  },
) => {
  const actor = adminActor(req);
  if (!actor) return { ok: false, storage: "none" as const };
  return recordAdminAudit({
    actor,
    action: input.action,
    targetUserId: input.targetUserId ?? null,
    success: input.success,
    errorCode: input.errorCode ?? null,
    requestId: auditRequestId(req),
    metadata: input.metadata ?? {},
  });
};

/**
 * Write an attempt record before changing anything. If audit storage is
 * unavailable, refuse the mutation rather than applying an unrecorded change.
 */
const beginAdminAction = async (
  req: Request,
  input: {
    action: string;
    targetUserId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> => {
  const actor = adminActor(req);
  if (!actor) return false;
  const result = await recordAdminAudit({
    actor,
    action: input.action,
    targetUserId: input.targetUserId ?? null,
    success: false,
    errorCode: "attempt",
    requestId: auditRequestId(req),
    metadata: { ...(input.metadata ?? {}), auditPhase: "attempt" },
  });
  return result.ok;
};

const auditUnavailable = (res: Response) =>
  res.status(503).json({
    error: "Administrative audit storage is unavailable, so the change was not applied.",
    code: "audit_unavailable",
  });

export interface BudgetAlert {
  code: string;
  level: "warning" | "critical" | "info";
  message: string;
}

const buildBudget = (config: ReturnType<typeof loadAiConfig>, usage: ReturnType<typeof summariseUsage>) => {
  const limits = config.limits;
  const spent = usage.thisMonth.costAud;
  const today = usage.today.costAud;
  // Round before comparing so an exact boundary such as 0.15 / 0.20 cannot
  // miss the 75% warning because of binary floating-point representation.
  const percentageUsed =
    limits.monthlyBudgetAud > 0
      ? Number((spent / limits.monthlyBudgetAud).toFixed(4))
      : spent > 0
        ? 1
        : 0;
  const hardPercentage =
    limits.monthlyHardLimitAud > 0
      ? Number((spent / limits.monthlyHardLimitAud).toFixed(4))
      : spent > 0
        ? 1
        : 0;
  const alerts: BudgetAlert[] = [];

  if (limits.monthlyHardLimitAud > 0 && spent >= limits.monthlyHardLimitAud) {
    alerts.push({
      code: "monthly-limit",
      level: "critical",
      message: `Monthly hard limit reached: A$${spent.toFixed(2)} of A$${limits.monthlyHardLimitAud.toFixed(2)}. New AI requests are blocked.`,
    });
  }
  if (limits.dailyLimitAud > 0 && today >= limits.dailyLimitAud) {
    alerts.push({
      code: "daily-limit",
      level: "critical",
      message: `Daily spending limit reached: A$${today.toFixed(2)} of A$${limits.dailyLimitAud.toFixed(2)}. New AI requests are blocked until tomorrow.`,
    });
  }
  if (limits.monthlyBudgetAud > 0 && percentageUsed >= 0.75) {
    alerts.push({
      code: "budget-75",
      level: "warning",
      message: `Monthly budget is ${Math.round(percentageUsed * 100)}% used: A$${spent.toFixed(2)} of A$${limits.monthlyBudgetAud.toFixed(2)}.`,
    });
  }
  if (config.disabledByAdmin) {
    alerts.push({
      code: "ai-disabled",
      level: "info",
      message: "AI is paused globally by an administrator. Ordinary app features are still available.",
    });
  }
  const unpricedModels = config.providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) => provider.models.filter((model) => !model.price));
  if (limits.monthlyHardLimitAud > 0 && unpricedModels.length > 0) {
    alerts.push({
      code: "unpriced-model",
      level: "warning",
      message: `Spending cannot be fully enforced for ${unpricedModels.map((model) => model.id).join(", ")} because no price is configured.`,
    });
  }

  return {
    currency: "AUD" as const,
    monthlyBudgetAud: limits.monthlyBudgetAud,
    monthlyHardLimitAud: limits.monthlyHardLimitAud,
    dailyLimitAud: limits.dailyLimitAud,
    currentMonthAud: spent,
    currentDayAud: today,
    remainingBudgetAud: Math.max(0, limits.monthlyBudgetAud - spent),
    remainingHardLimitAud: Math.max(0, limits.monthlyHardLimitAud - spent),
    percentageUsed,
    hardLimitPercentage: hardPercentage,
    monthlyHistory: usage.monthlyHistory,
    alerts,
  };
};

/** Everything the dashboard needs in one response. Never includes a key. */
export const buildOverview = () => {
  const config = loadAiConfig();
  const described = describeConfig(config);
  const overrides = loadOverrides();
  const usage = summariseUsage();
  const budget = buildBudget(config, usage);

  return {
    generatedAt: new Date().toISOString(),
    enabled: config.enabled,
    disabledByAdmin: config.disabledByAdmin,
    defaultModel: described.defaultModel,
    backupModel: described.backupModel,
    fallbackModels: described.fallbackModels,
    featureModels: Object.fromEntries(
      AI_FEATURES.map((feature) => [feature, formatModelRef(config.featureModels[feature]) || null]),
    ),
    disabledModels: described.disabledModels,
    restore: configHistorySummary(),
    order: described.order,
    limits: config.limits,
    warningThresholds: config.warningThresholds,
    modelLimits: config.modelLimits,
    emergency: config.emergency,
    cache: config.cache,
    overrides,
    disabledUsers: config.disabledUsers,
    currency: { code: "AUD" as const, rates: config.audRates },
    budget,
    providers: config.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      billingCurrency: provider.billingCurrency,
      keyPresent: provider.keyPresent,
      configured: provider.keyPresent && provider.models.length > 0,
      enabled: provider.enabled,
      disabledReason: provider.disabledReason,
      baseUrl: provider.baseUrl,
      pinnedProvider: provider.pinnedProvider,
      limits: provider.limits,
      isPrimary: config.defaultModel?.provider === provider.id,
      isBackup: config.backupModel?.provider === provider.id,
      models: provider.models.map((model) => ({
        id: model.id,
        label: model.label,
        enabled: model.enabled !== false,
        disabledBy: model.disabledBy || null,
        price: model.price || null,
        capabilities: model.capabilities,
      })),
    })),
    usage,
    tests: Object.fromEntries(lastTests.entries()),
  };
};

interface SettingsPatchSuccess {
  ok: true;
  defaultModel: string | null;
  backupModel: string | null;
  fallbackModels: string[];
  featureModels: Record<string, string | null>;
  disabledModels: string[];
}

interface SettingsPatchFailure {
  ok: false;
  status: number;
  message: string;
  code: string;
}

interface SettingsPreviewSuccess extends SettingsPatchSuccess {
  chain: string[];
  featureChains: Record<string, string[]>;
  models: Array<{
    ref: string;
    label: string;
    enabled: boolean;
    disabledBy: "environment" | "admin" | null;
    price: ModelSpec["price"] | null;
  }>;
}

/** Validate a dashboard patch without writing it or calling a provider. */
const validateSettingsPatch = (
  body: Record<string, unknown>,
  config: ReturnType<typeof loadAiConfig>,
): SettingsPatchSuccess | SettingsPatchFailure => {
  const fail = (code: string, message: string, status = 400): SettingsPatchFailure => ({
    ok: false,
    status,
    message,
    code,
  });
  const models = new Map<string, ModelSpec>(
    config.providers.flatMap((provider) =>
      provider.models.map((model) => [`${model.provider}:${model.id}`, model] as const),
    ),
  );
  const currentFeature = Object.fromEntries(
    AI_FEATURES.map((feature) => [feature, formatModelRef(config.featureModels[feature]) || null]),
  ) as Record<string, string | null>;
  const currentFallbacks = config.fallbackModels
    .map((model) => formatModelRef(model))
    .filter((ref): ref is string => Boolean(ref));
  const providerStates: Partial<Record<ProviderId, boolean>> = {};
  const bodyProviders =
    body.providers && typeof body.providers === "object" && !Array.isArray(body.providers)
      ? (body.providers as Record<string, unknown>)
      : {};
  for (const provider of config.providers) {
    const requested = bodyProviders[provider.id];
    providerStates[provider.id] = typeof requested === "boolean" ? requested : provider.enabled;
  }

  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const parseRef = (
    value: unknown,
    field: string,
  ): { ok: true; value: string | null } | { ok: false; failure: SettingsPatchFailure } => {
    if (value === null || value === undefined || value === "") return { ok: true, value: null };
    if (typeof value !== "string") {
      return { ok: false, failure: fail("bad_model", `${field} must be a model reference or empty.`) };
    }
    const ref = value.trim();
    return { ok: true, value: ref || null };
  };

  let defaultModel = formatModelRef(config.defaultModel) || null;
  if (has("defaultModel")) {
    const parsed = parseRef(body.defaultModel, "Primary model");
    if (!parsed.ok) return (parsed as { failure: SettingsPatchFailure }).failure;
    defaultModel = parsed.value;
  }

  let fallbackModels = [...currentFallbacks];
  let backupModel = formatModelRef(config.backupModel) || null;
  if (has("fallbackModels")) {
    if (!Array.isArray(body.fallbackModels)) {
      return fail("bad_fallback_models", "Fallback models must be a list.");
    }
    if (body.fallbackModels.length > 3) {
      return fail("too_many_fallbacks", "Choose at most three fallback models.");
    }
    const parsed: string[] = [];
    for (const value of body.fallbackModels) {
      if (typeof value !== "string" || !value.trim()) {
        return fail("bad_fallback_models", "Choose a model for each fallback slot.");
      }
      parsed.push(value.trim());
    }
    fallbackModels = parsed;
    backupModel = parsed[0] || null;
  } else if (has("backupModel")) {
    const parsed = parseRef(body.backupModel, "Fallback model");
    if (!parsed.ok) return (parsed as { failure: SettingsPatchFailure }).failure;
    backupModel = parsed.value;
    fallbackModels = parsed.value ? [parsed.value] : [];
  }
  if (new Set(fallbackModels).size !== fallbackModels.length) {
    return fail("duplicate_fallback", "A fallback model can only be used once.");
  }

  let featureModels: Record<string, string | null> = { ...currentFeature };
  if (has("featureModels")) {
    if (!body.featureModels || typeof body.featureModels !== "object" || Array.isArray(body.featureModels)) {
      return fail("bad_feature_models", "Feature assignments must be an object.");
    }
    const source = body.featureModels as Record<string, unknown>;
    featureModels = { ...currentFeature };
    for (const [feature, value] of Object.entries(source)) {
      if (!(AI_FEATURES as readonly string[]).includes(feature)) {
        return fail("unknown_feature", `Unknown AI feature "${feature}".`);
      }
      const parsed = parseRef(value, `Model for ${AI_FEATURE_LABELS[feature as AiFeature]}`);
      if (!parsed.ok) return (parsed as { failure: SettingsPatchFailure }).failure;
      featureModels[feature] = parsed.value;
    }
  }

  let disabledModels = [...config.disabledModels];
  if (has("disabledModels")) {
    if (!Array.isArray(body.disabledModels)) {
      return fail("bad_disabled_models", "Disabled models must be a list.");
    }
    const parsed: string[] = [];
    for (const value of body.disabledModels) {
      if (typeof value !== "string" || !value.trim()) {
        return fail("bad_disabled_models", "Disabled models must be model references.");
      }
      parsed.push(value.trim());
    }
    if (new Set(parsed).size !== parsed.length) {
      return fail("duplicate_disabled_model", "A model can only be disabled once.");
    }
    disabledModels = parsed;
  }

  for (const ref of disabledModels) {
    if (!models.has(ref)) return fail("unknown_model", `Unknown disabled model "${ref}".`);
  }

  const validateRef = (ref: string, label: string): SettingsPatchFailure | null => {
    const model = models.get(ref);
    if (!model) return fail("unknown_model", `Unknown model "${ref}". Choose a configured model.`);
    if (disabledModels.includes(ref) || model.disabledBy === "environment") {
      return fail("model_disabled", `${model.label} is disabled. Enable it before selecting it for ${label}.`);
    }
    if (!providerStates[model.provider]) {
      return fail("provider_disabled", `${model.provider} is disabled. Enable the provider before choosing its model.`);
    }
    return null;
  };

  if (defaultModel) {
    const error = validateRef(defaultModel, "the primary model");
    if (error) return error;
  }
  for (const ref of fallbackModels) {
    if (ref === defaultModel) return fail("same_model", "A fallback model must differ from the primary model.");
    const error = validateRef(ref, "a fallback");
    if (error) return error;
  }
  for (const [feature, ref] of Object.entries(featureModels)) {
    if (!ref) continue;
    const error = validateRef(ref, AI_FEATURE_LABELS[feature as AiFeature] || feature);
    if (error) return error;
  }

  return {
    ok: true,
    defaultModel,
    backupModel,
    fallbackModels,
    featureModels,
    disabledModels,
  };
};

const settingsPreview = (
  body: Record<string, unknown>,
  config: ReturnType<typeof loadAiConfig>,
): SettingsPreviewSuccess | SettingsPatchFailure => {
  const validation = validateSettingsPatch(body, config);
  if (!validation.ok) return validation as SettingsPatchFailure;
  const chainFor = (featureModel?: string | null) =>
    [
      ...new Set(
        [featureModel, validation.defaultModel, ...validation.fallbackModels].filter(
          (ref): ref is string => Boolean(ref),
        ),
      ),
    ];
  const ordered = chainFor(null);
  return {
    ok: true as const,
    ...validation,
    chain: ordered,
    featureChains: Object.fromEntries(
      Object.entries(validation.featureModels).map(([feature, ref]) => [feature, chainFor(ref)]),
    ),
    models: config.providers.flatMap((provider) =>
      provider.models.map((model) => ({
        ref: `${model.provider}:${model.id}`,
        label: model.label,
        enabled: model.enabled !== false && !validation.disabledModels.includes(`${model.provider}:${model.id}`),
        disabledBy: model.disabledBy || null,
        price: model.price || null,
      })),
    ),
  };
};

router.get("/overview", (_req: Request, res: Response) => {
  res.json(buildOverview());
});

/** Live spending, reservations, limits and emergency status. */
router.get("/spending", async (_req: Request, res: Response) => {
  try {
    return res.json(await buildSpendingOverview());
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : "Spending controls could not be read.",
      code: "spending_unavailable",
    });
  }
});

const spendingLimitKeys = [
  "dailyLimitAud",
  "monthlyHardLimitAud",
  "monthlyBudgetAud",
  "perUserDailyLimitAud",
  "perUserMonthlyLimitAud",
  "requestsPerDay",
  "tokensPerDay",
  "requestsPerDayPerUser",
  "tokensPerDayPerUser",
  "costPerMonthPerUserUsd",
] as const;

const confirmation = (body: Record<string, unknown>): { ok: true; reason: string } | { ok: false; code: string; message: string } => {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (body.confirm !== true) {
    return {
      ok: false,
      code: "confirmation_required",
      message: "Confirm this critical spending change before it is applied.",
    };
  }
  if (reason.length < 3 || reason.length > 300) {
    return {
      ok: false,
      code: "reason_required",
      message: "Record a reason between 3 and 300 characters for this change.",
    };
  }
  return { ok: true, reason };
};

router.post("/spending/settings", async (req: Request, res: Response) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const confirmed = confirmation(body);
  const before = loadOverrides();
  const metadata = { reason: body.reason ?? null, before: before.limits ?? null };
  if (!(await beginAdminAction(req, { action: "ai.spending.settings.change", metadata }))) {
    return auditUnavailable(res);
  }
  const fail = async (status: number, message: string, code: string) => {
    await auditAdminAction(req, {
      action: "ai.spending.settings.change",
      success: false,
      errorCode: code,
      metadata,
    });
    return res.status(status).json({ error: message, code });
  };
  if (confirmed.ok === false) return fail(400, confirmed.message, confirmed.code);
  const confirmedReason = confirmed.reason;

  const config = loadAiConfig();
  const source = body.limits && typeof body.limits === "object" && !Array.isArray(body.limits)
    ? (body.limits as Record<string, unknown>)
    : body;
  const nextLimits: Record<string, number> = {};
  for (const key of spendingLimitKeys) {
    if (!(key in source)) continue;
    const value = Number(source[key]);
    if (!Number.isFinite(value) || value < 0 || value > 100_000) {
      return fail(400, `${key} must be a number from 0 to 100000.`, "bad_spending_limit");
    }
    nextLimits[key] = value;
  }
  if (Object.keys(nextLimits).length === 0) {
    return fail(400, "Choose at least one spending limit to change.", "no_spending_changes");
  }

  const monthlyHard = nextLimits.monthlyHardLimitAud ?? config.limits.monthlyHardLimitAud;
  const monthlyBudget = nextLimits.monthlyBudgetAud ?? config.limits.monthlyBudgetAud;
  if (monthlyBudget > monthlyHard) {
    return fail(400, "The monthly warning target cannot exceed the monthly hard limit.", "budget_above_hard_limit");
  }

  let warningThresholds: number[] | undefined;
  if (body.warningThresholds !== undefined) {
    if (!Array.isArray(body.warningThresholds) || body.warningThresholds.length === 0) {
      return fail(400, "Provide at least one warning threshold.", "bad_warning_thresholds");
    }
    const parsedThresholds = (body.warningThresholds as unknown[])
      .map((value) => Math.round(Number(value)))
      .filter((value): value is number => Number.isFinite(value) && value > 0 && value < 100);
    warningThresholds = [...new Set(parsedThresholds)].sort((a, b) => a - b);
    if (warningThresholds.length === 0 || warningThresholds.length > 6) {
      return fail(400, "Provide between one and six thresholds from 1 to 99 percent.", "bad_warning_thresholds");
    }
  }

  let modelLimits: Record<string, { dailyAud?: number; monthlyAud?: number }> | undefined;
  if (body.modelLimits !== undefined) {
    if (!body.modelLimits || typeof body.modelLimits !== "object" || Array.isArray(body.modelLimits)) {
      return fail(400, "Per-model limits must be an object.", "bad_model_limits");
    }
    const known = new Set(
      config.providers.flatMap((provider) =>
        provider.models.map((model) => `${provider.id}:${model.id}`),
      ),
    );
    modelLimits = {};
    for (const [ref, value] of Object.entries(body.modelLimits as Record<string, unknown>)) {
      if (!known.has(ref) || !value || typeof value !== "object") {
        return fail(400, `Unknown model in per-model limits: ${ref}.`, "bad_model_limits");
      }
      const entry = value as Record<string, unknown>;
      const next: { dailyAud?: number; monthlyAud?: number } = {};
      for (const field of ["dailyAud", "monthlyAud"] as const) {
        if (!(field in entry)) continue;
        const parsed = Number(entry[field]);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000) {
          return fail(400, `${ref} ${field} must be a number from 0 to 100000.`, "bad_model_limits");
        }
        next[field] = parsed;
      }
      if (Object.keys(next).length > 0) modelLimits[ref] = next;
    }
  }

  try {
    saveOverrides({ limits: nextLimits, warningThresholds, modelLimits });
    const after = loadOverrides();
    await auditAdminAction(req, {
      action: "ai.spending.settings.change",
      success: true,
      metadata: {
        ...metadata,
        reason: confirmedReason,
        after: after.limits ?? null,
        warningThresholds: after.warningThresholds ?? null,
        modelLimits: after.modelLimits ?? null,
      },
    });
    return res.json({ ok: true, spending: await buildSpendingOverview(), overview: buildOverview() });
  } catch {
    await auditAdminAction(req, {
      action: "ai.spending.settings.change",
      success: false,
      errorCode: "spending_save_failed",
      metadata: { ...metadata, reason: confirmedReason },
    });
    return res.status(500).json({ error: "The spending limits could not be saved.", code: "spending_save_failed" });
  }
});

router.post("/spending/emergency", async (req: Request, res: Response) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const confirmed = confirmation(body);
  const paused = body.paused === true;
  const metadata = { paused, reason: body.reason ?? null, before: loadAiConfig().emergency };
  if (!(await beginAdminAction(req, { action: "ai.spending.emergency", metadata }))) {
    return auditUnavailable(res);
  }
  const fail = async (status: number, message: string, code: string) => {
    await auditAdminAction(req, {
      action: "ai.spending.emergency",
      success: false,
      errorCode: code,
      metadata,
    });
    return res.status(status).json({ error: message, code });
  };
  if (typeof body.paused !== "boolean") return fail(400, "Choose whether to pause or resume AI.", "bad_emergency_state");
  if (confirmed.ok === false) return fail(400, confirmed.message, confirmed.code);
  const confirmedReason = confirmed.reason;
  const actor = adminActor(req);
  try {
    saveOverrides({
      emergencyPaused: paused,
      emergencyReason: confirmedReason,
      emergencyAt: new Date().toISOString(),
      emergencyBy: actor?.email || actor?.actorId || "administrator",
    });
    await auditAdminAction(req, {
      action: "ai.spending.emergency",
      success: true,
      metadata: { ...metadata, reason: confirmedReason, after: loadAiConfig().emergency },
    });
    return res.json({ ok: true, spending: await buildSpendingOverview(), overview: buildOverview() });
  } catch {
    await auditAdminAction(req, {
      action: "ai.spending.emergency",
      success: false,
      errorCode: "emergency_save_failed",
      metadata: { ...metadata, reason: confirmedReason },
    });
    return res.status(500).json({ error: "The emergency state could not be saved.", code: "emergency_save_failed" });
  }
});

/** Aggregate user and AI statistics from Supabase. Server-only, no PII. */
router.get("/overview/supabase", async (_req: Request, res: Response) => {
  try {
    return res.json(await loadSupabaseAdminOverview());
  } catch (error) {
    if (error instanceof SupabaseOverviewError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    return res.status(503).json({
      error: "Supabase statistics could not be read.",
      code: "supabase_overview_unavailable",
    });
  }
});

/** Filtered AI usage/spend analytics and searchable request history. */
router.get("/analytics", async (req: Request, res: Response) => {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const preset = text(req.query.preset) || "last30";
  if (!isAnalyticsPreset(preset)) {
    return res.status(400).json({
      error: "Choose a valid analytics date range.",
      code: "bad_analytics_preset",
    });
  }
  const integer = (value: unknown, fallback: number) => {
    const parsed = Number.parseInt(text(value), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  try {
    return res.json(
      await loadAdminAiAnalytics({
        preset,
        from: text(req.query.from) || undefined,
        to: text(req.query.to) || undefined,
        provider: text(req.query.provider) || undefined,
        model: text(req.query.model) || undefined,
        action: text(req.query.action) || undefined,
        search: text(req.query.search) || undefined,
        limit: integer(req.query.limit, 25),
        offset: integer(req.query.offset, 0),
      }),
    );
  } catch (error) {
    if (error instanceof AnalyticsError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    return res.status(503).json({
      error: "AI usage analytics could not be read.",
      code: "analytics_unavailable",
    });
  }
});

/** Searchable activity records and advisory unusual-activity alerts. */
router.get("/monitoring", async (req: Request, res: Response) => {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const preset = text(req.query.preset) || "last30";
  if (!isAnalyticsPreset(preset)) {
    return res.status(400).json({
      error: "Choose a valid monitoring date range.",
      code: "bad_monitoring_preset",
    });
  }
  const severity = text(req.query.severity);
  if (severity && severity !== "high" && severity !== "medium" && severity !== "low") {
    return res.status(400).json({ error: "Choose a valid alert severity.", code: "bad_severity" });
  }
  const alertStatus = text(req.query.alertStatus);
  if (alertStatus && alertStatus !== "open" && alertStatus !== "reviewed") {
    return res.status(400).json({ error: "Choose a valid alert status.", code: "bad_alert_status" });
  }
  const integer = (value: unknown, fallback: number) => {
    const parsed = Number.parseInt(text(value), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  try {
    return res.json(
      await loadAdminActivityMonitoring({
        preset,
        from: text(req.query.from) || undefined,
        to: text(req.query.to) || undefined,
        search: text(req.query.search) || undefined,
        severity: severity as "high" | "medium" | "low" | "",
        alertStatus: alertStatus as "open" | "reviewed" | "",
        limit: integer(req.query.limit, 25),
        offset: integer(req.query.offset, 0),
      }),
    );
  } catch (error) {
    if (error instanceof MonitoringError || error instanceof AnalyticsError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    return res.status(503).json({
      error: "User activity and security monitoring could not be read.",
      code: "monitoring_unavailable",
    });
  }
});

/** Record an advisory alert review and its investigation note in the audit log. */
router.post("/monitoring/alerts/review", async (req: Request, res: Response) => {
  let review: ReturnType<typeof normaliseAlertReview>;
  try {
    review = normaliseAlertReview(req.body);
  } catch (error) {
    if (error instanceof MonitoringError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    return res.status(400).json({ error: "Choose a valid alert review.", code: "bad_alert_review" });
  }

  const metadata = {
    alertKey: review.alertKey,
    status: review.status,
    note: review.note,
    automaticAction: false,
  };
  if (!(await beginAdminAction(req, { action: "monitoring.alert.review", metadata }))) {
    return auditUnavailable(res);
  }
  const audited = await auditAdminAction(req, {
    action: "monitoring.alert.review",
    success: true,
    metadata,
  });
  if (!audited?.ok) return auditUnavailable(res);
  return res.json({
    ok: true,
    alertKey: review.alertKey,
    status: review.status,
    note: review.note,
    automaticAction: false,
  });
});

/** Credit plans, action prices, balances and the immutable usage history. */
router.get("/credits", (_req: Request, res: Response) => {
  try {
    return res.json(creditOverview());
  } catch (error) {
    return res.status(500).json({ error: "Credit settings could not be read.", code: "credits_failed" });
  }
});

/** Supabase-backed credit configuration and wallet search. */
router.get("/credits/supabase", async (req: Request, res: Response) => {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const integer = (value: unknown, fallback: number) => {
    const parsed = Number.parseInt(text(value), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  try {
    return res.json(
      await loadAdminCreditManagement({
        search: text(req.query.search),
        limit: integer(req.query.limit, 25),
        offset: integer(req.query.offset, 0),
      }),
    );
  } catch (error) {
    if (error instanceof CreditAdminError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    return res.status(503).json({
      error: "Credit management is temporarily unavailable.",
      code: "credit_management_unavailable",
    });
  }
});

router.get("/credits/supabase/users/:userId", async (req: Request, res: Response) => {
  try {
    return res.json(await loadAdminCreditUser(String(req.params.userId || "").toLowerCase(), 50));
  } catch (error) {
    if (error instanceof CreditAdminError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    return res.status(503).json({
      error: "Credit details are temporarily unavailable.",
      code: "credit_management_unavailable",
    });
  }
});

router.post("/credits/supabase/settings", async (req: Request, res: Response) => {
  const actor = adminActor(req);
  if (!actor) return res.status(401).json({ error: "Administrator access is required.", code: "admin_auth_required" });
  try {
    const config = await updateAdminCreditSettings(
      {
        actions: req.body?.actions && typeof req.body.actions === "object" ? req.body.actions : undefined,
        plans: req.body?.plans && typeof req.body.plans === "object" ? req.body.plans : undefined,
      },
      actor,
      auditRequestId(req),
    );
    return res.json({ ok: true, config });
  } catch (error) {
    if (error instanceof CreditAdminError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    return res.status(503).json({
      error: "Credit settings could not be changed.",
      code: "credit_management_unavailable",
    });
  }
});

router.post("/credits/supabase/adjustments", async (req: Request, res: Response) => {
  const actor = adminActor(req);
  if (!actor) return res.status(401).json({ error: "Administrator access is required.", code: "admin_auth_required" });
  const requestId =
    typeof req.body?.requestId === "string" && req.body.requestId.trim()
      ? req.body.requestId.trim()
      : randomUUID();
  try {
    const result = await adjustAdminCredits(
      {
        userId: String(req.body?.userId || "").toLowerCase(),
        delta: Number(req.body?.delta),
        reason: String(req.body?.reason || ""),
        requestId,
      },
      actor,
      requestId,
    );
    return res.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CreditAdminError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    return res.status(503).json({
      error: "The credit adjustment could not be applied.",
      code: "credit_management_unavailable",
    });
  }
});

router.get("/credits/usage/:userId", (req: Request, res: Response) => {
  try {
    const userId = String(req.params.userId || "").toLowerCase();
    if (!/^[a-f0-9]{16,64}$/.test(userId)) {
      return res.status(400).json({ error: "Choose a valid user.", code: "bad_user_id" });
    }
    const account = creditOverview().accounts.find((entry) => entry.userId === userId) || null;
    return res.json({ usage: userUsageDetail(userId, 100), account });
  } catch (error) {
    return res.status(500).json({ error: "User usage could not be read.", code: "usage_failed" });
  }
});

router.post("/credits/settings", async (req: Request, res: Response) => {
  const metadata = {
    actions: req.body?.actions ?? null,
    plans: req.body?.plans ?? null,
  };
  if (!(await beginAdminAction(req, { action: "credits.settings.change", metadata }))) {
    return auditUnavailable(res);
  }
  try {
    const overview = updateCreditConfig(req.body);
    await auditAdminAction(req, {
      action: "credits.settings.change",
      success: true,
      metadata,
    });
    return res.json({ ok: true, credits: overview });
  } catch (error) {
    const status = error instanceof CreditError ? error.status : 400;
    const code = error instanceof CreditError ? error.code : "bad_credit_settings";
    await auditAdminAction(req, {
      action: "credits.settings.change",
      success: false,
      errorCode: code,
      metadata,
    });
    return res.status(status).json({
      error: error instanceof CreditError ? error.message : "Those credit settings could not be saved.",
      code,
    });
  }
});

router.post("/credits/plan", async (req: Request, res: Response) => {
  const targetUserId =
    typeof req.body?.userId === "string" ? req.body.userId.toLowerCase() : null;
  const metadata = { plan: req.body?.plan ?? null };
  if (
    !(await beginAdminAction(req, {
      action: "credits.plan.change",
      targetUserId,
      metadata,
    }))
  ) {
    return auditUnavailable(res);
  }
  try {
    const overview = setAccountPlan({
      userId: req.body?.userId,
      plan: req.body?.plan,
    });
    await auditAdminAction(req, {
      action: "credits.plan.change",
      targetUserId,
      success: true,
      metadata,
    });
    return res.json({ ok: true, credits: overview });
  } catch (error) {
    const status = error instanceof CreditError ? error.status : 400;
    const code = error instanceof CreditError ? error.code : "bad_credit_plan";
    await auditAdminAction(req, {
      action: "credits.plan.change",
      targetUserId,
      success: false,
      errorCode: code,
      metadata,
    });
    return res.status(status).json({
      error: error instanceof CreditError ? error.message : "That plan could not be applied.",
      code,
    });
  }
});

router.post("/users/ai", async (req: Request, res: Response) => {
  const userId = String(req.body?.userId || "").toLowerCase();
  if (
    !(await beginAdminAction(req, {
      action: "users.ai.change",
      targetUserId: userId || null,
      metadata: { enabled: req.body?.enabled === true },
    }))
  ) {
    return auditUnavailable(res);
  }
  if (!/^[a-f0-9]{16,64}$/.test(userId)) {
    await auditAdminAction(req, {
      action: "users.ai.change",
      targetUserId: userId || null,
      success: false,
      errorCode: "bad_user_id",
      metadata: { enabled: req.body?.enabled === true },
    });
    return res.status(400).json({ error: "Choose a valid user.", code: "bad_user_id" });
  }
  const enabled = req.body?.enabled === true;
  try {
    setUserAiDisabled(userId, !enabled);
    await auditAdminAction(req, {
      action: "users.ai.change",
      targetUserId: userId,
      success: true,
      metadata: { enabled },
    });
    return res.json({ ok: true, overview: buildOverview() });
  } catch {
    await auditAdminAction(req, {
      action: "users.ai.change",
      targetUserId: userId,
      success: false,
      errorCode: "user_ai_failed",
      metadata: { enabled },
    });
    return res.status(500).json({ error: "That user's AI access could not be changed.", code: "user_ai_failed" });
  }
});

router.post("/credits/status", async (req: Request, res: Response) => {
  const targetUserId =
    typeof req.body?.userId === "string" ? req.body.userId.toLowerCase() : null;
  const metadata = { status: req.body?.status ?? null };
  if (
    !(await beginAdminAction(req, {
      action: "credits.subscription_status.change",
      targetUserId,
      metadata,
    }))
  ) {
    return auditUnavailable(res);
  }
  try {
    const overview = setSubscriptionStatus({
      userId: req.body?.userId,
      status: req.body?.status,
    });
    await auditAdminAction(req, {
      action: "credits.subscription_status.change",
      targetUserId,
      success: true,
      metadata,
    });
    return res.json({ ok: true, credits: overview });
  } catch (error) {
    const status = error instanceof CreditError ? error.status : 400;
    const code = error instanceof CreditError ? error.code : "bad_subscription_status";
    await auditAdminAction(req, {
      action: "credits.subscription_status.change",
      targetUserId,
      success: false,
      errorCode: code,
      metadata,
    });
    return res.status(status).json({
      error: error instanceof CreditError ? error.message : "That subscription status could not be changed.",
      code,
    });
  }
});

router.post("/settings", async (req: Request, res: Response) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const config = loadAiConfig();
  const metadata = {
    providers: body.providers ?? null,
    defaultModel: body.defaultModel ?? null,
    backupModel: body.backupModel ?? null,
    fallbackModels: body.fallbackModels ?? null,
    featureModels: body.featureModels ?? null,
    disabledModels: body.disabledModels ?? null,
    limits: body.limits ?? null,
    providerLimits: body.providerLimits ?? null,
    reason: body.reason ?? null,
  };
  if (!(await beginAdminAction(req, { action: "ai.settings.change", metadata }))) {
    return auditUnavailable(res);
  }
  const fail = async (status: number, message: string, code: string) => {
    await auditAdminAction(req, {
      action: "ai.settings.change",
      success: false,
      errorCode: code,
      metadata,
    });
    return res.status(status).json({ error: message, code });
  };

  // Emergency state and global on/off switches have dedicated audited routes.
  // Do not let a generic settings patch set or clear them silently.
  if (["aiEnabled", "emergencyPaused", "emergencyReason", "emergencyAt", "emergencyBy"].some((key) => key in body)) {
    return fail(400, "Use the emergency control endpoint for AI pause state.", "use_emergency_control");
  }
  if (body.limits !== undefined || body.warningThresholds !== undefined || body.modelLimits !== undefined) {
    const confirmed = confirmation(body);
    if (confirmed.ok === false) return fail(400, confirmed.message, confirmed.code);
  }

  if (body.providers && typeof body.providers === "object") {
    for (const [id, enabled] of Object.entries(body.providers as Record<string, unknown>)) {
      const provider = config.providers.find((entry) => entry.id === id);
      if (!provider) continue;
      if (enabled === true && !provider.keyPresent) {
        return fail(
          400,
          `${provider.label} has no API key on this server yet. Set the key, then enable it.`,
          "provider_not_configured",
        );
      }
      if (enabled === true && /terms policy|HF_MODEL|FREEBUFF_MODEL/.test(provider.disabledReason || "")) {
        return fail(
          400,
          `${provider.label} cannot be enabled for this app: ${provider.disabledReason}`,
          "provider_policy_block",
        );
      }
    }
  }

  // Validate the whole candidate selection before writing anything. This also
  // catches a model that would become unavailable because the same request
  // disables its provider or model.
  const validation = validateSettingsPatch(body, config);
  if (!validation.ok) {
    const failure = validation as SettingsPatchFailure;
    return fail(failure.status, failure.message, failure.code);
  }

  const saved = saveOverrides(body);
  // A different model or provider must not serve replies cached under the old one.
  clearResponseCache();
  await auditAdminAction(req, {
    action: "ai.settings.change",
    success: true,
    metadata,
  });
  return res.json({ ok: true, saved, overview: buildOverview() });
});

/** Dry-run a settings patch. No provider request and no configuration write. */
router.post("/settings/test", (req: Request, res: Response) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const preview = settingsPreview(body, loadAiConfig());
  if (!preview.ok) {
    const failure = preview as SettingsPatchFailure;
    return res.status(failure.status).json({ error: failure.message, code: failure.code });
  }
  return res.json(preview);
});

/** Restore the snapshot taken immediately before the last configuration change. */
router.post("/settings/restore", async (req: Request, res: Response) => {
  const metadata = { restore: true };
  if (!(await beginAdminAction(req, { action: "ai.settings.restore", metadata }))) {
    return auditUnavailable(res);
  }
  try {
    const saved = restorePreviousOverrides();
    if (!saved) {
      await auditAdminAction(req, {
        action: "ai.settings.restore",
        success: false,
        errorCode: "no_restore_point",
        metadata,
      });
      return res.status(400).json({ error: "There is no previous configuration to restore.", code: "no_restore_point" });
    }
    clearResponseCache();
    await auditAdminAction(req, {
      action: "ai.settings.restore",
      success: true,
      metadata: {
        ...metadata,
        defaultModel: saved.defaultModel ?? null,
        fallbackModels: saved.fallbackModels ?? null,
        featureModels: saved.featureModels ?? null,
        disabledModels: saved.disabledModels ?? null,
      },
    });
    return res.json({ ok: true, saved, overview: buildOverview() });
  } catch {
    await auditAdminAction(req, {
      action: "ai.settings.restore",
      success: false,
      errorCode: "restore_failed",
      metadata,
    });
    return res.status(500).json({ error: "The previous configuration could not be restored.", code: "restore_failed" });
  }
});

/**
 * Connection test. Uses the provider's model list, so it verifies the key and
 * reachability without spending generation tokens and without ever returning
 * the key or an upstream auth header.
 */
router.post("/test", async (req: Request, res: Response) => {
  const id = asProvider((req.body || {}).provider);
  if (!id) {
    return res.status(400).json({ error: "Choose a provider to test.", code: "bad_provider" });
  }

  const provider = loadAiConfig().providers.find((entry) => entry.id === id);
  if (!provider) {
    return res.status(404).json({ error: "Unknown provider.", code: "not_found" });
  }
  if (!provider.keyPresent) {
    return res.status(400).json({
      error: `${provider.label} has no API key on this server.`,
      code: "not_configured",
    });
  }

  const startedAt = Date.now();
  try {
    const models = await listModels(provider, 10_000);
    const available = new Set(models.map((entry) => entry.id));
    const result: ProviderTest = {
      at: new Date().toISOString(),
      ok: true,
      latencyMs: Date.now() - startedAt,
      modelsAvailable: models.length,
      configuredModels: provider.models.map((model) => ({
        id: model.id,
        available: available.has(model.id),
      })),
    };
    lastTests.set(id, result);
    return res.json({ provider: id, ...result });
  } catch (error) {
    const message = (error as Error).message || "The provider could not be reached.";
    const result: ProviderTest = {
      at: new Date().toISOString(),
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: message.slice(0, 200),
    };
    lastTests.set(id, result);
    return res.json({ provider: id, ...result });
  }
});

router.all("*", (_req: Request, res: Response) => {
  res.setHeader("Allow", "GET, POST");
  res.status(404).json({ error: "Unknown admin route.", code: "not_found" });
});

router.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof AdminAuthError) {
    const message =
      error.status === 403
        ? "Administrator access is required."
        : error.status === 503
          ? "Administrator access is not configured on this server."
          : "Administrator authentication is required.";
    return res.status(error.status).json({ error: message, code: error.message });
  }
  const status = error?.status === 413 ? 413 : 400;
  res.status(status).json({
    error: status === 413 ? "That change is too large." : "The request could not be read.",
    code: status === 413 ? "payload_too_large" : "bad_json",
  });
});

export default router;
