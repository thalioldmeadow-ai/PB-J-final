import { storage } from './storage';
import {
  ActiveChallenge,
  BudgetSettings,
  Challenge,
  Meal,
  MoodEntry,
  Routine,
  SleepLog,
  Task,
  Transaction,
  Workout,
} from '../types';

/**
 * App awareness.
 *
 * Retrieval is scoped twice over. First, it only ever reads the vault that was
 * unlocked with the current account's password, so one account can never see
 * another's entries. Second, it only pulls the sections the question actually
 * mentions, so a general question sends nothing personal and a budget question
 * does not ship the whole database.
 *
 * No journal text, photos or cycle entries are included at all: they are the
 * most sensitive records and never needed for planning help.
 */

type Topic = 'tasks' | 'budget' | 'meals' | 'workouts' | 'sleep' | 'mood' | 'habits' | 'lists' | 'preferences';

const TOPIC_PATTERNS: Record<Topic, RegExp> = {
  tasks: /\b(task|tasks|todo|to-do|to do|today|tomorrow|week|plan|schedule|calendar|deadline|overdue|remind|priority|busy|free time|time block)/i,
  budget: /\b(money|budget|spend|spent|spending|cost|costs|price|afford|save|saving|savings|bill|bills|expense|expenses|\$|income|salary)/i,
  meals: /\b(eat|eating|ate|meal|meals|food|recipe|recipes|dinner|lunch|breakfast|snack|cook|cooking|nutrition|protein|grocer|groceries|hungry)/i,
  workouts: /\b(workout|workouts|exercise|exercising|gym|run|running|walk|walking|train|training|steps|fit|fitness|movement|stretch|yoga|weights)/i,
  sleep: /\b(sleep|sleeping|slept|tired|rest|rested|bed|bedtime|insomnia|wake|woke|energy)/i,
  mood: /\b(mood|feel|feeling|felt|anxious|anxiety|stress|stressed|sad|happy|overwhelm|overwhelmed|low|calm|emotion)/i,
  habits: /\b(routine|routines|habit|habits|streak|streaks|challenge|challenges|goal|goals|consisten|progress|better at|improve)/i,
  lists: /\b(list|lists|shopping|buy|groceries|checklist|pack)/i,
  preferences: /\b(setting|settings|theme|dark mode|text size|font|app|feature|where is|how do i|navigate|help me use|coach|journal|health|cycle)/i,
};

const MAX_CONTEXT_CHARS = 2_500;

export const detectTopics = (message: string): Topic[] =>
  (Object.keys(TOPIC_PATTERNS) as Topic[]).filter((topic) => TOPIC_PATTERNS[topic].test(message));

const startOfToday = (): number => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

const dayStart = (iso: string): number => {
  const date = new Date(iso);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

const isThisMonth = (iso: string): boolean => {
  const date = new Date(iso);
  const now = new Date();
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
};

const short = (value: string, max = 48): string => {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const settingsSnapshot = (): Record<string, unknown> => {
  try {
    const raw = localStorage.getItem('serene-structure-settings');
    if (!raw) return { theme: 'beige' };
    const parsed = JSON.parse(raw);
    return {
      theme: parsed.theme,
      fontSize: parsed.fontSize,
      cycleTracking: parsed.showCycleTracking,
      assistantEnabled: parsed.aiEnabled !== false,
      ageSetting: parsed.aiAgeBand || 'adult',
    };
  } catch {
    return {};
  }
};

const tasksSection = async (): Promise<Record<string, unknown>> => {
  const tasks = await storage.getAll<Task>(storage.key.TASKS);
  const today = startOfToday();
  const tomorrow = today + 86_400_000;

  const open = tasks.filter((task) => !task.completed);
  const todayOpen = open.filter((task) => dayStart(task.date) === today);
  const todayDone = tasks.filter((task) => task.completed && dayStart(task.date) === today);
  const overdue = open.filter((task) => dayStart(task.date) < today);
  const upcoming = open
    .filter((task) => dayStart(task.date) > today)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 5);

  return {
    today: new Date().toISOString().slice(0, 10),
    openToday: todayOpen.length,
    completedToday: todayDone.length,
    overdue: overdue.length,
    openTitles: todayOpen.slice(0, 5).map((task) => short(task.title)),
    overdueTitles: overdue.slice(0, 3).map((task) => short(task.title)),
    upcoming: upcoming.map((task) => ({ title: short(task.title), date: task.date.slice(0, 10) })),
    completedLast7: tasks.filter((task) => task.completed && dayStart(task.date) >= today - 6 * 86_400_000).length,
    tomorrowOpen: open.filter((task) => dayStart(task.date) === tomorrow).length,
  };
};

const budgetSection = async (): Promise<Record<string, unknown>> => {
  const [transactions, budgets] = await Promise.all([
    storage.getAll<Transaction>(storage.key.TRANSACTIONS),
    storage.getAll<BudgetSettings>(storage.key.BUDGET),
  ]);

  const monthExpenses = transactions.filter((entry) => entry.type === 'expense' && isThisMonth(entry.date));
  const spent = monthExpenses.reduce((sum, entry) => sum + entry.amount, 0);
  const budget = budgets[0]?.totalBudget;

  const byCategory = new Map<string, number>();
  for (const entry of monthExpenses) {
    byCategory.set(entry.category, (byCategory.get(entry.category) || 0) + entry.amount);
  }
  const topCategories = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, amount]) => ({ category, amount: Number(amount.toFixed(2)) }));

  return {
    monthSpent: Number(spent.toFixed(2)),
    monthBudget: typeof budget === 'number' ? budget : null,
    remaining: typeof budget === 'number' ? Number((budget - spent).toFixed(2)) : null,
    topCategories,
    expensesLogged: monthExpenses.length,
  };
};

