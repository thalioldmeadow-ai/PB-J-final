/**
 * The one AI service the app talks to.
 *
 * Features never call a provider. They describe what they want (a message, some
 * context, an age band) and this module decides which provider and model to
 * use, builds the instructions, enforces budgets, moderates both directions,
 * handles failures and walks a bounded fallback chain.
 *
 * Two rules are deliberately kept out of the model's hands:
 * - crisis resources are appended here, in code, whenever distress is detected;
 * - action proposals are stripped here unless the action is allowed on the
 *   screen that asked, so a stray block can never reach the interface.
 */

import { createHash } from "crypto";
import {
  AgeBand,
  AiConfig,
  ModelSpec,
  ProviderId,
  ProviderSpec,
  formatModelRef,
  loadAiConfig,
} from "./config";
import { AI_FEATURES, type AiFeature } from "./features";
import { ChatTurn, ProviderError, completeChat, listModels, streamChat } from "./providers";
import { ACTION_NAMES, FEATURE_MODES, PromptAttachment, PromptInput, buildMessages } from "./prompts";
import type { SubscriptionEntitlements } from "./credits";
import {
  assessMessage,
  crisisAppendix,
  moderateOutput,
  refusalFor,
  sanitiseText,
  stripDisallowedActionBlocks,
} from "./safety";
import {
  checkClientLimit,
  checkLimits,
  checkModelLimit,
  checkProviderLimit,
  checkUserLimits,
  estimateCosts,
  recordCacheHit,
  recordFailure,
  recordSafety,
  recordUsage,
} from "./usage";
import { reserveProtectedSpend, type SpendReservation } from "./spendProtection";

/** Never walk more than three providers, so a total outage fails fast. */
const MAX_ATTEMPTS = 3;

/** Live model lists, cached briefly so validation does not cost a call each time. */
const modelCache = new Map<string, { at: number; ids: Set<string> }>();

export interface ChatRequest {
  message: string;
  history?: ChatTurn[];
  summary?: string;
  memory?: string[];
  context?: Record<string, unknown>;
  ageBand?: AgeBand;
  name?: string;
  /** Screen hint and the actions allowed there; both are whitelisted below. */
  mode?: string;
  actions?: string[];
  /** Files attached to this message, validated and size-limited below. */
  attachments?: unknown[];
  provider?: ProviderId;
  model?: string;
  /** Anonymous per-install id, used only for per-client quotas. */
  clientId?: string;
  /** One-way hash from the browser, used only for per-user quotas. */
  userKey?: string;
  /** Tier limits resolved by the route before the request reaches the model. */
  entitlements?: SubscriptionEntitlements;
  /** Stable id shared with the credit ledger and the spend reservation. */
  requestId?: string;
  /** Content-free labels recorded with the provider usage event. */
  spendAction?: string;
  spendPlan?: string;
}

export interface ChatResponse {
  reply: string;
  provider: ProviderId;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    costAud: number;
    estimated: boolean;
  };
  latencyMs: number;
  fellBack: boolean;
  streaming: boolean;
  cached: boolean;
  safety: { crisis: boolean; blocked: boolean; flags?: string[] };
  /** What was actually sent, so the interface can be honest about it. */
  shared: { contextTopics: string[]; memoryCount: number; historyTurns: number; summarised: boolean };
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

const enabledProvider = (config: AiConfig, model: ModelSpec): ProviderSpec | undefined =>
  model.enabled === false
    ? undefined
    : config.providers.find((provider) => provider.id === model.provider && provider.enabled);

/**
 * Requested model first, then the configured default, then the backup, then any
 * other enabled provider. Duplicates are dropped and the chain is capped.
 */
