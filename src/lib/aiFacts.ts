import { storage } from './storage';
import {
  ActiveChallenge,
  BudgetSettings,
  Challenge,
  Goal,
  Meal,
  MoodEntry,
  Routine,
  SleepLog,
  Task,
  Transaction,
  Workout,
} from '../types';

/**
 * Verified figures for the section assistants.
 *
 * Every number the assistant is allowed to talk about is computed here, in
 * plain application logic, from records the signed-in person actually has. The
 * model receives the finished figures and is told not to do its own arithmetic,
 * so a budget total can never be invented or guessed.
 */

const DAY = 86_400_000;

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

/** Local midnight for a stored value, so time zones cannot shift a day. */
export const dayMs = (value: string | Date): number => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return NaN;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** Local calendar date. toISOString would shift the day in positive offsets. */
const localDay = (ms: number): string => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const dayKey = (value: string | Date): string | null => {
  const ms = dayMs(value);
  return Number.isNaN(ms) ? null : localDay(ms);
};

const minutesFromTime = (time?: string): number | null => {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(time.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = (match[3] || '').toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const short = (value: string, max = 60): string => {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

// ---------------------------------------------------------------- planning

export interface PlanFacts {
  today: string;
  openToday: number;
  doneToday: number;
  overdue: { count: number; titles: string[] };
  next7Open: number;
  completedLast7: number;
  completionRateLast7: number | null;
  conflicts: { date: string; first: string; second: string }[];
  goals: { title: string; stepsDone: number; stepsTotal: number; progress: number }[];
}

export const computePlanFacts = (tasks: Task[], goals: Goal[], now = new Date()): PlanFacts => {
  const today = dayMs(now);
  const dated = tasks.filter((task) => !Number.isNaN(dayMs(task.date)));
  const open = dated.filter((task) => !task.completed);

  const overdue = open
    .filter((task) => dayMs(task.date) < today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const last7 = dated.filter((task) => dayMs(task.date) >= today - 6 * DAY && dayMs(task.date) <= today);
  const completedLast7 = last7.filter((task) => task.completed).length;

  const conflicts: { date: string; first: string; second: string }[] = [];
  const blocks = dated.filter((task) => task.type === 'timeblock' && minutesFromTime(task.time) !== null);
  const byDay = new Map<number, Task[]>();
  for (const block of blocks) {
    const key = dayMs(block.date);
    byDay.set(key, [...(byDay.get(key) || []), block]);
  }
  for (const [key, dayBlocks] of byDay) {
    const sorted = [...dayBlocks].sort((a, b) => (minutesFromTime(a.time) || 0) - (minutesFromTime(b.time) || 0));
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      const start = minutesFromTime(previous.time) || 0;
      const end = start + (previous.duration || 30);
      if ((minutesFromTime(current.time) || 0) < end) {
        conflicts.push({
          date: localDay(key),
          first: short(previous.title, 40),
          second: short(current.title, 40),
        });
      }
    }
  }

  return {
    today: localDay(today),
    openToday: open.filter((task) => dayMs(task.date) === today).length,
    doneToday: dated.filter((task) => task.completed && dayMs(task.date) === today).length,
    overdue: { count: overdue.length, titles: overdue.slice(0, 5).map((task) => short(task.title, 40)) },
    next7Open: open.filter((task) => {
      const day = dayMs(task.date);
      return day > today && day <= today + 7 * DAY;
    }).length,
    completedLast7,
    completionRateLast7: last7.length > 0 ? Math.round((completedLast7 / last7.length) * 100) : null,
    conflicts: conflicts.slice(0, 4),
    goals: goals.map((goal) => {
      const steps = goal.steps || [];
      const done = steps.filter((step) => step.completed).length;
      return {
        title: short(goal.title, 60),
        stepsDone: done,
        stepsTotal: steps.length,
        progress: steps.length > 0 ? Math.round((done / steps.length) * 100) : goal.progress || 0,
      };
    }),
  };
};

// ------------------------------------------------------------------ budget

export interface BudgetFacts {
  month: string;
  expenses: number;
  income: number;
  net: number;
  budget: number | null;
  remaining: number | null;
  percentUsed: number | null;
  savingsRate: number | null;
  dailyAverage: number;
  transactionCount: number;
  byCategory: { category: string; amount: number; share: number }[];
  lastMonthExpenses: number;
  changeFromLastMonth: number | null;
  biggestExpense: { title: string; amount: number } | null;
  daysIntoMonth: number;
  daysInMonth: number;
}

const monthKey = (value: string | Date): string | null => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export const computeBudgetFacts = (
  transactions: Transaction[],
  budgetRecords: BudgetSettings[],
  now = new Date()
): BudgetFacts => {
  const thisMonth = monthKey(now) as string;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = monthKey(lastMonthDate) as string;

  const valid = transactions.filter((entry) => !Number.isNaN(new Date(entry.date).getTime()));
  const inMonth = valid.filter((entry) => monthKey(entry.date) === thisMonth);

  const expenses = inMonth.filter((entry) => entry.type === 'expense');
  const income = inMonth.filter((entry) => entry.type === 'income');
  const expenseTotal = round(sum(expenses.map((entry) => Number(entry.amount) || 0)));
  const incomeTotal = round(sum(income.map((entry) => Number(entry.amount) || 0)));
  const lastExpenseTotal = round(
    sum(
      valid
        .filter((entry) => entry.type === 'expense' && monthKey(entry.date) === lastMonth)
        .map((entry) => Number(entry.amount) || 0)
    )
  );

  const budgetValue = budgetRecords[0]?.totalBudget;
  const budget = typeof budgetValue === 'number' && Number.isFinite(budgetValue) ? round(budgetValue) : null;
  const remaining = budget === null ? null : round(budget - expenseTotal);
  const percentUsed = budget && budget > 0 ? Math.round((expenseTotal / budget) * 100) : null;
  const net = round(incomeTotal - expenseTotal);
  const savingsRate = incomeTotal > 0 ? Math.round((net / incomeTotal) * 100) : null;

  const byCategoryMap = new Map<string, number>();
  for (const entry of expenses) {
    const category = entry.category || 'other';
    byCategoryMap.set(category, (byCategoryMap.get(category) || 0) + (Number(entry.amount) || 0));
  }
  const byCategory = [...byCategoryMap.entries()]
    .map(([category, amount]) => ({
      category,
      amount: round(amount),
      share: expenseTotal > 0 ? Math.round((amount / expenseTotal) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  const biggest = [...expenses].sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))[0];
  const daysIntoMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  return {
    month: thisMonth,
    expenses: expenseTotal,
    income: incomeTotal,
    net,
    budget,
    remaining,
    percentUsed,
    savingsRate,
    dailyAverage: daysIntoMonth > 0 ? round(expenseTotal / daysIntoMonth) : 0,
    transactionCount: inMonth.length,
    byCategory,
    lastMonthExpenses: lastExpenseTotal,
    changeFromLastMonth:
      lastExpenseTotal > 0 ? Math.round(((expenseTotal - lastExpenseTotal) / lastExpenseTotal) * 100) : null,
    biggestExpense: biggest ? { title: short(biggest.title, 40), amount: round(Number(biggest.amount) || 0) } : null,
    daysIntoMonth,
    daysInMonth,
  };
};

// ------------------------------------------------------------------ habits

export interface HabitFacts {
  routines: { name: string; steps: number; streak: number; best: number; doneToday: boolean; lastDone: string | null }[];
  routinesWithoutSteps: number;
  challenge: { title: string; day: number; totalDays: number; completed: number } | null;
}

const todayKey = (now: Date): string => {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const yesterdayKey = (now: Date): string => {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const computeHabitFacts = (
  routines: Routine[],
  active: ActiveChallenge[],
  catalog: Challenge[],
  now = new Date()
): HabitFacts => {
  const today = todayKey(now);
  const yesterday = yesterdayKey(now);

  const entered = active[0];
  const template = entered ? catalog.find((item) => item.id === entered.challengeId) : undefined;

  return {
    routines: routines.map((routine) => {
      const last = routine.lastCompletedDate || null;
      const streak =
        last && (last === today || last === yesterday) ? routine.streak || 0 : 0;
      return {
        name: short(routine.name, 50),
        steps: routine.steps?.length || 0,
        streak,
        best: routine.bestStreak || 0,
        doneToday: last === today,
        lastDone: last,
      };
    }),
    routinesWithoutSteps: routines.filter((routine) => !routine.steps || routine.steps.length === 0).length,
    challenge: entered
      ? {
          title: short(template?.title || 'Active challenge', 50),
          day: entered.currentDay,
          totalDays: template?.days?.length || 0,
          completed: entered.completedDays?.length || 0,
        }
      : null,
  };
};

// ---------------------------------------------------------------- progress

export interface ProgressFacts {
  windowDays: number;
  tasks: { completed: number; previous: number; delta: number | null };
  workouts: { logged: number; previous: number };
  sleep: { nights: number; averageQuality: number | null; previousAverage: number | null };
  mood: { entries: number; average: number | null; previousAverage: number | null };
  meals: { logged: number; previous: number };
  budget: { spent: number; previous: number };
  achievements: string[];
  missing: string[];
}

const average = (values: number[]): number | null =>
  values.length > 0 ? Math.round((sum(values) / values.length) * 10) / 10 : null;

export const computeProgressFacts = (
  data: {
    tasks: Task[];
    workouts: Workout[];
    sleep: SleepLog[];
    mood: MoodEntry[];
    meals: Meal[];
    transactions: Transaction[];
  },
  windowDays = 7,
  now = new Date()
): ProgressFacts => {
  const today = dayMs(now);
  const from = today - (windowDays - 1) * DAY;
  const previousFrom = from - windowDays * DAY;
  const within = (value: string, start: number, end: number) => {
    const day = dayMs(value);
    return !Number.isNaN(day) && day >= start && day <= end;
  };

  const current = (value: string) => within(value, from, today);
  const previous = (value: string) => within(value, previousFrom, from - DAY);

  const tasksDone = data.tasks.filter((task) => task.completed && current(task.date)).length;
  const tasksPrev = data.tasks.filter((task) => task.completed && previous(task.date)).length;

  const sleepNow = data.sleep.filter((entry) => current(entry.date)).map((entry) => Number(entry.quality) || 0);
  const sleepPrev = data.sleep.filter((entry) => previous(entry.date)).map((entry) => Number(entry.quality) || 0);
  const moodNow = data.mood.filter((entry) => current(entry.date)).map((entry) => Number(entry.intensity) || 0);
  const moodPrev = data.mood.filter((entry) => previous(entry.date)).map((entry) => Number(entry.intensity) || 0);

  const spentNow = round(
    sum(data.transactions.filter((entry) => entry.type === 'expense' && current(entry.date)).map((entry) => Number(entry.amount) || 0))
  );
  const spentPrev = round(
    sum(data.transactions.filter((entry) => entry.type === 'expense' && previous(entry.date)).map((entry) => Number(entry.amount) || 0))
  );

  const missing: string[] = [];
  if (data.tasks.length === 0) missing.push('tasks');
  if (data.workouts.length === 0) missing.push('workouts');
  if (data.sleep.length === 0) missing.push('sleep');
  if (data.mood.length === 0) missing.push('mood');
  if (data.meals.length === 0) missing.push('meals');
  if (data.transactions.length === 0) missing.push('spending');

  const longestStreak = data.tasks
    .filter((task) => task.completed)
    .length;

  const achievements: string[] = [];
  if (tasksDone > 0) achievements.push(`${tasksDone} task${tasksDone === 1 ? '' : 's'} completed in the last ${windowDays} days`);
  if (data.workouts.filter((entry) => current(entry.date)).length > 0) {
    achievements.push(`${data.workouts.filter((entry) => current(entry.date)).length} workouts logged`);
  }
  if (sleepNow.length >= 3) achievements.push(`${sleepNow.length} nights of sleep recorded`);
  if (longestStreak >= 10) achievements.push(`${longestStreak} completed tasks altogether`);

  return {
    windowDays,
    tasks: { completed: tasksDone, previous: tasksPrev, delta: tasksDone - tasksPrev },
    workouts: {
      logged: data.workouts.filter((entry) => current(entry.date)).length,
      previous: data.workouts.filter((entry) => previous(entry.date)).length,
    },
    sleep: { nights: sleepNow.length, averageQuality: average(sleepNow), previousAverage: average(sleepPrev) },
    mood: { entries: moodNow.length, average: average(moodNow), previousAverage: average(moodPrev) },
    meals: {
      logged: data.meals.filter((entry) => current(entry.date)).length,
      previous: data.meals.filter((entry) => previous(entry.date)).length,
    },
    budget: { spent: spentNow, previous: spentPrev },
    achievements: achievements.slice(0, 4),
    missing,
  };
};

// ----------------------------------------------------------------- loaders

export const loadPlanFacts = async (now = new Date()): Promise<PlanFacts> =>
  computePlanFacts(
    await storage.getAll<Task>(storage.key.TASKS),
    await storage.getAll<Goal>(storage.key.GOALS),
    now
  );

export const loadBudgetFacts = async (now = new Date()): Promise<BudgetFacts> =>
  computeBudgetFacts(
    await storage.getAll<Transaction>(storage.key.TRANSACTIONS),
    await storage.getAll<BudgetSettings>(storage.key.BUDGET),
    now
  );

export const loadHabitFacts = async (now = new Date()): Promise<HabitFacts> =>
  computeHabitFacts(
    await storage.getAll<Routine>(storage.key.ROUTINES),
    await storage.getAll<ActiveChallenge>(storage.key.ACTIVE_CHALLENGES),
    await storage.getAll<Challenge>(storage.key.CHALLENGES),
    now
  );

export const loadProgressFacts = async (windowDays = 7, now = new Date()): Promise<ProgressFacts> =>
  computeProgressFacts(
    {
      tasks: await storage.getAll<Task>(storage.key.TASKS),
      workouts: await storage.getAll<Workout>(storage.key.WORKOUTS),
      sleep: await storage.getAll<SleepLog>(storage.key.SLEEP_LOGS),
      mood: await storage.getAll<MoodEntry>(storage.key.MOOD_ENTRIES),
      meals: await storage.getAll<Meal>(storage.key.MEALS),
      transactions: await storage.getAll<Transaction>(storage.key.TRANSACTIONS),
    },
    windowDays,
    now
  );

/** Kept for the coach, which shows the same verified budget figures. */
export { dayKey };
