import React from 'react';
import { CheckCircle2, Coins, ShieldCheck, Zap } from './icons';
import { useAiCredits } from '../hooks/useAiCredits';
import { cn } from '../lib/utils';
import RevenueCatOffer from './RevenueCatOffer';

interface Props {
  user?: string;
  email?: string;
  className?: string;
}

const dateLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const statusLabel: Record<string, string> = {
  active: 'Active',
  past_due: 'Payment due',
  canceled: 'Canceled',
  expired: 'Expired',
  refunded: 'Refunded',
};

/**
 * Current subscription, what it includes, and the next renewal. The upgrade
 * control is intentionally a notice rather than a checkout: RevenueCat is
 * prepared for sandbox testing, but no live payment is connected in this build.
 */
const SubscriptionPanel: React.FC<Props> = ({ user, email, className }) => {
  const { summary, loading, error, refresh } = useAiCredits(user);

  if (!summary) {
    return (
      <div className={cn('rounded-2xl border border-border bg-card p-4', className)}>
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-full bg-primary/10 text-primary">
            <Coins className="w-4 h-4" />
          </span>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              Subscription
            </p>
            <p className="text-[11px] text-muted-foreground">
              {loading ? 'Checking your plan...' : error || 'Your subscription could not be loaded.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const effectivePlus = summary.entitlements.tier === 'plus' && summary.entitlements.active;
  // A canceled store subscription can still be inside its paid period.
  const plusActive = effectivePlus;
  const percent =
    summary.total > 0
      ? Math.max(0, Math.min(100, Math.round((summary.balance / summary.total) * 100)))
      : 0;
  return (
    <div className={cn('rounded-2xl border border-border bg-card p-4 space-y-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-full bg-primary/10 text-primary">
            {effectivePlus ? <Zap className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
          </span>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              Current subscription
            </p>
            <p className="text-sm font-bold">
              {summary.subscription.label}
              <span className="ml-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                {statusLabel[summary.subscription.status] || summary.subscription.status}
              </span>
            </p>
          </div>
        </div>
        <span
          className={cn(
            'text-[8px] font-black uppercase tracking-wider rounded-full px-2 py-1',
            summary.subscription.status === 'active'
              ? 'bg-emerald-500/10 text-emerald-700'
              : 'bg-amber-500/10 text-amber-700',
          )}
        >
          {summary.subscription.status === 'active' ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-muted/40 border border-border/60 p-2.5">
          <p className="text-[8px] font-black uppercase tracking-wider text-muted-foreground">
            AI credits
          </p>
          <p className="text-lg font-bold leading-tight">
            {summary.balance}
            <span className="text-[10px] font-medium text-muted-foreground"> / {summary.total}</span>
          </p>
          <div className="h-1 rounded-full bg-border overflow-hidden mt-1">
            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <div className="rounded-xl bg-muted/40 border border-border/60 p-2.5">
          <p className="text-[8px] font-black uppercase tracking-wider text-muted-foreground">
            Renews
          </p>
          <p className="text-[11px] font-semibold leading-tight pt-1">
            {dateLabel(summary.subscription.renewalAt)}
          </p>
          <p className="text-[9px] text-muted-foreground pt-1">
            Expires {dateLabel(summary.subscription.expiresAt)}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
          What’s included
        </p>
        {summary.benefits.map((benefit) => (
          <div key={benefit} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
            <CheckCircle2 className="w-3 h-3 text-primary shrink-0 mt-0.5" />
            <span>{benefit}</span>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 text-[9px] leading-relaxed text-muted-foreground">
        All ordinary app features stay available even when your AI credits run out. Credits refresh
        on the renewal date.
      </div>

      <RevenueCatOffer
        userId={user}
        email={email}
        serverActive={plusActive}
        onAccessChanged={refresh}
      />

      {plusActive && (
        <p className="text-[9px] leading-relaxed text-muted-foreground">
          Plus is active. Payment status is verified by the server from the store entitlement.
          {summary.subscription.cancelAtPeriodEnd ? ' It will not renew and stays active until the paid period ends.' : ''}
        </p>
      )}
    </div>
  );
};

export default SubscriptionPanel;