export const buildModelChain = (config: AiConfig, request: ChatRequest): ModelSpec[] => {
  const chain: ModelSpec[] = [];
  const push = (model?: ModelSpec) => {
    if (!model) return;
    if (chain.some((entry) => entry.provider === model.provider && entry.id === model.id)) return;
    if (!enabledProvider(config, model)) return;
    chain.push(model);
  };

  if (request.provider) {
    const requested = config.providers
      .find((provider) => provider.id === request.provider)
      ?.models.find((model) => !request.model || model.id === request.model);
    push(requested);
  }
  if (request.mode && (AI_FEATURES as readonly string[]).includes(request.mode)) {
    push(config.featureModels[request.mode as AiFeature]);
  }
  push(config.defaultModel);
  for (const fallback of config.fallbackModels) push(fallback);
  for (const id of config.order) {
    const provider = config.providers.find((entry) => entry.id === id && entry.enabled);
    if (provider?.models.length) push(provider.models.find((model) => model.enabled !== false));
  }
  return chain.slice(0, MAX_ATTEMPTS);
};

/** Drop models the provider no longer serves, when validation is switched on. */
const validateChain = async (config: AiConfig, chain: ModelSpec[]): Promise<ModelSpec[]> => {
  if (!config.validateModels || chain.length === 0) return chain;

  const checked: ModelSpec[] = [];
  for (const model of chain) {
    const provider = enabledProvider(config, model);
    if (!provider) continue;

    try {
      const cached = modelCache.get(provider.id);
      let ids: Set<string>;
      if (cached && Date.now() - cached.at < 60_000) {
        ids = cached.ids;
      } else {
        const live = await listModels(provider);
        ids = new Set(live.map((entry) => entry.id));
        modelCache.set(provider.id, { at: Date.now(), ids });
      }
      if (ids.has(model.id)) checked.push(model);
    } catch {
      // If the list cannot be fetched, keep the configured model rather than
      // refusing to answer at all.
      checked.push(model);
    }
  }
  return checked;
};

/** Context comes from the browser, so it is size-limited and flattened first. */
const MAX_CONTEXT_CHARS = 8_000;
const MAX_RAW_CONTEXT_CHARS = 32_000;
const MAX_MEMORY_CHARS = 1_600;
const MAX_SUMMARY_CHARS = 500;

const sanitiseContext = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  // A payload this large is a mistake, not a snapshot: refuse it rather than
  // silently discarding most of someone's data.
  let rawSize = 0;
  try {
    rawSize = JSON.stringify(raw).length;
  } catch {
    rawSize = MAX_RAW_CONTEXT_CHARS + 1;
  }
  if (rawSize > MAX_RAW_CONTEXT_CHARS) {
    throw new AiError(
      "The app data sent with that message is larger than this server accepts.",
      400,
      "context_too_large",
    );
  }

  const trim = (value: unknown, depth = 0): unknown => {
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return value.slice(0, 200);
    if (Array.isArray(value)) {
      return depth >= 3 ? [] : value.slice(0, 20).map((item) => trim(item, depth + 1));
    }
    if (typeof value === "object") {
      if (depth >= 3) return {};
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
        out[String(key).slice(0, 40)] = trim(entry, depth + 1);
      }
      return out;
    }
    return undefined;
  };

  const cleaned = (trim(raw) || {}) as Record<string, unknown>;
  if (JSON.stringify(cleaned).length > MAX_CONTEXT_CHARS) {
    throw new AiError(
      "The app data sent with that message is larger than this server accepts.",
      400,
      "context_too_large",
    );
  }
  return cleaned;
};

/** Memory is user-authored text, so it is clamped and bounded in total. */
const sanitiseMemory = (raw: unknown, limit: number): string[] => {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  let total = 0;
  for (const entry of raw.slice(0, Math.max(0, limit))) {
    const clean = sanitiseText(String(entry || ""), 200).replace(/\s+/g, " ").trim();
    if (!clean) continue;
    if (total + clean.length > MAX_MEMORY_CHARS) break;
    out.push(clean);
    total += clean.length;
  }
  return out;
};

