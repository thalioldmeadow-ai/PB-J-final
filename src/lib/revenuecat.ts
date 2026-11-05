import {
  ErrorCode,
  PackageType,
  Purchases,
  PurchasesError,
  type CustomerInfo,
  type Offering,
  type Offerings,
  type Package,
  type PaywallPurchaseResult,
  type PurchaseResult,
} from '@revenuecat/purchases-js';

/**
 * Browser side of RevenueCat Web Billing.
 *
 * The public SDK key is intentionally browser-visible; the secret key and
 * webhook authorization stay on the server. The app user id is the same
 * verified account id the server already uses for its RevenueCat customer, so
 * a purchase made here can be verified server-side by `/api/billing/revenuecat/sync`.
 *
 * Web does not support `restorePurchases()` or Customer Center. Restoring is
 * handled by signing in with the same account and refreshing customer info;
 * subscription management uses RevenueCat's `managementURL` (the hosted
 * customer portal / Stripe portal).
 */

export const REVENUECAT_ENTITLEMENT = 'pb_j_pro';

const rawApiKey = (import.meta.env.VITE_REVENUECAT_WEB_API_KEY || '').trim();
const configured =
  rawApiKey.length > 0 && !rawApiKey.includes('YOUR_') && !rawApiKey.includes('REPLACE_');

export const revenueCatClientConfigured = configured;

export class RevenueCatClientError extends Error {
  constructor(
    message: string,
    readonly code = 'revenuecat_error',
  ) {
    super(message);
    this.name = 'RevenueCatClientError';
  }
}

export type BillingPlanId = 'monthly' | 'yearly' | 'lifetime';

export interface BillingPlan {
  id: BillingPlanId;
  label: string;
  cadence: string;
  detail: string;
  package: Package;
  price: string;
}

export interface BillingSnapshot {
  offerings: Offerings;
  customerInfo: CustomerInfo;
  offering: Offering | null;
  proActive: boolean;
  managementUrl: string | null;
  plans: BillingPlan[];
}

let purchasesPromise: Promise<Purchases> | null = null;

const requireConfigured = (): void => {
  if (!configured) {
    throw new RevenueCatClientError(
      'RevenueCat checkout is not configured. Add VITE_REVENUECAT_WEB_API_KEY to the app environment and rebuild.',
      'not_configured',
    );
  }
};

/**
 * Configure the singleton once, then switch identity when a different app
 * user signs in. RevenueCat permits only one shared instance per page.
 */
export const getRevenueCat = async (appUserId: string): Promise<Purchases> => {
  requireConfigured();
  const id = appUserId.trim();
  if (!id) {
    throw new RevenueCatClientError('Sign in before opening subscription checkout.', 'missing_user');
  }

  if (!purchasesPromise) {
    purchasesPromise = Promise.resolve()
      .then(() => Purchases.configure({ apiKey: rawApiKey, appUserId: id }))
      .catch((error) => {
        purchasesPromise = null;
        throw error;
      });
  }

  const purchases = await purchasesPromise;
  if (purchases.getAppUserId() !== id) {
    await purchases.changeUser(id);
  }
  return purchases;
};

/** Documented Web entitlement check: inspect the active entitlement map. */
export const hasProEntitlement = (customerInfo: CustomerInfo | null | undefined): boolean => {
  if (!customerInfo) return false;
  return Boolean(customerInfo.entitlements.active[REVENUECAT_ENTITLEMENT]?.isActive);
};

export const managementUrlFor = (customerInfo: CustomerInfo | null | undefined): string | null => {
  if (!customerInfo) return null;
  const entitlement = customerInfo.entitlements.active[REVENUECAT_ENTITLEMENT];
  const subscription = entitlement
    ? customerInfo.subscriptionsByProductIdentifier[entitlement.productIdentifier]
    : undefined;
  return subscription?.managementURL || customerInfo.managementURL || null;
};

const packageFor = (
  offering: Offering,
  packageType: PackageType,
  productId: string,
): Package | null => {
  return (
    offering.availablePackages.find((entry) => entry.packageType === packageType) ||
    offering.availablePackages.find(
      (entry) => entry.product.identifier.trim().toLowerCase() === productId,
    ) ||
    offering.availablePackages.find(
      (entry) => entry.identifier.trim().toLowerCase() === productId,
    ) ||
    null
  );
};

const priceFor = (pkg: Package): string => pkg.product.price?.formattedPrice || 'Price in checkout';