const mealsSection = async (): Promise<Record<string, unknown>> => {
  const meals = await storage.getAll<Meal>(storage.key.MEALS);
  const today = startOfToday();
  const todayMeals = meals.filter((meal) => dayStart(meal.date) === today);
  return {
    today: todayMeals.map((meal) => ({ type: meal.type, name: short(meal.name, 40) })),
    loggedLast7: meals.filter((meal) => dayStart(meal.date) >= today - 6 * 86_400_000).length,
  };
};

const workoutsSection = async (): Promise<Record<string, unknown>> => {
  const workouts = await storage.getAll<Workout>(storage.key.WORKOUTS);
  const today = startOfToday();
  const recent = workouts
    .filter((workout) => dayStart(workout.date) >= today - 6 * 86_400_000)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return {
    last7Days: recent.length,
    recent: recent.slice(0, 3).map((workout) => ({
      name: short(workout.name, 32),
      type: workout.type || null,
      date: workout.date.slice(0, 10),
    })),
  };
};

const sleepSection = async (): Promise<Record<string, unknown>> => {
  const entries = await storage.getAll<SleepLog>(storage.key.SLEEP_LOGS);
  const recent = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 7);
  if (recent.length === 0) return { nightsLogged: 0 };
  const average = Math.round(recent.reduce((sum, entry) => sum + (entry.quality || 0), 0) / recent.length);
  return {
    nightsLogged: recent.length,
    averageQuality: average,
    latest: { duration: recent[0].duration, quality: recent[0].quality, date: recent[0].date.slice(0, 10) },
  };
};

const moodSection = async (): Promise<Record<string, unknown>> => {
  const moods = await storage.getAll<MoodEntry>(storage.key.MOOD_ENTRIES);
  const recent = [...moods].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
  if (recent.length === 0) return { entriesLogged: 0 };
  return {
    entriesLogged: recent.length,
    latest: {
      mood: recent[0].moodLabels?.[recent[0].moodId] || recent[0].moodId,
      intensity: recent[0].intensity,
      date: recent[0].date.slice(0, 10),
    },
  };
};

const habitsSection = async (): Promise<Record<string, unknown>> => {
  const [routines, active, challenges] = await Promise.all([
    storage.getAll<Routine>(storage.key.ROUTINES),
    storage.getAll<ActiveChallenge>(storage.key.ACTIVE_CHALLENGES),
    storage.getAll<Challenge>(storage.key.CHALLENGES),
  ]);

  return {
    routines: routines.slice(0, 5).map((routine) => ({
      name: short(routine.name, 32),
      steps: routine.steps?.length || 0,
      streak: routine.streakEnabled ? routine.streak || 0 : null,
    })),
    activeChallenges: active.slice(0, 3).map((entry) => ({
      title: short(challenges.find((challenge) => challenge.id === entry.challengeId)?.title || 'Challenge', 40),
      day: entry.currentDay,
    })),
  };
};

const listsSection = async (): Promise<Record<string, unknown>> => {
  const lists = await storage.getAll<any>(storage.key.LISTS);
  return {
    lists: lists.slice(0, 5).map((list) => ({
      name: short(list.name || list.title || 'List', 32),
      items: Array.isArray(list.items) ? list.items.length : 0,
    })),
  };
};

const builders: Record<Exclude<Topic, 'preferences'>, () => Promise<Record<string, unknown>>> = {
  tasks: tasksSection,
  budget: budgetSection,
  meals: mealsSection,
  workouts: workoutsSection,
  sleep: sleepSection,
  mood: moodSection,
  habits: habitsSection,
  lists: listsSection,
};

/**
 * Build the smallest useful snapshot for this question. Sections are added in
 * topic order and dropped from the end if the payload would grow too large, so
 * a long list can never turn into a dump of the whole vault.
 */
export const buildRelevantContext = async (message: string): Promise<Record<string, unknown>> => {
  const topics = detectTopics(message);
  const context: Record<string, unknown> = {
    today: new Date().toISOString().slice(0, 10),
  };

  if (topics.includes('preferences')) {
    context.preferences = settingsSnapshot();
  }

  for (const topic of topics) {
    if (topic === 'preferences') continue;
    try {
      context[topic] = await builders[topic]();
    } catch {
      // A single unreadable collection must not block the answer.
    }
    if (JSON.stringify(context).length > MAX_CONTEXT_CHARS) {
      delete context[topic];
    }
  }

  return context;
};