/** Only recent turns, only real roles, and a total size the prompt can absorb. */
const sanitiseHistory = (raw: unknown, countLimit: number, charLimit: number): ChatTurn[] => {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  let total = 0;
  for (const turn of raw.slice(-countLimit)) {
    if (!turn || (turn.role !== "user" && turn.role !== "assistant")) continue;
    const content = sanitiseText(String(turn.content || ""), 2_000);
    if (!content) continue;
    if (total + content.length > charLimit) break;
    turns.push({ role: turn.role, content });
    total += content.length;
  }
  return turns;
};

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_DATA_CHARS = 500_000;
const MAX_ATTACHMENT_TEXT_CHARS = 6_000;
const MAX_ATTACHMENT_TEXT_TOTAL = 12_000;

/** Attachments arrive from the browser, so their shape and size are rebuilt here. */
const sanitiseAttachments = (raw: unknown, maxAttachments = MAX_ATTACHMENTS): PromptAttachment[] => {
  if (!Array.isArray(raw) || maxAttachments <= 0) return [];
  const out: PromptAttachment[] = [];
  let textTotal = 0;

  for (const entry of raw.slice(0, Math.min(MAX_ATTACHMENTS, maxAttachments))) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = sanitiseText(String(record.name || ""), 80).replace(/\s+/g, " ").trim();
    if (!name) continue;

    const kind = record.kind === "image" || record.kind === "video" ? record.kind : "file";
    const mime =
      sanitiseText(String(record.mime || ""), 80).replace(/\s+/g, " ").trim() ||
      "application/octet-stream";
    const size = Math.max(0, Math.min(Number(record.size) || 0, 50_000_000));
    const dataValue = typeof record.dataUrl === "string" ? record.dataUrl : "";
    const dataUrl =
      (kind === "image" || kind === "video") &&
      dataValue.length <= MAX_ATTACHMENT_DATA_CHARS &&
      /^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(dataValue)
        ? dataValue
        : undefined;
    const rawText =
      typeof record.text === "string"
        ? sanitiseText(record.text, MAX_ATTACHMENT_TEXT_CHARS)
        : "";
    const text =
      rawText && textTotal < MAX_ATTACHMENT_TEXT_TOTAL
        ? rawText.slice(0, MAX_ATTACHMENT_TEXT_TOTAL - textTotal)
        : undefined;
    if (text) textTotal += text.length;

    out.push({ name, mime, size, kind, dataUrl, text });
  }

  return out;
};

interface Prepared {
  config: AiConfig;
  messages: ChatTurn[];
  safety: { crisis: boolean; blocked: boolean; refusal?: string; flags: string[] };
  chain: ModelSpec[];
  shared: ChatResponse["shared"];
  cacheKey?: string;
  ageBand: AgeBand;
  allowedActions: string[];
  message: string;
}