/** Turn an offering into the three plans this app sells. */
export const billingPlansFor = (offering: Offering | null | undefined): BillingPlan[] => {
  if (!offering) return [];
  const rows: Array<{
    id: BillingPlanId;
    label: string;
    cadence: string;
    detail: string;
    pkg: Package | null;
  }> = [
    {
      id: 'monthly',
      label: 'Monthly',
      cadence: 'per month',
      detail: 'Flexible access, billed monthly.',
      pkg: offering.monthly || packageFor(offering, PackageType.Monthly, 'monthly'),
    },
    {
      id: 'yearly',
      label: 'Yearly',
      cadence: 'per year',
      detail: 'One annual payment for the full year.',
      pkg: offering.annual || packageFor(offering, PackageType.Annual, 'yearly'),
    },
    {
      id: 'lifetime',
      label: 'Lifetime',
      cadence: 'one time',
      detail: 'Pay once and keep access.',
      pkg: offering.lifetime || packageFor(offering, PackageType.Lifetime, 'lifetime'),
    },
  ];

  return rows
    .filter((row): row is typeof row & { pkg: Package } => Boolean(row.pkg))
    .map((row) => ({
      id: row.id,
      label: row.label,
      cadence: row.cadence,
      detail: row.detail,
      package: row.pkg,
      price: priceFor(row.pkg),
    }));
};

export const loadBillingSnapshot = async (appUserId: string): Promise<BillingSnapshot> => {
  const purchases = await getRevenueCat(appUserId);
  const [offerings, customerInfo] = await Promise.all([
    purchases.getOfferings(),
    purchases.getCustomerInfo(),
  ]);
  const offering = offerings.current;
  return {
    offerings,
    customerInfo,
    offering,
    proActive: hasProEntitlement(customerInfo),
    managementUrl: managementUrlFor(customerInfo),
    plans: billingPlansFor(offering),
  };
};

const locale = (): string => {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language || 'en';
};

const termsUrl = (): string | undefined => {
  if (typeof window === 'undefined') return undefined;
  return `${window.location.origin}${window.location.pathname}#/terms`;
};

export const purchaseBillingPlan = async (input: {
  appUserId: string;
  plan: Package;
  email?: string;
}): Promise<PurchaseResult> => {
  const purchases = await getRevenueCat(input.appUserId);
  return purchases.purchase({
    rcPackage: input.plan,
    customerEmail: input.email?.trim() || undefined,
    selectedLocale: locale(),
    termsAndConditionsUrl: termsUrl(),
  });
};

/**
 * Render RevenueCat's hosted Paywall as a full-screen overlay. If the offering
 * has no paywall attached in the dashboard, the caller should show its own
 * package cards instead.
 */
export const presentBillingPaywall = async (input: {
  appUserId: string;
  offering: Offering | null;
  email?: string;
}): Promise<PaywallPurchaseResult> => {
  if (!input.offering?.hasPaywall) {
    throw new RevenueCatClientError(
      'This RevenueCat offering does not have a Paywall attached yet.',
      'paywall_not_configured',
    );
  }
  const purchases = await getRevenueCat(input.appUserId);
  return purchases.presentPaywall({
    offering: input.offering,
    customerEmail: input.email?.trim() || undefined,
    selectedLocale: locale(),
    onBack: (closePaywall) => closePaywall(),
    onNavigateToUrl: (url) => {
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },
  });
};

export interface ServerBillingSync {
  ok: boolean;
  verification?: {
    matched: boolean;
    duplicate?: boolean;
    plan: 'free' | 'plus';
    status: string;
    expiresAt?: string;
  };
}

/**
 * Ask the server to re-read RevenueCat with its secret key and update the
 * authoritative app entitlement. Never grant access from the browser result.
 */
export const syncServerBilling = async (): Promise<ServerBillingSync> => {
  const response = await fetch('/api/billing/revenuecat/sync', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // Keep a useful fallback below for an HTML/proxy error.
  }
  if (!response.ok) {
    throw new RevenueCatClientError(
      typeof body?.error === 'string' ? body.error : 'The server could not verify this purchase yet.',
      typeof body?.code === 'string' ? body.code : 'sync_failed',
    );
  }
  return body as ServerBillingSync;
};

export const isCheckoutCancelled = (error: unknown): boolean =>
  error instanceof PurchasesError && error.errorCode === ErrorCode.UserCancelledError;

/** User-facing copy without leaking SDK internals or keys. */
export const billingErrorMessage = (error: unknown): string => {
  if (error instanceof RevenueCatClientError) return error.message;
  if (error instanceof PurchasesError) {
    switch (error.errorCode) {
      case ErrorCode.UserCancelledError:
        return 'Checkout was cancelled. Nothing was charged.';
      case ErrorCode.NetworkError:
        return 'The payment service could not be reached. Check your connection and try again.';
      case ErrorCode.PaymentPendingError:
        return 'Payment is still pending. Access will unlock when RevenueCat confirms it.';
      case ErrorCode.ProductAlreadyPurchasedError:
        return 'This purchase is already attached to your account. Refresh access instead.';
      case ErrorCode.InvalidEmailError:
        return 'Enter a valid billing email and try again.';
      case ErrorCode.ConfigurationError:
        return 'RevenueCat is not configured correctly for this build.';
      case ErrorCode.StoreProblemError:
        return 'The payment store reported a problem. Try again in a moment.';
      default:
        return error.message || 'The purchase could not be completed.';
    }
  }
  return error instanceof Error ? error.message : 'The purchase could not be completed.';
};

export const formatBillingDate = (date: Date | null): string => {
  if (!date || Number.isNaN(date.getTime())) return 'Not set';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
