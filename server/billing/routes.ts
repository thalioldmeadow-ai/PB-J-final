/**
 * RevenueCat HTTP surface.
 *
 * The webhook is authenticated independently of the admin token because it is
 * called by RevenueCat, not the browser. The sync/link routes require the same
 * vault credential as the wallet, so a modified frontend cannot attach somebody
 * else's RevenueCat customer to its own account.
 */

import express, { Request, Response } from "express";
import {
  CreditError,
  creditSummary,
  findCreditAccountByRevenueCatIds,
} from "../ai/credits";
import { authUser, requireAuth } from "../auth";
import {
  BillingError,
  processRevenueCatWebhook,
  revenueCatConfigured,
  revenueCatPublicConfig,
  revenueCatWebhookAuthorized,
  syncRevenueCatCustomer,
} from "./revenuecat";

const router = express.Router();

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  next();
});

const fail = (res: Response, error: unknown) => {
  if (error instanceof BillingError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  if (error instanceof CreditError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error("RevenueCat request failed:", (error as Error).message);
  return res.status(500).json({ error: "Billing could not be updated.", code: "billing_error" });
};

/** Safe public configuration. Never returns a key, secret or webhook value. */
router.get("/revenuecat/config", (_req: Request, res: Response) => {
  res.json({ billing: revenueCatPublicConfig(), configured: revenueCatConfigured() });
});

router.post("/revenuecat/webhook", async (req: Request, res: Response) => {
  if (!revenueCatWebhookAuthorized(req.get("authorization"))) {
    return res.status(401).json({ error: "Webhook authentication failed.", code: "unauthorized" });
  }
  try {
    const result = await processRevenueCatWebhook(req.body);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return fail(res, error);
  }
});

/** The app calls this after purchase or restore; it re-checks RevenueCat. */
router.post("/revenuecat/sync", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = authUser(req)!;
    // Never accept a customer id from the browser here: otherwise a wallet
    // could attach somebody else's paid customer and claim their entitlement.
    // The default id is the one-way wallet hash; aliases arrive only through
    // the authenticated RevenueCat webhook.
    const account = findCreditAccountByRevenueCatIds([user.id]);
    const customerId = account?.revenueCatCustomerId || user.id;
    const verification = await syncRevenueCatCustomer(customerId);
    return res.json({
      ok: true,
      verification,
      credits: creditSummary(user.id),
    });
  } catch (error) {
    return fail(res, error);
  }
});

router.all("*", (_req: Request, res: Response) => {
  res.setHeader("Allow", "GET, POST");
  res.status(404).json({ error: "Unknown billing route.", code: "not_found" });
});

router.use((error: any, _req: Request, res: Response, _next: express.NextFunction) => {
  const status = error?.status === 413 ? 413 : 400;
  res.status(status).json({
    error: status === 413 ? "That billing payload is too large." : "The billing request could not be read.",
    code: status === 413 ? "payload_too_large" : "bad_json",
  });
});

export default router;