const prepare = async (request: ChatRequest): Promise<Prepared> => {
  const config = loadAiConfig();

  if (!config.enabled) {
    throw new AiError(
      config.disabledByAdmin
        ? "The assistant is paused by an administrator. Ordinary app features still work."
        : "The assistant is not configured on this server yet.",
      503,
      config.disabledByAdmin ? "ai_disabled" : "not_configured",
    );
  }

  if (request.userKey && config.disabledUsers.includes(request.userKey)) {
    throw new AiError(
      "AI is paused for this account. An administrator can turn it back on.",
      403,
      "user_ai_disabled",
    );
  }

  const entitlements = request.entitlements;
  const attachments = sanitiseAttachments(
    request.attachments,
    entitlements?.maxAttachments ?? MAX_ATTACHMENTS,
  );
  const typedMessage = sanitiseText(request.message || "", config.maxMessageChars);
  if (!typedMessage && attachments.length === 0) {
    throw new AiError("Say something first.", 400, "empty_message");
  }
  const message = typedMessage || "Please look at the attached files.";

  const ageBand: AgeBand =
    request.ageBand === "child" || request.ageBand === "teen" ? request.ageBand : "adult";

  const global = checkLimits(config.limits);
  if (!global.allowed) {
    throw new AiError(
      global.reason === "monthly-budget"
        ? "The assistant has reached its monthly budget. It will be back next month."
        : "The assistant has reached its limit for today. Try again tomorrow.",
      429,
      global.reason || "limit",
      global.reason === "monthly-budget" ? undefined : 3_600,
    );
  }

  if (request.clientId) {
    const client = checkClientLimit(request.clientId, config.limits.requestsPerDayPerClient);
    if (!client.allowed) {
      throw new AiError(
        "This device has used its share of assistant messages for today.",
        429,
        "client_limit",
        client.retryAfterSeconds,
      );
    }
  }

  if (request.userKey) {
    const user = checkUserLimits(request.userKey, {
      requestsPerDay: entitlements?.requestsPerDay ?? config.limits.requestsPerDayPerUser,
      tokensPerDay: entitlements?.tokensPerDay ?? config.limits.tokensPerDayPerUser,
      costPerMonthUsd: config.limits.costPerMonthPerUserUsd,
      dailyLimitAud: config.limits.perUserDailyLimitAud,
      monthlyLimitAud: config.limits.perUserMonthlyLimitAud,
    });
    if (!user.allowed) {
      throw new AiError(
        user.reason === "user-monthly-budget"
          ? "You have reached your share of the assistant budget for this month."
          : "You have reached your share of assistant messages for today. It resets tomorrow.",
        429,
        user.reason || "user_limit",
        user.retryAfterSeconds,
      );
    }
  }

  const safety = assessMessage(message, ageBand);
  if (safety.blockedReason) {
    return {
      config,
      messages: [],
      safety: {
        crisis: safety.crisis,
        blocked: true,
        refusal: `${refusalFor(safety.blockedReason, ageBand)}${
          safety.crisis ? crisisAppendix(ageBand) : ""
        }`,
        flags: safety.flags,
      },
      chain: [],
      shared: { contextTopics: [], memoryCount: 0, historyTurns: 0, summarised: false },
      ageBand,
      allowedActions: [],
      message,
    };
  }

  const history = sanitiseHistory(
    request.history,
    entitlements?.historyLimit ?? config.historyLimit,
    entitlements?.historyCharLimit ?? config.historyCharLimit,
  );
  const memory = sanitiseMemory(request.memory, entitlements?.memoryLimit ?? config.memoryLimit);
  const context = sanitiseContext(request.context);
  const summary = sanitiseText(String(request.summary || ""), MAX_SUMMARY_CHARS);
  const allowedActions = Array.isArray(request.actions)
    ? request.actions
        .filter((action) => (ACTION_NAMES as readonly string[]).includes(action))
        .slice(0, 6)
    : [];

  const promptInput: PromptInput = {
    message,
    history,
    summary: summary || undefined,
    memory,
    context,
    ageBand,
    name: request.name ? sanitiseText(String(request.name), 60) : undefined,
    mode: FEATURE_MODES.includes(request.mode as (typeof FEATURE_MODES)[number])
      ? (request.mode as string)
      : undefined,
    actions: allowedActions,
    injection: safety.injection,
    attachments,
  };

  const messages = buildMessages(promptInput, safety.crisis);

  const chain = await validateChain(config, buildModelChain(config, request));
  if (chain.length === 0) {
    throw new AiError(
      "No AI provider is enabled on this server, or every configured model is unavailable.",
      503,
      "not_configured",
    );
  }

  // The cache key covers everything that can change the answer, including the
  // model in use, so switching provider never serves another model's reply.
  const cacheKey = createHash("sha256")
    .update(
      JSON.stringify({
        message,
        history,
        summary,
        memory,
        context,
        ageBand,
        mode: promptInput.mode,
        actions: allowedActions,
        attachments,
        model: formatModelRef(chain[0] || config.defaultModel),
      }),
    )
    .digest("hex");

  return {
    config,
    messages,
    safety: { crisis: safety.crisis, blocked: false, flags: safety.flags },
    chain,
    shared: {
      contextTopics: Object.keys(context),
      memoryCount: memory.length,
      historyTurns: history.length,
      summarised: Boolean(summary),
    },
    cacheKey,
    ageBand,
    allowedActions,
    message,
  };
};

