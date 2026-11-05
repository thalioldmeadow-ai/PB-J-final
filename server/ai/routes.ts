/**
 * HTTP surface for the AI system. Everything here is same-origin, JSON only,
 * unauthenticated by design (the app has no server-side accounts) and budgeted
 * per client so one device cannot drain the keys.
 */

import express, { Request, Response } from "express";
import { AgeBand, ProviderId, describeConfig, loadAiConfig } from "./config";
import {
  CreditError,
  assertAttachmentAccess,
  classifyCreditAction,
  claimCreditAccount,
  creditHistory,
  creditSummary,
  ensureCreditAccount,
  refundCredits,
  reserveCredits,
  settleCredits,
  validRequestId,
} from "./credits";
import { authUser, optionalAuth, requireAuth } from "../auth";
import { listModels } from "./providers";
import { AiError, ChatRequest, chat, chatStream } from "./service";
import { clientUsage, recordRequest, recordSafety, summariseUsage, userUsage } from "./usage";

const router = express.Router();

const minuteHits = new Map<string, { count: number; resetAt: number }>();

/** The verified session is the only source of quota and wallet identity. */
const clientId = (req: Request): string => authUser(req)?.id || req.ip || "unknown";

/**
 * AI requests are tied to a vault credential, not just a caller-provided hash.
 * The hash identifies the wallet; the credential proves the caller owns it.
 */
const creditIdentity = (req: Request): { userId: string } => {
  const user = authUser(req);
  if (!user) {
    throw new AiError(
      "Sign in to your account to use the AI assistant.",
      401,
      "auth_required",
    );
  }
  return { userId: user.id };
};

const requestId = (req: Request): string => {
  const value = (req.get("x-ai-request-id") || "").trim();
  if (!validRequestId(value)) {
    throw new AiError("A valid AI request id is required.", 400, "bad_request_id");
  }
  return value;
};

const refundQuietly = (userId: string, id: string) => {
  try {
    return refundCredits({ userId, requestId: id });
  } catch {
    return undefined;
  }
};

const isRateLimited = (req: Request): boolean => {
  const limit = loadAiConfig().limits.requestsPerMinutePerClient;
  const now = Date.now();
  const id = clientId(req);
  const entry = minuteHits.get(id);

  if (!entry || entry.resetAt <= now) {
    minuteHits.set(id, { count: 1, resetAt: now + 60_000 });
    if (minuteHits.size > 2_000) minuteHits.clear();
    return false;
  }

  entry.count += 1;
  return entry.count > limit;
};

const asAgeBand = (value: unknown): AgeBand =>
  value === "child" || value === "teen" ? value : "adult";

const asProvider = (value: unknown): ProviderId | undefined => {
  if (value === "freebuff" || value === "openai" || value === "huggingface") return value;
  return undefined;
};

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  next();
});

router.use(optionalAuth);

/**
 * Public status/usage responses carry aggregate counters only. Per-user
 * hashes and request rows stay behind the admin token.
 */
const publicUsage = () => {
  const { byUser, recentRequests, ...safe } = summariseUsage();
  void byUser;
  void recentRequests;
  return safe;
};

/** Create or return the one wallet owned by the verified account. */
router.post("/credits/register", requireAuth, (req: Request, res: Response) => {
  if (isRateLimited(req)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Try again in a minute.", code: "rate_limited" });
  }
  try {
    const summary = ensureCreditAccount(authUser(req)!.id);
    return res.json({ ok: true, credits: summary });
  } catch (error) {
    return fail(res, error);
  }
});

router.post("/wallet", requireAuth, (req: Request, res: Response) => {
  if (isRateLimited(req)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Try again in a minute.", code: "rate_limited" });
  }
  try {
    return res.json({ ok: true, credits: ensureCreditAccount(authUser(req)!.id) });
  } catch (error) {
    return fail(res, error);
  }
});

/** One-time move of the legacy browser-hash wallet to the verified account. */
router.post("/wallet/claim", requireAuth, (req: Request, res: Response) => {
  try {
    const summary = claimCreditAccount({
      legacyUserId: req.body?.legacyUserId,
      legacyToken: req.body?.legacyToken,
      userId: authUser(req)!.id,
    });
    return res.json({ ok: true, credits: summary });
  } catch (error) {
    return fail(res, error);
  }
});

