import React from 'react';
import { Coins } from './icons';
import { useAiCredits } from '../hooks/useAiCredits';
import { cn } from '../lib/utils';

interface Props {
  user?: string;
  detailed?: boolean;
  className?: string;
}

const resetLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'soon';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};

/**
 * A small, calm credit readout. It only shows the caller's own wallet, never
 * another account's usage or the operator's global spend.
 */
const AiCreditIndicator: React.FC<Props> = ({ user, detailed = false, className }) => {
  const { summary, loading, error } = useAiCredits(user);

  if (!summary) {
    if (!detailed) return null;
    return (
      <div className={cn('rounded-2xl border border-border bg-card p-4', className)}>
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-full bg-primary/10 text-primary">
            <Coins className="w-4 h-4" />
          </span>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              AI credits
            </p>
            <p className="text-[11px] text-muted-foreground">
              {loading ? 'Checking your balance...' : error || 'Credits are unavailable right now.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const percent =
    summary.total > 0 ? Math.max(0, Math.min(100, Math.round((summary.balance / summary.total) * 100))) : 0;

  if (!detailed) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[9px] font-bold text-muted-foreground',
          className,
        )}
        title={`${summary.balance} of ${summary.total} ${summary.plan.label} AI credits remaining`}
      >
        <Coins className="w-3 h-3 text-primary" />
        <span className="text-foreground">{summary.balance}</span>
        <span>/ {summary.total}</span>
        <span className="text-muted-foreground/70">· resets {resetLabel(summary.resetAt)}</span>
      </span>
    );
  }

  return (
    <div className={cn('rounded-2xl border border-border bg-card p-4 space-y-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-full bg-primary/10 text-primary">
            <Coins className="w-4 h-4" />
          </span>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              AI credits
            </p>
            <p className="text-sm font-bold">
              {summary.balance} <span className="text-muted-foreground font-medium">/ {summary.total}</span>
            </p>
          </div>
        </div>
        <span className="text-[8px] font-black uppercase tracking-wider rounded-full bg-primary/10 text-primary px-2 py-1">
          {summary.plan.label}
        </span>
      </div>

      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>

      <div className="flex items-center justify-between gap-3 text-[9px] text-muted-foreground">
        <span>{summary.periodCreditsUsed} used this period</span>
        <span>Resets {resetLabel(summary.resetAt)}</span>
      </div>
    </div>
  );
};

export default AiCreditIndicator;