interface CacheEntry {
  at: number;
  response: ChatResponse;
}

const responseCache = new Map<string, CacheEntry>();

const readCache = (key: string, ttlSeconds: number): ChatResponse | undefined => {
  const entry = responseCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > ttlSeconds * 1_000) {
    responseCache.delete(key);
    return undefined;
  }
  // Refresh insertion order so a frequently used entry is evicted last.
  responseCache.delete(key);
  responseCache.set(key, entry);
  return entry.response;
};

const writeCache = (key: string, response: ChatResponse, config: AiConfig): void => {
  if (!config.cache.enabled || config.cache.ttlSeconds <= 0) return;
  responseCache.set(key, { at: Date.now(), response });
  while (responseCache.size > config.cache.maxEntries) {
    const oldest = responseCache.keys().next().value;
    if (oldest === undefined) break;
    responseCache.delete(oldest);
  }
};

/** Test helper: forget cached replies. */
export const clearResponseCache = (): void => {
  responseCache.clear();
};

const record = (
  model: ModelSpec,
  result: { inputTokens: number; outputTokens: number; latencyMs?: number },
  request: ChatRequest,
  fellBack = false,
): { costUsd: number; costAud: number } => {
  const costs = estimateCosts(model, result.inputTokens, result.outputTokens);
  recordUsage({
    model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: costs.costUsd,
    costAud: costs.costAud,
    clientId: request.clientId,
    userKey: request.userKey,
    latencyMs: result.latencyMs,
    fellBack,
  });
  return { costUsd: costs.costUsd, costAud: costs.costAud };
};

/**
 * A conservative ceiling for one in-flight request. This is not usage
 * estimation: it only reserves headroom against the configured output cap and
 * the serialised prompt size, then reconciles to provider-reported usage when
 * the reply lands. Without it, a burst of concurrent requests could all pass
 * the same pre-flight budget check.
 */
const maxRequestCostAud = (config: AiConfig, messages: ChatTurn[]): number => {
  const inputUpperBound = Math.max(1_000, JSON.stringify(messages).length * 4 + 4_000);
  return Math.max(
    0,
    ...buildModelCosts(config, inputUpperBound),
  );
};

const buildModelCosts = (config: AiConfig, inputUpperBound: number): number[] =>
  config.providers.flatMap((provider) =>
    provider.enabled
      ? provider.models
          .filter((model) => model.enabled !== false)
          .map((model) => {
            const output = Math.min(config.maxOutputTokens, provider.limits.maxOutputTokens);
            return estimateCosts(model, inputUpperBound, output).costAud;
          })
      : [],
  );

const budgetDenied = (reason: string | undefined): AiError =>
  new AiError(
    reason === "monthly-budget"
      ? "The assistant has reached its monthly hard spending limit. It will resume next month or when an administrator raises the limit."
      : reason === "user-monthly-budget"
        ? "You have reached your share of the assistant budget for this month."
        : reason === "user-daily-budget"
          ? "You have reached your share of the assistant spending for today. It resets tomorrow."
          : "The assistant has reached its daily spending limit. Try again tomorrow.",
    429,
    reason || "budget_limit",
    reason === "monthly-budget" || reason === "user-monthly-budget" ? undefined : 3_600,
  );

const settleSpend = async (
  spend: SpendReservation,
  model: ModelSpec,
  result: { inputTokens: number; outputTokens: number; latencyMs?: number; estimatedUsage?: boolean },
  request: ChatRequest,
  costs: { costUsd: number; costAud: number },
) => {
  try {
    await spend.settle({
      provider: model.provider,
      model: model.id,
      action: request.spendAction || "simple_message",
      plan: request.spendPlan || "free",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      credits: 0,
      costUsd: costs.costUsd,
      costAud: costs.costAud,
      durationMs: result.latencyMs || 0,
      estimatedUsage: Boolean(result.estimatedUsage),
    });
  } catch {
    // The user already has the reply. A settlement transport failure leaves
    // the reservation for server-side expiry; it must not turn into an error.
  }
};