router.get("/credits", (req: Request, res: Response) => {
  try {
    const identity = creditIdentity(req);
    return res.json({ credits: creditSummary(identity.userId) });
  } catch (error) {
    return fail(res, error);
  }
});

router.get("/credits/history", (req: Request, res: Response) => {
  try {
    const identity = creditIdentity(req);
    return res.json({ history: creditHistory(identity.userId, 30) });
  } catch (error) {
    return fail(res, error);
  }
});

router.get("/status", (req: Request, res: Response) => {
  const config = loadAiConfig();
  const key = authUser(req)?.id;
  res.json({
    ...describeConfig(config),
    usage: publicUsage(),
    client: clientUsage(clientId(req)),
    user: key ? userUsage(key) : null,
    clientLimits: { requestsPerDay: config.limits.requestsPerDayPerClient },
    userLimits: {
      requestsPerDay: config.limits.requestsPerDayPerUser,
      tokensPerDay: config.limits.tokensPerDayPerUser,
      costPerMonthUsd: config.limits.costPerMonthPerUserUsd,
      perUserDailyLimitAud: config.limits.perUserDailyLimitAud,
      perUserMonthlyLimitAud: config.limits.perUserMonthlyLimitAud,
    },
    memoryLimit: config.memoryLimit,
    retention: { serverKeepsPrompts: false, ledgerKeepsContent: false },
  });
});

router.get("/providers", (_req: Request, res: Response) => {
  const config = loadAiConfig();
  const described = describeConfig(config);
  res.json({ enabled: described.enabled, order: described.order, providers: described.providers });
});

/** Live model discovery, so a stale model id is visible instead of guessed. */
router.get("/models", async (req: Request, res: Response) => {
  const config = loadAiConfig();
  const requested = asProvider(req.query.provider);

  const targets = config.providers.filter(
    (provider) => provider.keyPresent && (!requested || provider.id === requested),
  );

  if (targets.length === 0) {
    return res.status(503).json({ error: "No provider key is set.", code: "not_configured" });
  }

  const results = await Promise.all(
    targets.map(async (provider) => {
      try {
        const models = await listModels(provider);
        return {
          provider: provider.id,
          ok: true,
          modelCount: models.length,
          available: models.map((entry) => entry.id),
          configured: provider.models.map((model) => ({
            id: model.id,
            available: models.some((entry) => entry.id === model.id),
          })),
        };
      } catch (error) {
        return {
          provider: provider.id,
          ok: false,
          error: (error as Error).message,
          configured: provider.models.map((model) => ({ id: model.id, available: null })),
        };
      }
    }),
  );

  res.json({ checkedAt: new Date().toISOString(), providers: results });
});

router.get("/usage", (req: Request, res: Response) => {
  const config = loadAiConfig();
  // The global ledger is public; per-user detail follows the verified session.
  const key = authUser(req)?.id;
  res.json({
    usage: publicUsage(),
    user: key ? userUsage(key) : null,
    limits: config.limits,
    cache: { enabled: config.cache.enabled, ttlSeconds: config.cache.ttlSeconds },
  });
});

const requestFromBody = (req: Request) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (typeof body.message !== "string") {
    throw new AiError("A message is required.", 400, "bad_request");
  }
  return {
    message: body.message,
    history: Array.isArray(body.history) ? body.history : [],
    memory: Array.isArray(body.memory) ? body.memory.map(String) : [],
    context: body.context && typeof body.context === "object" ? body.context : {},
    ageBand: asAgeBand(body.ageBand),
    name: typeof body.name === "string" ? body.name : undefined,
    mode: typeof body.mode === "string" ? body.mode : undefined,
    actions: Array.isArray(body.actions) ? body.actions.map(String) : [],
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    summary: typeof body.summary === "string" ? body.summary : undefined,
    provider: asProvider(body.provider),
    model: typeof body.model === "string" ? body.model : undefined,
    clientId: clientId(req),
    userKey: authUser(req)?.id,
  };
};

