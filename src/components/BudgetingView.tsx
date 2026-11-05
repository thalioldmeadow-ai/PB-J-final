import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Wallet,
  Coins,
  BarChart3,
  Plus,
  TrendingUp,
  Lightbulb,
  ChevronRight,
  ShoppingBag,
  Coffee,
  Car,
  HeartPulse,
  Dumbbell,
  ShoppingCart,
  Receipt,
  Utensils,
  Banknote,
  X,
} from './icons';
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  endOfYear,
  isWithinInterval,
  startOfDay,
  subDays,
  getDaysInMonth,
  differenceInCalendarDays,
} from 'date-fns';
import { cn } from '../lib/utils';
import { storage } from '../lib/storage';
import { BudgetSettings, Transaction } from '../types';
import VoiceButton from './VoiceButton';
import { appendDictation } from '../hooks/useVoiceInput';
import { useAuth } from './AuthProvider';
import AiAssist from './AiAssist';
import { loadBudgetFacts } from '../lib/aiFacts';

type Period = 'month' | 'lastMonth' | 'year';
type ChartRange = 'weekly' | 'monthly' | 'yearly';

const CATEGORIES = [
  { id: 'groceries', label: 'Groceries', Icon: ShoppingCart },
  { id: 'dining', label: 'Dining', Icon: Utensils },
  { id: 'coffee', label: 'Coffee', Icon: Coffee },
  { id: 'transport', label: 'Transport', Icon: Car },
  { id: 'health', label: 'Health', Icon: HeartPulse },
  { id: 'fitness', label: 'Fitness', Icon: Dumbbell },
  { id: 'shopping', label: 'Shopping', Icon: ShoppingBag },
  { id: 'bills', label: 'Bills', Icon: Receipt },
] as const;

const money = (value: number, decimals = !Number.isInteger(value)) =>
  `$${value.toLocaleString('en-AU', {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  })}`;

const safeDate = (iso: string) => {
  const parsed = parseISO(iso);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
};

const categoryMeta = (category: string) =>
  CATEGORIES.find(c => c.id === category) || { id: 'other', label: 'Other', Icon: Receipt };