/** A failed attempt is counted against the provider so the dashboard can show it. */
const noteProviderFailure = (error: unknown, model: ModelSpec) => {
  const status = error instanceof ProviderError ? error.status : 502;
  recordFailure({ provider: model.provider, model: model.id, rateLimited: status === 429 });
};

/** Moderation flags are counted by identifier, never by message text. */
const noteModeration = (flags: string[]) => {
  if (flags.length > 0) recordSafety("moderation", flags[0]);
};

/** Apply output moderation, allowed-action filtering and crisis resources. */
const finaliseReply = (
  text: string,
  prepared: Prepared,
  extraFlags: string[] = [],
): { reply: string; blocked: boolean; flags: string[] } => {
  const moderated = (() => {
    try {
      return moderateOutput(text, {
        ageBand: prepared.ageBand,
        userMessage: prepared.message,
        maxChars: prepared.config.maxReplyChars,
        crisis: prepared.safety.crisis,
      });
    } catch {
      // A moderation failure must fail closed: show a safe refusal, not raw text.
      recordSafety("error", "moderation-error");
      return { text: refusalFor("blocked", prepared.ageBand), blocked: true, flags: ["moderation-error"] };
    }
  })();
  let reply = stripDisallowedActionBlocks(moderated.text, prepared.allowedActions);
  if (prepared.safety.crisis) reply = `${reply}${crisisAppendix(prepared.ageBand)}`;
  noteModeration(moderated.flags);
  return {
    reply,
    blocked: moderated.blocked,
    flags: [...new Set([...prepared.safety.flags, ...moderated.flags, ...extraFlags])],
  };
};

const cachedResponse = (cached: ChatResponse, shared: ChatResponse["shared"]): ChatResponse => ({
  ...cached,
  latencyMs: 0,
  cached: true,
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, costAud: 0, estimated: false },
  shared,
});

export const chat = async (request: ChatRequest): Promise<ChatResponse> => {
  const prepared = await prepare(request);
  const { config, messages, safety, chain } = prepared;

  if (safety.blocked) {
    recordSafety("blocked", safety.flags[0]);
    return {
      reply: safety.refusal || refusalFor("blocked", prepared.ageBand),
      provider: config.defaultModel?.provider || "freebuff",
      model: "safety-guard",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        costAud: 0,
        estimated: false,
      },
      latencyMs: 0,
      fellBack: false,
      streaming: false,
      cached: false,
      safety: { crisis: safety.crisis, blocked: true, flags: safety.flags },
      shared: prepared.shared,
    };
  }

  // A crisis reply is never cached: it is personal and must not be served to
  // someone else, even with an identical prompt.
  const useCache = config.cache.enabled && !safety.crisis && Boolean(prepared.cacheKey);
  if (useCache && prepared.cacheKey) {
    const hit = readCache(prepared.cacheKey, config.cache.ttlSeconds);
    if (hit) {
      recordCacheHit();
      return cachedResponse(hit, prepared.shared);
    }
  }

  const spend = await reserveProtectedSpend({
    requestId: request.requestId,
    userId: request.userKey,
    maxCostAud: maxRequestCostAud(config, messages),
    dailyLimitAud: config.limits.dailyLimitAud,
    monthlyHardLimitAud: config.limits.monthlyHardLimitAud,
    perUserDailyLimitAud: config.limits.perUserDailyLimitAud,
    perUserMonthlyLimitAud: config.limits.perUserMonthlyLimitAud,
  });
  if (!spend.allowed) throw budgetDenied(spend.reason);

  try {
    for (const [index, model] of chain.entries()) {
      const provider = enabledProvider(config, model);
      if (!provider) continue;

      const providerBudget = checkProviderLimit(provider.id, provider.limits.requestsPerDay);
      if (!providerBudget.allowed) continue;
      const modelRef = formatModelRef(model) || `${model.provider}:${model.id}`;
      const modelLimit = config.modelLimits[modelRef];
      if (modelLimit && !checkModelLimit(modelRef, modelLimit).allowed) continue;

      try {
        const result = await completeChat({
        provider,
        model,
        messages,
        temperature: config.temperature,
        maxOutputTokens: Math.min(config.maxOutputTokens, provider.limits.maxOutputTokens),
        timeoutMs: config.timeoutMs,
      });

        const costs = record(model, result, request, index > 0);
        const final = finaliseReply(result.text, prepared);

        const response: ChatResponse = {
          reply: final.reply,
          provider: result.provider,
          model: result.model,
          usage: {
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costUsd: costs.costUsd,
            costAud: costs.costAud,
            estimated: result.estimatedUsage,
          },
          latencyMs: result.latencyMs,
          fellBack: index > 0,
          streaming: false,
          cached: false,
          safety: { crisis: safety.crisis, blocked: final.blocked, flags: final.flags },
          shared: prepared.shared,
        };

        if (useCache && prepared.cacheKey && !final.blocked) {
          writeCache(prepared.cacheKey, response, config);
        }
        await settleSpend(spend, model, result, request, costs);
        return response;
      } catch (error) {
        noteProviderFailure(error, model);
        // A malformed request would fail the same way on every provider.
        if (error instanceof ProviderError && error.status === 400) break;
      }
    }
  } finally {
    await spend.release();
  }

  throw new AiError(
    "The assistant could not answer just now. Your message was not saved anywhere.",
    502,
    "provider_failed",
  );
};

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; response: ChatResponse }
  | { type: "error"; error: string; code: string };