const fail = (res: Response, error: unknown) => {
  if (error instanceof AiError) {
    if (error.retryAfterSeconds) res.setHeader("Retry-After", String(error.retryAfterSeconds));
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  if (error instanceof CreditError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error("AI request failed:", (error as Error).message);
  return res.status(500).json({ error: "Something went wrong.", code: "internal" });
};

const logUsage = (entry: {
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
  startedAt: number;
  status: "success" | "failed";
  estimatedUsage?: boolean;
}) =>
  recordRequest({
    requestId: entry.requestId,
    userId: entry.userId,
    provider: entry.provider,
    model: entry.model,
    action: entry.action,
    plan: entry.plan,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    credits: entry.credits,
    costUsd: entry.costUsd,
    costAud: entry.costAud,
    durationMs: Math.max(0, Date.now() - entry.startedAt),
    status: entry.status,
    timestamp: new Date(entry.startedAt).toISOString(),
    estimatedUsage: entry.estimatedUsage,
  });

router.post("/chat", async (req: Request, res: Response) => {
  if (isRateLimited(req)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({
      error: "That is a lot of messages at once. Give it a minute.",
      code: "rate_limited",
    });
  }

  let identity: { userId: string } | undefined;
  let request: ChatRequest | undefined;
  let id = "";
  let action: ReturnType<typeof classifyCreditAction> = "simple_message";
  let plan = "free";
  let reserved = false;
  let reservedCredits = 0;
  let logged = false;
  const startedAt = Date.now();
  try {
    request = requestFromBody(req);
    identity = creditIdentity(req);
    id = requestId(req);
    const entitlements = assertAttachmentAccess(identity.userId, request.attachments.length);
    action = classifyCreditAction({ mode: request.mode, attachments: request.attachments });
    plan = entitlements.tier;
    request = { ...request, requestId: id, spendAction: action, spendPlan: plan };
    const reservation = reserveCredits({ userId: identity.userId, action, requestId: id });
    reserved = true;
    reservedCredits = reservation.credits;

    const response = await chat({ ...request, entitlements });
    const isSafety = response.model === "safety-guard";
    const credits = isSafety
      ? refundCredits({ userId: identity.userId, requestId: id })
      : settleCredits({ userId: identity.userId, requestId: id });
    logUsage({
      requestId: id,
      userId: identity.userId,
      provider: response.provider,
      model: response.model,
      action,
      plan,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      credits: isSafety ? 0 : reservedCredits,
      costUsd: response.usage.costUsd,
      costAud: response.usage.costAud,
      startedAt,
      status: "success",
      estimatedUsage: response.usage.estimated,
    });
    logged = true;
    return res.json({ ...response, credits });
  } catch (error) {
    // Only the request that created this reservation may release it. A retry
    // rejected as duplicate/in-progress shares the same request id and must
    // never refund the first request while it is still running.
    if (reserved && identity) refundQuietly(identity.userId, id);
    if (reserved && identity && !logged) {
      logUsage({
        requestId: id,
        userId: identity.userId,
        provider: request?.provider || "auto",
        model: request?.model || "auto",
        action,
        plan,
        inputTokens: 0,
        outputTokens: 0,
        credits: 0,
        costUsd: 0,
        costAud: 0,
        startedAt,
        status: "failed",
      });
    }
    return fail(res, error);
  }
});

/** Server-sent events: deltas as they arrive, then one done or error frame. */
router.post("/chat/stream", async (req: Request, res: Response) => {
  if (isRateLimited(req)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({
      error: "That is a lot of messages at once. Give it a minute.",
      code: "rate_limited",
    });
  }

  let request: ChatRequest | undefined;
  let identity: { userId: string } | undefined;
  let id = "";
  let action: ReturnType<typeof classifyCreditAction> = "simple_message";
  let plan = "free";
  let reserved = false;
  let reservedCredits = 0;
  let logged = false;
  const startedAt = Date.now();

  try {
    request = requestFromBody(req);
    identity = creditIdentity(req);
    id = requestId(req);
    const entitlements = assertAttachmentAccess(identity.userId, request.attachments.length);
    action = classifyCreditAction({ mode: request.mode, attachments: request.attachments });
    plan = entitlements.tier;
    request = { ...request, requestId: id, spendAction: action, spendPlan: plan };
    const reservation = reserveCredits({ userId: identity.userId, action, requestId: id });
    reserved = true;
    reservedCredits = reservation.credits;
    request = { ...request, entitlements };
  } catch (error) {
    return fail(res, error);
  }

  const logFailure = () => {
    if (!reserved || !identity || logged) return;
    logUsage({
      requestId: id,
      userId: identity.userId,
      provider: request?.provider || "auto",
      model: request?.model || "auto",
      action,
      plan,
      inputTokens: 0,
      outputTokens: 0,
      credits: 0,
      costUsd: 0,
      costAud: 0,
      startedAt,
      status: "failed",
    });
    logged = true;
  };

  // Refuse before opening the stream, so a browser sees a real status code
  // instead of a 200 carrying an error frame.
  if (!loadAiConfig().enabled) {
    if (identity) refundQuietly(identity.userId, id);
    logFailure();
    return res.status(503).json({
      error: "The assistant is not configured on this server yet.",
      code: "not_configured",
    });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": stream open\n\n");

  // Listen on the response, not the request: the request's close event fires as
  // soon as the body has been read, which would stop the stream immediately.
  let closed = false;
  res.on("close", () => {
    closed = true;
  });

  const send = (payload: unknown) => {
    if (closed || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let settled = false;
  try {
    for await (const event of chatStream(request)) {
      if (closed) break;
      if (event.type === "done") {
        const isSafety = event.response.model === "safety-guard";
        const credits = isSafety
          ? refundCredits({ userId: identity.userId, requestId: id })
          : settleCredits({ userId: identity.userId, requestId: id });
        logUsage({
          requestId: id,
          userId: identity.userId,
          provider: event.response.provider,
          model: event.response.model,
          action,
          plan,
          inputTokens: event.response.usage.inputTokens,
          outputTokens: event.response.usage.outputTokens,
          credits: isSafety ? 0 : reservedCredits,
          costUsd: event.response.usage.costUsd,
          costAud: event.response.usage.costAud,
          startedAt,
          status: "success",
          estimatedUsage: event.response.usage.estimated,
        });
        logged = true;
        settled = true;
        send({ ...event, credits });
        continue;
      }
      if (event.type === "error") {
        const credits = refundQuietly(identity.userId, id);
        logFailure();
        settled = true;
        send({ ...event, credits });
        continue;
      }
      send(event);
    }
  } catch (error) {
    refundQuietly(identity.userId, id);
    logFailure();
    settled = true;
    send({
      type: "error",
      error: error instanceof AiError ? error.message : "Something went wrong.",
      code: error instanceof AiError ? error.code : "internal",
    });
  } finally {
    if (!settled && identity) refundQuietly(identity.userId, id);
    logFailure();
    if (!res.writableEnded) {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
  return undefined;
});

router.post("/report", requireAuth, (req: Request, res: Response) => {
  if (isRateLimited(req)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Try again in a minute.", code: "rate_limited" });
  }

  // A report carries a reason category only. The reply itself stays on the
  // device, so the server never learns what was written.
  const allowed = ["inaccurate", "unsafe", "unhelpful", "other"];
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "other";
  recordSafety("reported", `report-${allowed.includes(reason) ? reason : "other"}`);
  return res.json({ ok: true });
});

router.all("*", (_req: Request, res: Response) => {
  res.setHeader("Allow", "GET, POST");
  res.status(404).json({ error: "Unknown AI route.", code: "not_found" });
});

/** Malformed JSON must not produce an HTML error page or a stack trace. */
router.use((error: any, _req: Request, res: Response, _next: express.NextFunction) => {
  const status = error?.status === 413 ? 413 : 400;
  res.status(status).json({
    error: status === 413 ? "That message is too long." : "The request could not be read.",
    code: status === 413 ? "payload_too_large" : "bad_json",
  });
});

export default router;
