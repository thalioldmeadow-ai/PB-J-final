# RevenueCat subscription setup (sandbox only)

The server remains the source of truth for Free and Plus permissions. RevenueCat
is the purchase and store-lifecycle source; its authenticated dashboard webhook
and server-side verification only update the existing wallet ledger in
`data/ai-credits.json`. The browser cannot set a tier, balance or entitlement.

## What is ready

- Plus product identifiers are configured with `REVENUECAT_PRODUCT_PLUS_MONTHLY`
  and `REVENUECAT_PRODUCT_PLUS_ANNUAL`; extra products can be listed in
  `REVENUECAT_PLUS_PRODUCTS`.
- `REVENUECAT_PLUS_ENTITLEMENT` (default `plus`) maps a RevenueCat entitlement to
  the existing Plus plan. No entitlement means Free.
- Every credit account stores its RevenueCat App User ID. New accounts default to
  the wallet's one-way user hash. A browser cannot attach an arbitrary customer
  id; aliases are accepted only from the authenticated RevenueCat webhook.
- The webhook is `POST /api/billing/revenuecat/webhook`.
- Verification is `POST /api/billing/revenuecat/sync`, authenticated with the
  same vault headers as the wallet.
- `GET /api/billing/revenuecat/config` returns product and environment metadata
  only. It never returns the secret key or webhook value.

## Sandbox configuration

Use only sandbox credentials. Keep `REVENUECAT_LIVE_PAYMENTS=false` and leave
production keys out of this project.

```dotenv
REVENUECAT_ENVIRONMENT="SANDBOX"
REVENUECAT_LIVE_PAYMENTS="false"
VITE_REVENUECAT_WEB_API_KEY="test_your_public_web_billing_key"
REVENUECAT_PLUS_ENTITLEMENT="pb_j_pro"
REVENUECAT_PRODUCT_PLUS_MONTHLY="monthly"
REVENUECAT_PRODUCT_PLUS_ANNUAL="yearly"
REVENUECAT_PRODUCT_PLUS_LIFETIME="lifetime"
REVENUECAT_SECRET_KEY="rc_sandbox_..."
REVENUECAT_WEBHOOK_AUTH="a long random webhook authorization value"
REVENUECAT_API_BASE="https://api.revenuecat.com/v1"
```

`VITE_REVENUECAT_WEB_API_KEY` is the **public** Web Billing SDK key. It is
intentionally shipped to the browser. Never put `REVENUECAT_SECRET_KEY` in a
`VITE_` variable or in client code.

## Web SDK integration

The browser SDK is installed as `@revenuecat/purchases-js` and configured once
with the verified account id:

```ts
const purchases = Purchases.configure({
  apiKey: import.meta.env.VITE_REVENUECAT_WEB_API_KEY,
  appUserId: signedInUser.id,
});
```

Use the same account id as the server's `revenueCatCustomerId` (the verified
Supabase/user id). The app then:

1. Calls `getOfferings()` and uses the current offering.
2. Maps `offering.monthly`, `offering.annual` and `offering.lifetime` to the
   Monthly, Yearly and Lifetime cards. Product identifiers can also be
   `monthly`, `yearly` and `lifetime`.
3. Checks `customerInfo.entitlements.active.pb_j_pro.isActive`.
4. Calls `purchase({ rcPackage })`, or `presentPaywall()` when the offering has
   a dashboard Paywall attached.
5. Posts to `/api/billing/revenuecat/sync` after a purchase so the server
   re-verifies the customer with its secret key before granting Plus.

### RevenueCat dashboard setup

1. Create a Web Billing app and copy its **public test SDK key**.
2. Create products with identifiers `monthly`, `yearly` and `lifetime`. Make
   `lifetime` a non-consumable one-time product.
3. Create the entitlement `pb_j_pro` and attach all three products to it.
4. Create an offering containing packages with the standard Monthly, Annual and
   Lifetime package types, and make it the current offering.
5. Optionally attach a Paywall to that offering. Without one, the app shows its
   own package cards and still uses the same SDK purchase flow.
6. Add `VITE_REVENUECAT_WEB_API_KEY` to `.env` (or the host's browser build
   environment), restart Vite, and rebuild.

A key beginning with `test_` opens RevenueCat's **Test Store** checkout. It
lets you exercise the complete SDK flow without charging a card, but it is not
a live payment. Use a live Web Billing key and Stripe configuration only when
you are ready to sell, and leave `REVENUECAT_LIVE_PAYMENTS=false` until then.

If the current offering has no Paywall attached, `offering.hasPaywall` is
false and the app shows its own Monthly/Yearly/Lifetime cards. Attach a
Paywall in the dashboard to enable the hosted `presentPaywall()` overlay; no
code change is needed.

### Paywall and Customer Center on Web

`presentPaywall()` is supported on Web and opens RevenueCat's hosted Paywall as
a full-screen overlay. A Paywall must be attached to the current offering in the
dashboard.

Customer Center is **not supported on Web**. The app uses
`CustomerInfo.managementURL` (or the active subscription's management URL) for
the hosted RevenueCat/Stripe customer portal. `restorePurchases()` is also not
available on Web; signing in with the same App User ID and calling
`getCustomerInfo()` restores the entitlement view.

### CSP and payments

The server CSP allows only `js.stripe.com`, RevenueCat's API, and Stripe's
subdomains in addition to the app origin. `payment=(self)` is enabled for the
browser payment flow. If you switch to Paddle billing, add its required domains
to the CSP instead of weakening it with a wildcard.

In the RevenueCat dashboard:

1. Create the Plus entitlement and sandbox products.
2. Configure the webhook URL as
   `https://your-app.example/api/billing/revenuecat/webhook`.
3. Set the webhook Authorization value to `REVENUECAT_WEBHOOK_AUTH`.
4. When the app is wired to the purchase SDK, configure it with the wallet's
   RevenueCat App User ID (the same value sent as `x-serene-user`). Do not use a
   user-editable id, because that could attach somebody else's entitlement.
5. Run `npm run billing:test`; it uses a local test double and no live services.

Production events are ignored while the server is in sandbox mode. This prevents
a production purchase from granting access to a sandbox deployment.

## Lifecycle mapping

| RevenueCat event | Stored result | Access |
| --- | --- | --- |
| `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE`, `SUBSCRIPTION_EXTENDED` | Plus, active, refreshed period | Plus |
| `CANCELLATION` | Plus, canceled, `cancelAtPeriodEnd` and paid expiry retained | Plus until expiry |
| `BILLING_ISSUE` | Plus, past due, grace expiry retained | Plus through paid period or grace |
| `EXPIRATION` | Free, expired | Free |
| `REFUND` | Free, refunded | Free |
| `TRANSFER` | Source downgraded; destination re-verified | Destination Plus if verified |
| `SUBSCRIPTION_PAUSED` | Plus until period end | Plus until expiry |

A paid period that runs out without a webhook is reconciled on the next server
read, so access still falls back to Free. Webhook event IDs are stored, making
retries idempotent; a replayed purchase cannot refill credits.

## Product and entitlement rules

RevenueCat grants Plus only when the event carries the configured entitlement or
one of the configured Plus product IDs. Other products are ignored, so a
non-Plus purchase cannot accidentally promote an account. No client request can
write `plan`, `subscriptionStatus`, balances or entitlement limits directly.

## Deliberately not enabled

- No live checkout or payment credentials.
- No automatic charging from this app.
- No production key in `.env.example`.
- No browser-side fallback that grants Plus when verification is unavailable.