/**
 * Streaming variant. Fallback happens only before the first delta, so the user
 * never sees two half answers spliced together.
 *
 * Streaming is skipped for children, teens and crisis conversations, because a
 * token-by-token reply cannot be moderated before it is displayed. Those cases
 * use the blocking path and get the full output filter.
 */
export async function* chatStream(request: ChatRequest): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const prepared = await prepare(request);
  const { config, messages, safety, chain } = prepared;

  if (safety.blocked) {
    recordSafety("blocked", safety.flags[0]);
    const reply = safety.refusal || refusalFor("blocked", prepared.ageBand);
    yield { type: "delta", text: reply };
    yield {
      type: "done",
      response: {
        reply,
        provider: config.defaultModel?.provider || "freebuff",
        model: "safety-guard",
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, costAud: 0, estimated: false },
        latencyMs: 0,
        fellBack: false,
        streaming: false,
        cached: false,
        safety: { crisis: safety.crisis, blocked: true, flags: safety.flags },
        shared: prepared.shared,
      },
    };
    return;
  }

  const useCache = config.cache.enabled && !safety.crisis && Boolean(prepared.cacheKey);
  if (useCache && prepared.cacheKey) {
    const hit = readCache(prepared.cacheKey, config.cache.ttlSeconds);
    if (hit) {
      recordCacheHit();
      const response = cachedResponse(hit, prepared.shared);
      yield { type: "delta", text: response.reply };
      yield { type: "done", response };
      return;
    }
  }

  const spend = await reserveProtectedSpend({
    requestId: request.requestId,
    userId: request.userKey,
    maxCostAud: maxRequestCostAud(config, messages),
    dailyLimitAud: config.limits.dailyLimitAud,
    monthlyHardLimitAud: config.limits.monthlyHardLimitAud,
    perUserDailyLimitAud: config.limits.perUserDailyLimitAud,
    perUserMonthlyLimitAud: config.limits.perUserMonthlyLimitAud,
  });
  if (!spend.allowed) {
    yield {
      type: "error",
      error:
        spend.reason === "monthly-budget"
          ? "The assistant has reached its monthly hard spending limit. It will resume next month or when an administrator raises the limit."
          : "The assistant has reached its daily spending limit. Try again tomorrow.",
      code: spend.reason || "budget_limit",
    };
    return;
  }

  const streamingAllowed =
    config.streaming && prepared.ageBand === "adult" && !safety.crisis;

  try {
    for (const [index, model] of chain.entries()) {
    const provider = enabledProvider(config, model);
    if (!provider) continue;

    const providerBudget = checkProviderLimit(provider.id, provider.limits.requestsPerDay);
    if (!providerBudget.allowed) continue;
    const modelRef = formatModelRef(model) || `${model.provider}:${model.id}`;
    const modelLimit = config.modelLimits[modelRef];
    if (modelLimit && !checkModelLimit(modelRef, modelLimit).allowed) continue;

    const maxOutputTokens = Math.min(config.maxOutputTokens, provider.limits.maxOutputTokens);

    if (!streamingAllowed) {
      try {
        const result = await completeChat({
          provider,
          model,
          messages,
          temperature: config.temperature,
          maxOutputTokens,
          timeoutMs: config.timeoutMs,
        });
        const costs = record(model, result, request, index > 0);
        const final = finaliseReply(result.text, prepared);
        const response: ChatResponse = {
          reply: final.reply,
          provider: result.provider,
          model: result.model,
          usage: {
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costUsd: costs.costUsd,
            costAud: costs.costAud,
            estimated: result.estimatedUsage,
          },
          latencyMs: result.latencyMs,
          fellBack: index > 0,
          streaming: false,
          cached: false,
          safety: { crisis: safety.crisis, blocked: final.blocked, flags: final.flags },
          shared: prepared.shared,
        };
        if (useCache && prepared.cacheKey && !final.blocked) {
          writeCache(prepared.cacheKey, response, config);
        }
        await settleSpend(spend, model, result, request, costs);
        yield { type: "delta", text: response.reply };
        yield { type: "done", response };
        return;
      } catch (error) {
        noteProviderFailure(error, model);
        if (error instanceof ProviderError && error.status === 400) break;
        continue;
      }
    }

    let emitted = false;
    try {
      const stream = streamChat({
        provider,
        model,
        messages,
        temperature: config.temperature,
        maxOutputTokens,
        timeoutMs: config.timeoutMs,
      });

      for await (const event of stream) {
        if (event.type === "delta") {
          emitted = true;
          yield { type: "delta", text: event.text };
          continue;
        }

        const result = event.result;
        const costs = record(model, result, request, index > 0);
        const final = finaliseReply(result.text, prepared);
        const response: ChatResponse = {
          reply: final.reply,
          provider: result.provider,
          model: result.model,
          usage: {
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costUsd: costs.costUsd,
            costAud: costs.costAud,
            estimated: result.estimatedUsage,
          },
          latencyMs: result.latencyMs,
          fellBack: index > 0,
          streaming: true,
          cached: false,
          safety: { crisis: safety.crisis, blocked: final.blocked, flags: final.flags },
          shared: prepared.shared,
        };
        if (useCache && prepared.cacheKey && !final.blocked) {
          writeCache(prepared.cacheKey, response, config);
        }
        await settleSpend(spend, model, result, request, costs);
        yield { type: "done", response };
        return;
      }
    } catch (error) {
      noteProviderFailure(error, model);
      // Once text has reached the user, switching provider would duplicate it.
      if (emitted) {
        yield {
          type: "error",
          error: "The reply stopped part way through. Try again.",
          code: "stream_interrupted",
        };
        return;
      }
      if (error instanceof ProviderError && error.status === 400) break;
    }
  }

    yield {
      type: "error",
      error: "The assistant could not answer just now. Your message was not saved anywhere.",
      code: "provider_failed",
    };
  } finally {
    await spend.release();
  }
}

export const status = () => {
  const config = loadAiConfig();
  return { config, chain: buildModelChain(config, { message: "" }).map(formatModelRef) };
};
