import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Wallet,
  Zap,
} from './icons';
import { cn } from '../lib/utils';
import {
  billingErrorMessage,
  formatBillingDate,
  hasProEntitlement,
  isCheckoutCancelled,
  loadBillingSnapshot,
  managementUrlFor,
  presentBillingPaywall,
  purchaseBillingPlan,
  revenueCatClientConfigured,
  syncServerBilling,
  type BillingPlan,
  type BillingSnapshot,
} from '../lib/revenuecat';

interface Props {
  userId?: string;
  email?: string;
  /** The server's authoritative Plus state, used to surface a client/server mismatch. */
  serverActive?: boolean;
  onAccessChanged?: () => void;
  className?: string;
}

type Busy = 'refresh' | 'paywall' | BillingPlan['id'] | null;

/**
 * RevenueCat Web Billing surface.
 *
 * The store is the purchase source; the server is still the source of app
 * access. A successful client purchase is immediately followed by a server
 * verification call, so a browser result alone never unlocks Plus.
 */
const RevenueCatOffer: React.FC<Props> = ({
  userId,
  email,
  serverActive = false,
  onAccessChanged,
  className,
}) => {
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await loadBillingSnapshot(userId));
    } catch (caught) {
      setSnapshot(null);
      setError(billingErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!revenueCatClientConfigured || !userId) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setWarning(null);
    setNotice(null);
    void loadBillingSnapshot(userId)
      .then((next) => {
        if (!alive) return;
        setSnapshot(next);
      })
      .catch((caught) => {
        if (!alive) return;
        setSnapshot(null);
        setError(billingErrorMessage(caught));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  const refresh = async () => {
    setBusy('refresh');
    setError(null);
    setWarning(null);
    setNotice(null);
    try {
      const next = await loadBillingSnapshot(userId!);
      setSnapshot(next);
      try {
        const sync = await syncServerBilling();
        onAccessChanged?.();
        if (sync.verification?.plan === 'plus') {
          setNotice('Access refreshed. PB&J Pro is active on this account.');
        } else {
          setWarning(
            'RevenueCat did not report an active pb_j_pro entitlement for this account. No app access was changed.',
          );
        }
      } catch (caught) {
        setWarning(
          `${billingErrorMessage(caught)} RevenueCat still has your purchase; refresh again after the server is configured.`,
        );
      }
    } catch (caught) {
      setError(billingErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const applyPurchase = async (customerInfo: BillingSnapshot['customerInfo']) => {
    const proActive = hasProEntitlement(customerInfo);
    setSnapshot((current) =>
      current
        ? {
            ...current,
            customerInfo,
            proActive,
            managementUrl: managementUrlFor(customerInfo),
          }
        : current,
    );

    if (!proActive) {
      setNotice('Checkout finished. RevenueCat has not reported pb_j_pro yet; refresh access in a moment.');
      onAccessChanged?.();
      return;
    }

    try {
      const sync = await syncServerBilling();
      onAccessChanged?.();
      if (sync.verification?.plan === 'plus') {
        setNotice('Payment confirmed. PB&J Pro is active on this account.');
      } else {
        setWarning(
          'RevenueCat shows pb_j_pro, but the app server has not activated Plus yet. Refresh access before relying on paid features.',
        );
      }
    } catch (caught) {
      onAccessChanged?.();
      setWarning(
        `${billingErrorMessage(caught)} The purchase is safe in RevenueCat; app access will update after server verification succeeds.`,
      );
    }
  };

  const buy = async (plan: BillingPlan) => {
    if (!userId) return;
    setBusy(plan.id);
    setError(null);
    setWarning(null);
    setNotice(null);
    try {
      const result = await purchaseBillingPlan({
        appUserId: userId,
        plan: plan.package,
        email,
      });
      await applyPurchase(result.customerInfo);
    } catch (caught) {
      if (!isCheckoutCancelled(caught)) setError(billingErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const paywall = async () => {
    if (!userId || !snapshot?.offering) return;
    setBusy('paywall');
    setError(null);
    setWarning(null);
    setNotice(null);
    try {
      const result = await presentBillingPaywall({
        appUserId: userId,
        offering: snapshot.offering,
        email,
      });
      await applyPurchase(result.customerInfo);
    } catch (caught) {
      if (!isCheckoutCancelled(caught)) setError(billingErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  if (!revenueCatClientConfigured) {
    return (
      <div className={cn('rounded-xl border border-border bg-muted/20 p-3 space-y-1', className)}>
        <p className="text-[10px] font-bold">Subscription checkout is not configured.</p>
        <p className="text-[9px] leading-relaxed text-muted-foreground">
          Add the public RevenueCat Web SDK key as <code>VITE_REVENUECAT_WEB_API_KEY</code> and
          rebuild. The app keeps working without it.
        </p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className={cn('rounded-xl border border-border bg-muted/20 p-3', className)}>
        <p className="text-[10px] text-muted-foreground">
          Sign in to view plans and manage your subscription.
        </p>
      </div>
    );
  }

  if (loading && !snapshot) {
    return (
      <div className={cn('rounded-xl border border-border bg-muted/20 p-3', className)}>
        <p className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading plans and current access…
        </p>
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className={cn('rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 space-y-2', className)}>
        <p className="flex items-start gap-2 text-[10px] leading-relaxed text-rose-700">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {error}
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-primary disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3 h-3', busy === 'refresh' && 'animate-spin')} />
          Try again
        </button>
      </div>
    );
  }

  const pro = Boolean(snapshot?.proActive);
  const plans = snapshot?.plans || [];
  const hasPaywall = Boolean(snapshot?.offering?.hasPaywall);
  const managementUrl = snapshot?.managementUrl || null;
  const mismatch = serverActive !== pro;

  return (
    <div className={cn('rounded-xl border border-border bg-muted/20 p-3 space-y-3', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-full bg-primary/10 text-primary">
            <Wallet className="w-3.5 h-3.5" />
          </span>
          <div>
            <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">
              PB&amp;J Pro
            </p>
            <p className="text-[11px] font-bold">
              {pro ? 'Active in RevenueCat' : 'No active pb_j_pro entitlement'}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'text-[8px] font-black uppercase tracking-wider rounded-full px-2 py-1',
            pro ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700',
          )}
        >
          {pro ? 'Pro' : 'Free'}
        </span>
      </div>

      {mismatch && (
        <p className="flex items-start gap-2 text-[9px] leading-relaxed text-amber-700">
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          {pro
            ? 'RevenueCat shows Pro, but the app server has not verified it. Use Refresh access; the server remains the permission source.'
            : 'The app server shows Plus, but this RevenueCat customer does not show pb_j_pro. Sign in with the same account and refresh.'}
        </p>
      )}

      {error && snapshot && (
        <p className="flex items-start gap-2 text-[9px] leading-relaxed text-rose-700">
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          {error}
        </p>
      )}
      {warning && (
        <p className="flex items-start gap-2 text-[9px] leading-relaxed text-amber-700">
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          {warning}
        </p>
      )}
      {notice && (
        <p className="flex items-start gap-2 text-[9px] leading-relaxed text-emerald-700">
          <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" />
          {notice}
        </p>
      )}

      {pro ? (
        <div className="space-y-2">
          <p className="text-[9px] leading-relaxed text-muted-foreground">
            Your access is tied to this signed-in account. On Web, purchases restore automatically
            when you sign in with the same account; there is no separate restore button.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {managementUrl && (
              <a
                href={managementUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-primary text-primary-foreground text-[9px] font-black uppercase tracking-widest"
              >
                Manage subscription
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-border bg-card text-[9px] font-black uppercase tracking-widest text-muted-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn('w-3 h-3', busy === 'refresh' && 'animate-spin')} />
              Refresh access
            </button>
          </div>
          {!managementUrl && (
            <p className="text-[9px] leading-relaxed text-muted-foreground">
              RevenueCat did not return a management link for this purchase yet. Customer Center is
              not supported on Web, so management uses RevenueCat&apos;s hosted customer portal when
              available.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {hasPaywall && (
            <button
              type="button"
              onClick={() => void paywall()}
              disabled={busy !== null}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
            >
              {busy === 'paywall' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
              {busy === 'paywall' ? 'Opening checkout…' : 'View plans & checkout'}
            </button>
          )}

          {plans.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className="rounded-xl border border-border bg-card p-2.5 flex flex-col gap-1"
                >
                  <p className="text-[10px] font-black uppercase tracking-widest">{plan.label}</p>
                  <p className="text-sm font-bold leading-tight">{plan.price}</p>
                  <p className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                    {plan.cadence}
                  </p>
                  <p className="text-[9px] leading-relaxed text-muted-foreground flex-1">
                    {plan.detail}
                  </p>
                  <button
                    type="button"
                    onClick={() => void buy(plan)}
                    disabled={busy !== null}
                    className="mt-1 w-full py-2 rounded-xl border border-primary/30 bg-primary/5 text-[9px] font-black uppercase tracking-widest text-primary disabled:opacity-50"
                  >
                    {busy === plan.id ? 'Opening…' : `Choose ${plan.label}`}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[9px] leading-relaxed text-amber-700">
              The current RevenueCat offering has no Monthly, Yearly or Lifetime package. Add them in
              the dashboard, attach them to the current offering, then refresh.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn('w-3 h-3', busy === 'refresh' && 'animate-spin')} />
              Refresh access
            </button>
            <span className="text-[9px] text-muted-foreground">
              Already purchased? Sign in with the same account and refresh.
            </span>
          </div>
        </div>
      )}

      {snapshot?.customerInfo?.requestDate && (
        <p className="text-[8px] text-muted-foreground/70">
          RevenueCat checked {formatBillingDate(snapshot.customerInfo.requestDate)}
        </p>
      )}
    </div>
  );
};

export default RevenueCatOffer;