const Segmented = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) => (
  <div className="flex p-1 rounded-full bg-muted/60 border border-border">
    {options.map(option => (
      <button
        key={option.id}
        onClick={() => onChange(option.id)}
        className={cn(
          'flex-1 py-2 rounded-full text-[9px] font-bold uppercase tracking-widest transition-all whitespace-nowrap',
          value === option.id
            ? 'bg-card text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);

const BudgetingView: React.FC = () => {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgetRecords, setBudgetRecords] = useState<BudgetSettings[]>([]);
  const [period, setPeriod] = useState<Period>('month');
  const [chartRange, setChartRange] = useState<ChartRange>('weekly');
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [suggestionOpen, setSuggestionOpen] = useState(false);

  // Add transaction modal
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [category, setCategory] = useState<string>('groceries');
  const [dateString, setDateString] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [saving, setSaving] = useState(false);

  // Budget modal
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);

  useEffect(() => {
    const unsubscribeTransactions = storage.subscribe(
      storage.key.TRANSACTIONS,
      data => setTransactions(data as Transaction[]),
      user?.uid
    );
    const unsubscribeBudget = storage.subscribe(
      storage.key.BUDGET,
      data => setBudgetRecords(data as BudgetSettings[]),
      user?.uid
    );
    return () => {
      unsubscribeTransactions();
      unsubscribeBudget();
    };
  }, [user?.uid]);

  const monthlyBudget = budgetRecords[0]?.totalBudget ?? 0;

  const periodRange = useMemo(() => {
    const now = new Date();
    if (period === 'lastMonth') {
      const lastMonth = subMonths(now, 1);
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
    }
    if (period === 'year') {
      return { start: startOfYear(now), end: endOfYear(now) };
    }
    return { start: startOfMonth(now), end: endOfMonth(now) };
  }, [period]);

  const periodTransactions = useMemo(
    () =>
      transactions
        .filter(t => isWithinInterval(safeDate(t.date), periodRange))
        .sort((a, b) => safeDate(b.date).getTime() - safeDate(a.date).getTime()),
    [transactions, periodRange]
  );

  const spent = useMemo(
    () =>
      periodTransactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0),
    [periodTransactions]
  );

  // The stored budget is a monthly figure; the Year view scales it up.
  const periodBudget = monthlyBudget * (period === 'year' ? 12 : 1);
  const percentUsed = periodBudget > 0 ? Math.round((spent / periodBudget) * 100) : 0;
  const remaining = periodBudget - spent;
  const periodLabel = period === 'year' ? 'yearly' : 'monthly';

  const chart = useMemo(() => {
    const now = new Date();
    const totalBetween = (from: Date, to: Date) =>
      transactions
        .filter(t => t.type === 'expense' && isWithinInterval(safeDate(t.date), { start: from, end: to }))
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    if (chartRange === 'weekly') {
      return Array.from({ length: 7 }, (_, i) => {
        const day = startOfDay(subDays(now, 6 - i));
        return { label: format(day, 'EEE').toUpperCase(), total: totalBetween(day, day) };
      });
    }

    if (chartRange === 'monthly') {
      const monthStart = startOfMonth(now);
      const daysInMonth = getDaysInMonth(now);
      const weeks = Math.ceil(daysInMonth / 7);
      return Array.from({ length: weeks }, (_, week) => {
        const firstDay = week * 7 + 1;
        const lastDay = Math.min((week + 1) * 7, daysInMonth);
        const from = new Date(monthStart.getFullYear(), monthStart.getMonth(), firstDay);
        const to = new Date(monthStart.getFullYear(), monthStart.getMonth(), lastDay, 23, 59, 59);
        return { label: `W${week + 1}`, total: totalBetween(from, to) };
      });
    }

    const yearStart = startOfYear(now);
    return Array.from({ length: 12 }, (_, month) => {
      const from = new Date(yearStart.getFullYear(), month, 1);
      return { label: format(from, 'MMM').toUpperCase(), total: totalBetween(from, endOfMonth(from)) };
    });
  }, [transactions, chartRange]);

  const peak = Math.max(0, ...chart.map(bucket => bucket.total));
  const scaleMax = peak > 0 ? Math.ceil(peak / 100) * 100 : 300;
  const ticks = [scaleMax, Math.round((scaleMax * 2) / 3), Math.round(scaleMax / 3), 0];

  const visibleTransactions = showAllTransactions ? periodTransactions : periodTransactions.slice(0, 3);

  const topCategory = useMemo(() => {
    const totals = new Map<string, number>();
    periodTransactions
      .filter(t => t.type === 'expense')
      .forEach(t => totals.set(t.category, (totals.get(t.category) || 0) + Number(t.amount || 0)));
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    return sorted[0] ? { id: sorted[0][0], total: sorted[0][1] } : null;
  }, [periodTransactions]);

  const suggestion = useMemo(() => {
    if (periodBudget <= 0) {
      return {
        body: 'Set a total budget and I can track how much room you have left this period.',
        detail: 'Tap the chart icon next to the + to add your monthly budget.',
      };
    }
    if (periodTransactions.length === 0) {
      return {
        body: `No spending recorded yet, the full ${money(periodBudget)} is still available.`,
        detail: 'Add a transaction with the + button to start tracking.',
      };
    }
    if (spent > periodBudget) {
      return {
        body: `You're ${money(spent - periodBudget)} over your ${periodLabel} budget. Trim your largest category first.`,
        detail: topCategory
          ? `${categoryMeta(topCategory.id).label} is your biggest spend at ${money(topCategory.total)}.`
          : 'Start with the category you spend the most in.',
      };
    }
    if (percentUsed >= 80) {
      return {
        body: `You're close to your limit, ${money(remaining)} left this period.`,
        detail: 'A small cut in discretionary spending would keep you under budget.',
      };
    }
    return {
      body: `You're on track! ${money(remaining)} of your ${money(periodBudget)} budget is still available.`,
      detail: topCategory
        ? `Largest category so far: ${categoryMeta(topCategory.id).label} at ${money(topCategory.total)}.`
        : 'Keep logging transactions to see category breakdowns.',
    };
  }, [periodBudget, periodTransactions.length, spent, percentUsed, remaining, periodLabel, topCategory]);

  const openTransactionModal = () => {
    setTitle('');
    setAmount('');
    setType('expense');
    setCategory('groceries');
    setDateString(format(new Date(), 'yyyy-MM-dd'));
    setShowTransactionModal(true);
  };

  const openBudgetModal = () => {
    setBudgetDraft(monthlyBudget ? String(monthlyBudget) : '');
    setShowBudgetModal(true);
  };

  const addTransaction = async () => {
    const parsedAmount = Number(amount);
    if (!title.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return;
    setSaving(true);
    try {
      await storage.add(storage.key.TRANSACTIONS, {
        uid: user?.uid || 'guest',
        title: title.trim(),
        amount: parsedAmount,
        type,
        category,
        date: new Date(`${dateString}T12:00:00`).toISOString(),
        createdAt: new Date().toISOString(),
      });
      setShowTransactionModal(false);
    } catch (error) {
      console.error('Error adding transaction:', error);
    } finally {
      setSaving(false);
    }
  };

  const deleteTransaction = async (id: string) => {
    try {
      await storage.delete(storage.key.TRANSACTIONS, id);
    } catch (error) {
      console.error('Error deleting transaction:', error);
    }
  };

  const saveBudget = async () => {
    const parsedBudget = Number(budgetDraft);
    if (!Number.isFinite(parsedBudget) || parsedBudget < 0) return;
    setSavingBudget(true);
    try {
      const existing = budgetRecords[0];
      if (existing) {
        await storage.update(storage.key.BUDGET, existing.id, {
          totalBudget: parsedBudget,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await storage.add(storage.key.BUDGET, {
          uid: user?.uid || 'guest',
          totalBudget: parsedBudget,
          updatedAt: new Date().toISOString(),
        });
      }
      setShowBudgetModal(false);
    } catch (error) {
      console.error('Error saving budget:', error);
    } finally {
      setSavingBudget(false);
    }
  };

  const today = startOfDay(new Date());
  const daysTracked = Math.max(
    1,
    differenceInCalendarDays(today, periodRange.start) + 1
  );
  const dailyAverage = spent / daysTracked;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-black tracking-tighter text-foreground">Budgeting</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={openBudgetModal}
            className="p-2 rounded-full text-primary hover:bg-primary/10 transition-all"
            aria-label="Set total budget"
            title="Set total budget"
          >
            <BarChart3 className="w-5 h-5" />
          </button>
          <button
            onClick={openTransactionModal}
            className="p-2 rounded-full text-primary hover:bg-primary/10 transition-all"
            aria-label="Add transaction"
            title="Add transaction"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Period switcher */}
      <Segmented<Period>
        options={[
          { id: 'month', label: 'This Month' },
          { id: 'lastMonth', label: 'Last Month' },
          { id: 'year', label: 'Year' },
        ]}
        value={period}
        onChange={setPeriod}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-sm bg-card border border-border shadow-sm space-y-2">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Total Budget
              </p>
              <p className="text-xl font-black tracking-tight tabular-nums">{money(periodBudget)}</p>
            </div>
          </div>
          <button
            onClick={openBudgetModal}
            className="text-[9px] font-bold uppercase tracking-widest text-primary hover:underline"
          >
            {monthlyBudget > 0 ? 'Edit budget' : 'Set budget'}
          </button>
        </div>

        <div className="p-4 rounded-sm bg-card border border-border shadow-sm space-y-2">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Coins className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Spent So Far
              </p>
              <p className="text-xl font-black tracking-tight tabular-nums">{money(spent)}</p>
            </div>
          </div>
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', spent > periodBudget && periodBudget > 0 ? 'bg-rose-400' : 'bg-primary/50')}
                style={{ width: `${Math.min(100, percentUsed)}%` }}
              />
            </div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground text-right tabular-nums">
              {percentUsed}%
            </p>
          </div>
        </div>
      </div>

      {/* Spending overview */}
      <div className="p-5 rounded-sm bg-card border border-border shadow-sm space-y-4">
        <div className="flex justify-between items-center gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <TrendingUp className="w-4 h-4 text-primary shrink-0" />
            <h3 className="text-sm font-semibold tracking-tight truncate">Spending Overview</h3>
          </div>
          <div className="w-[9.5rem] shrink-0">
            <Segmented<ChartRange>
              options={[
                { id: 'weekly', label: 'Weekly' },
                { id: 'monthly', label: 'Monthly' },
                { id: 'yearly', label: 'Yearly' },
              ]}
              value={chartRange}
              onChange={setChartRange}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <div className="flex flex-col justify-between h-36 text-[9px] font-semibold text-muted-foreground/70 tabular-nums">
            {ticks.map((tick, i) => (
              <span key={`${tick}-${i}`}>{money(tick)}</span>
            ))}
          </div>
          <div className="flex-1 relative h-36">
            {[0, 1, 2, 3].map(line => (
              <div
                key={line}
                className="absolute inset-x-0 border-t border-dashed border-border"
                style={{ top: `${(line / 3) * 100}%` }}
              />
            ))}
            <div className="absolute inset-0 flex items-end gap-1.5">
              {chart.map((bucket, index) => (
                <div key={`${bucket.label}-${index}`} className="flex-1 flex flex-col justify-end h-full group relative">
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] font-bold text-primary opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    {money(bucket.total)}
                  </span>
                  <div
                    className={cn('w-full rounded-t-lg transition-all', bucket.total > 0 ? 'bg-primary/40' : 'bg-primary/10')}
                    style={{ height: `${Math.max(3, (bucket.total / scaleMax) * 100)}%`, minHeight: bucket.total > 0 ? 6 : 3 }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 pl-[2.6rem]">
          {chart.map((bucket, index) => (
            <span
              key={`${bucket.label}-label-${index}`}
              className="flex-1 text-center text-[8px] font-bold uppercase tracking-wider text-muted-foreground/70"
            >
              {bucket.label}
            </span>
          ))}
        </div>
        {peak === 0 && (
          <p className="text-[10px] text-muted-foreground text-center">
            No spending recorded yet, add a transaction to fill this chart.
          </p>
        )}
      </div>

      {/* Recent transactions */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-base font-semibold tracking-tight">Recent Transactions</h3>
          <button
            onClick={() => setShowAllTransactions(prev => !prev)}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
          >
            {showAllTransactions ? 'Show less' : 'See all'}
            <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', showAllTransactions && 'rotate-90')} />
          </button>
        </div>

        <div className="rounded-sm bg-card border border-border shadow-sm overflow-hidden divide-y divide-border">
          {visibleTransactions.length === 0 ? (
            <div className="text-center py-10 px-6 space-y-2">
              <Coins className="w-7 h-7 text-muted-foreground mx-auto opacity-20" />
              <p className="text-sm text-muted-foreground">No transactions yet.</p>
              <button
                onClick={openTransactionModal}
                className="text-[10px] font-bold uppercase tracking-widest text-primary hover:underline"
              >
                Add your first one
              </button>
            </div>
          ) : (
            visibleTransactions.map(transaction => {
              const meta = categoryMeta(transaction.category);
              const Icon = transaction.type === 'income' ? Banknote : meta.Icon;
              return (
                <div key={transaction.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{transaction.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {format(safeDate(transaction.date), 'EEE, MMM d')}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'text-sm font-bold tabular-nums',
                      transaction.type === 'income' ? 'text-emerald-600' : 'text-foreground'
                    )}
                  >
                    {transaction.type === 'income' ? '+' : '-'}
                    {money(Number(transaction.amount) || 0, true)}
                  </span>
                  <button
                    onClick={() => deleteTransaction(transaction.id)}
                    className="p-1.5 rounded-full text-muted-foreground/50 hover:bg-rose-50 hover:text-rose-500 transition-colors"
                    aria-label={`Delete ${transaction.title}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Suggestion */}
      <button
        onClick={() => setSuggestionOpen(prev => !prev)}
        className="w-full text-left p-5 rounded-sm bg-secondary/20 border border-border shadow-sm flex items-start gap-3 hover:bg-secondary/30 transition-colors"
      >
        <Lightbulb className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 space-y-1">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
            Budget insight
          </p>
          <p className="text-xs font-medium italic leading-relaxed">“{suggestion.body}”</p>
          <AnimatePresence initial={false}>
            {suggestionOpen && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="text-[11px] text-muted-foreground leading-relaxed overflow-hidden"
              >
                {suggestion.detail}
                {spent > 0 && ` Daily average so far: ${money(dailyAverage, true)}.`}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <ChevronRight
          className={cn('w-4 h-4 text-muted-foreground shrink-0 mt-1 transition-transform', suggestionOpen && 'rotate-90')}
        />
      </button>

      {/* The assistant explains the app's own figures; it never computes them */}
      <AiAssist
        title="Ask about this budget"
        description="Totals, category shares and month-on-month changes are calculated by the app from your logged transactions. The assistant explains those figures and will not estimate missing ones."
        mode="budget"
        allowActions={['setBudgetDraft']}
        suggestions={[
          { label: 'Explain my spending', prompt: 'Explain my spending this month using the recorded figures.' },
          { label: 'Where can I save?', prompt: 'Where could I save based on my recorded categories?' },
          { label: 'Draft a budget', prompt: 'Suggest a monthly budget split based on my recorded spending.' },
        ]}
        context={async () => ({ budget: await loadBudgetFacts() })}
      />

      {/* Add transaction modal */}
      {showTransactionModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 "
          onClick={() => setShowTransactionModal(false)}
        >
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="w-full max-w-lg bg-card rounded-t-[2.5rem] sm:rounded-sm border border-border shadow-2xl p-6 space-y-5 max-h-[88vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black tracking-tighter">Add Transaction</h3>
              <button onClick={() => setShowTransactionModal(false)} className="p-2 rounded-full hover:bg-muted transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex p-1 rounded-full bg-muted/60 border border-border">
              {(['expense', 'income'] as const).map(option => (
                <button
                  key={option}
                  onClick={() => setType(option)}
                  className={cn(
                    'flex-1 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all',
                    type === option ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                  )}
                >
                  {option}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">
                What was it for?
              </label>
              <div className="relative">
                <input
                  autoFocus
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTransaction()}
                  placeholder="e.g., Coles"
                  className="w-full p-4 pr-12 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm"
                />
                <VoiceButton
                  size="sm"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                  onTranscript={text => setTitle(prev => appendDictation(prev, text))}
                  label="Dictate a transaction name"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Amount</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTransaction()}
                  placeholder="0.00"
                  className="w-full p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm tabular-nums"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Date</label>
                <input
                  type="date"
                  value={dateString}
                  onChange={e => setDateString(e.target.value)}
                  className="w-full p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Category</label>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    onClick={() => setCategory(id)}
                    className={cn(
                      'py-3 rounded-xl text-[9px] font-bold uppercase tracking-widest border transition-all flex flex-col items-center gap-1',
                      category === id
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted text-muted-foreground border-transparent'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowTransactionModal(false)}
                className="flex-1 py-3 rounded-xl bg-muted text-xs font-bold uppercase tracking-widest"
              >
                Cancel
              </button>
              <button
                onClick={addTransaction}
                disabled={saving || !title.trim() || Number(amount) <= 0}
                className="flex-[2] py-3 rounded-xl bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Add Transaction'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Budget modal */}
      {showBudgetModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 "
          onClick={() => setShowBudgetModal(false)}
        >
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="w-full max-w-lg bg-card rounded-t-[2.5rem] sm:rounded-sm border border-border shadow-2xl p-6 space-y-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black tracking-tighter">Monthly Budget</h3>
              <button onClick={() => setShowBudgetModal(false)} className="p-2 rounded-full hover:bg-muted transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">
                Total budget per month
              </label>
              <input
                autoFocus
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={budgetDraft}
                onChange={e => setBudgetDraft(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveBudget()}
                placeholder="0"
                className="w-full p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-lg font-bold tabular-nums"
              />
              <p className="text-[10px] text-muted-foreground ml-2">
                The Year view multiplies this by 12.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowBudgetModal(false)}
                className="flex-1 py-3 rounded-xl bg-muted text-xs font-bold uppercase tracking-widest"
              >
                Cancel
              </button>
              <button
                onClick={saveBudget}
                disabled={savingBudget}
                className="flex-[2] py-3 rounded-xl bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest disabled:opacity-50"
              >
                {savingBudget ? 'Saving...' : 'Save Budget'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default BudgetingView;
