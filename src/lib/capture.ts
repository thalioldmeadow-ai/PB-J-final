import { addDays, format, isToday, subDays } from 'date-fns';
import { storage } from './storage';

/**
 * "Commonplace"-style capture: one message box in, everything filed in the right
 * place out. This is a deterministic on-device parser so it works with no API key.
 */

export type CaptureKind = 'task' | 'meal' | 'workout' | 'spending' | 'journal';

export interface CapturePlan {
  kind: CaptureKind;
  title: string;
  detail?: string;
  target: string;
  storageKey: string;
  payload: Record<string, any>;
}

export interface FiledItem extends CapturePlan {
  id: string;
}

export const KIND_LABEL: Record<CaptureKind, string> = {
  task: 'Tasks',
  meal: 'Meals',
  workout: 'Workouts',
  spending: 'Budget',
  journal: 'Journal',
};

export const KIND_TARGET: Record<CaptureKind, string> = {
  task: '/',
  meal: '/plan?tab=meals',
  workout: '/plan?tab=workouts',
  spending: '/plan?tab=budgeting',
  journal: '/journal',
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const MONEY_PATTERN = /\$\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*(?:dollars?|bucks)\b/i;
const SPEND_VERB = /\b(spent|spend|paid|pay|bought|buy|cost|costs|charged|grabbed)\b/i;
const TASK_HINT = /\b(need to|have to|must|remind|remember|todo|to do|don'?t forget|appointment|meeting|call|book|schedule|submit|pick up|clean|finish|buy|get|email|text|pay|cancel|renew|order|wash|tidy|send|write|apply)\b/i;
const FUTURE_HINT = /\b(tomorrow|tonight|today|next\s+\w+|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
const CLOCK_PATTERN = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\bat\s+\d{1,2}:\d{2}\b/i;
const GOAL_VERB = /\b(need to|have to|must|remind|remember|don'?t forget|going to|gonna|want to)\b/i;
const DURATION_PATTERN = /\b(\d+)\s*(?:min|mins|minutes|h|hr|hrs|hours?)\b/i;
const PAST_VERB = /\b(did|went|finished|completed|just)\b/i;
const MEAL_VERB = /\b(ate|eating|had|have|having|cooked|made|grabbed)\b/i;
const NOTE_PREFIX = /^(note|journal|log|brain dump|thought)\s*[:\-]\s*/i;

const WORKOUT_WORDS: { word: string; type: 'strength' | 'cardio' | 'yoga' | 'other' }[] = [
  { word: 'gym', type: 'strength' },
  { word: 'workout', type: 'strength' },
  { word: 'weights', type: 'strength' },
  { word: 'lifted', type: 'strength' },
  { word: 'hiit', type: 'strength' },
  { word: 'boxing', type: 'strength' },
  { word: 'ran', type: 'cardio' },
  { word: 'running', type: 'cardio' },
  { word: 'run', type: 'cardio' },
  { word: 'walked', type: 'cardio' },
  { word: 'walk', type: 'cardio' },
  { word: 'cycling', type: 'cardio' },
  { word: 'cycle', type: 'cardio' },
  { word: 'swam', type: 'cardio' },
  { word: 'swim', type: 'cardio' },
  { word: 'spin', type: 'cardio' },
  { word: 'yoga', type: 'yoga' },
  { word: 'pilates', type: 'yoga' },
  { word: 'stretching', type: 'yoga' },
  { word: 'stretch', type: 'yoga' },
];

const CATEGORY_HINTS: [RegExp, string][] = [
  [/coffee|cafe|latte|barista|bubble tea|\btea\b/i, 'coffee'],
  [/grocer|coles|woolworth|aldi|supermarket|market/i, 'groceries'],
  [/lunch|dinner|restaurant|takeaway|takeout|pizza|burger|sushi/i, 'dining'],
  [/uber|taxi|\bbus\b|train|fuel|petrol|parking|transport/i, 'transport'],
  [/gym|fitness|pilates|yoga/i, 'fitness'],
  [/pharmacy|doctor|chemist|health|dentist/i, 'health'],
  [/amazon|shop|clothes|shoes/i, 'shopping'],
  [/bill|rent|electric|internet|phone|insurance|subscription/i, 'bills'],
];

const capitalize = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

const tidy = (value: string) =>
  capitalize(value.replace(/\s+/g, ' ').replace(/^[\s,.;:\-]+/, '').replace(/[\s,.;:\-]+$/, '').trim());

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripAll = (text: string, matches: string[]) =>
  matches.reduce(
    (acc, match) => acc.replace(new RegExp(`\\b${escapeRegex(match)}\\b`, 'gi'), ' '),
    text
  );

const extractWhen = (input: string) => {
  const lower = input.toLowerCase();
  let date = new Date();
  const removals: string[] = [];

  if (/\btomorrow\b/.test(lower)) {
    date = addDays(date, 1);
    removals.push('tomorrow');
  } else if (/\byesterday\b/.test(lower)) {
    date = subDays(date, 1);
    removals.push('yesterday');
  } else if (/\btoday\b/.test(lower) || /\btonight\b/.test(lower)) {
    removals.push(/\btoday\b/.test(lower) ? 'today' : 'tonight');
  } else {
    const weekdayIndex = WEEKDAYS.findIndex(name => new RegExp(`\\b${name}\\b`).test(lower));
    if (weekdayIndex >= 0) {
      const diff = (weekdayIndex - date.getDay() + 7) % 7 || 7;
      date = addDays(date, diff);
      removals.push(WEEKDAYS[weekdayIndex]);
    }
  }

  const timeMatch =
    lower.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) ||
    lower.match(/\bat\s+(\d{1,2}):(\d{2})\b/);

  let timeLabel: string | undefined;
  if (timeMatch) {
    let hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2] || 0);
    const meridiem = (timeMatch[3] || (hours >= 12 ? 'pm' : 'am')).toLowerCase();
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    const withTime = new Date(date);
    withTime.setHours(hours, minutes, 0, 0);
    date = withTime;
    timeLabel = format(withTime, 'hh:mm a');
    removals.push(timeMatch[0].trim());
  }

  return { date, timeLabel, removals };
};

const whenLabel = (date: Date, timeLabel?: string) => {
  const day = isToday(date) ? 'Today' : format(date, 'EEE, MMM d');
  return timeLabel ? `${day} · ${timeLabel}` : day;
};

const planSpending = (line: string, uid: string): CapturePlan | null => {
  const moneyMatch = line.match(MONEY_PATTERN);
  if (!moneyMatch || !SPEND_VERB.test(line)) return null;

  const rawAmount = (moneyMatch[1] || moneyMatch[2] || '').replace(',', '.');
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const category = CATEGORY_HINTS.find(([pattern]) => pattern.test(line))?.[1] || 'other';

  const cleaned = tidy(
    stripAll(line.replace(moneyMatch[0], ' '), [
      'i',
      'we',
      'just',
      'today',
      'yesterday',
      'spent',
      'spend',
      'paid',
      'pay',
      'bought',
      'buy',
      'cost',
      'costs',
      'charged',
      'on',
      'for',
      'at',
    ])
  );

  const title = cleaned || capitalize(category === 'other' ? 'expense' : category);
  const { date } = extractWhen(line);

  return {
    kind: 'spending',
    title,
    detail: `$${amount.toFixed(2)} · ${capitalize(category)}`,
    target: KIND_TARGET.spending,
    storageKey: storage.key.TRANSACTIONS,
    payload: {
      uid,
      title,
      amount,
      type: 'expense',
      category,
      date: date.toISOString(),
      createdAt: new Date().toISOString(),
    },
  };
};

const planTask = (line: string, uid: string): CapturePlan | null => {
  if (!TASK_HINT.test(line) && !/^(todo|to do|task)\b/i.test(line)) return null;

  const { date, timeLabel, removals } = extractWhen(line);

  let title = line
    .replace(/^(todo|to do|task)\s*[:\-]?\s*/i, '')
    .replace(/^(remind me to|remember to|don'?t forget to|i need to|i have to|need to|have to|must)\s+/i, '');
  title = tidy(stripAll(title, removals));

  if (!title) return null;

  return {
    kind: 'task',
    title,
    detail: whenLabel(date, timeLabel),
    target: KIND_TARGET.task,
    storageKey: storage.key.TASKS,
    payload: {
      uid,
      title,
      completed: false,
      date: date.toISOString(),
      order: Date.now(),
      type: 'todo',
      ...(timeLabel ? { time: timeLabel } : {}),
    },
  };
};

const planWorkout = (line: string, uid: string): CapturePlan | null => {
  const lower = line.toLowerCase();
  const match = WORKOUT_WORDS.find(({ word }) => new RegExp(`\\b${word}\\b`).test(lower));
  if (!match) return null;

  const durationMatch = lower.match(DURATION_PATTERN);
  if (!durationMatch && !PAST_VERB.test(lower)) return null;

  const { date } = extractWhen(line);
  const duration = durationMatch
    ? `${durationMatch[1]} ${/^h/.test(durationMatch[2]) ? 'h' : 'min'}`
    : undefined;

  return {
    kind: 'workout',
    title: capitalize(match.word),
    detail: `${capitalize(match.type)}${duration ? ` · ${duration}` : ''} · ${whenLabel(date)}`,
    target: KIND_TARGET.workout,
    storageKey: storage.key.WORKOUTS,
    payload: {
      uid,
      date: date.toISOString(),
      name: capitalize(match.word),
      type: match.type,
      ...(duration ? { duration } : {}),
    },
  };
};

const planMeal = (line: string, uid: string): CapturePlan | null => {
  const lower = line.toLowerCase();
  const mealWord = (['breakfast', 'lunch', 'dinner', 'snack'] as const).find(word =>
    new RegExp(`\\b${word}\\b`).test(lower)
  );
  if (!mealWord) return null;

  const colonSplit = line.split(':');
  const hasColonName = colonSplit.length > 1 && new RegExp(`\\b${mealWord}\\b`, 'i').test(colonSplit[0]);
  if (!hasColonName && !MEAL_VERB.test(lower)) return null;

  const { date, removals } = extractWhen(line);

  const rawName = hasColonName
    ? colonSplit.slice(1).join(':')
    : stripAll(line, [mealWord, ...removals]);

  const name = tidy(
    stripAll(rawName, ['i', 'we', 'ate', 'eating', 'had', 'have', 'having', 'cooked', 'made', 'grabbed', 'for', 'a', 'an', 'the', 'some'])
  );

  return {
    kind: 'meal',
    title: name || capitalize(mealWord),
    detail: `${capitalize(mealWord)} · ${whenLabel(date)}`,
    target: KIND_TARGET.meal,
    storageKey: storage.key.MEALS,
    payload: {
      uid,
      date: date.toISOString(),
      type: mealWord,
      name: name || capitalize(mealWord),
    },
  };
};

const planJournal = (line: string, uid: string): CapturePlan | null => {
  const match = line.match(NOTE_PREFIX);
  if (!match) return null;

  const content = tidy(line.slice(match[0].length));
  if (!content) return null;

  return {
    kind: 'journal',
    title: content.length > 60 ? `${content.slice(0, 57)}…` : content,
    detail: 'Saved to Journal',
    target: KIND_TARGET.journal,
    storageKey: storage.key.JOURNAL_ENTRIES,
    payload: {
      uid,
      type: 'journal',
      content,
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  };
};

// Anything left that carries a clear future date or clock time is a task.
const planScheduled = (line: string, uid: string): CapturePlan | null => {
  const trimmed = line.trim();
  if (/\?\s*$/.test(trimmed)) return null;

  // A clock time always reads as an appointment; a bare date only does when the
  // sentence isn't a first-person statement ("I feel low today" is not a task).
  const hasClock = CLOCK_PATTERN.test(trimmed);
  const firstPerson = /^(i|i'?m|i'?ve|i'?ll|me|my|we)\b/i.test(trimmed);
  if (!hasClock && (firstPerson || !FUTURE_HINT.test(trimmed))) return null;

  const { date, timeLabel, removals } = extractWhen(line);
  const title = tidy(stripAll(line, removals));
  if (title.length < 3) return null;

  return {
    kind: 'task',
    title,
    detail: whenLabel(date, timeLabel),
    target: KIND_TARGET.task,
    storageKey: storage.key.TASKS,
    payload: {
      uid,
      title,
      completed: false,
      date: date.toISOString(),
      order: Date.now(),
      type: 'todo',
      ...(timeLabel ? { time: timeLabel } : {}),
    },
  };
};

const planLine = (line: string, uid: string): CapturePlan | null =>
  planJournal(line, uid) ||
  planSpending(line, uid) ||
  planTask(line, uid) ||
  planWorkout(line, uid) ||
  planMeal(line, uid) ||
  planScheduled(line, uid);

export const planCaptures = (text: string, uid: string): CapturePlan[] => {
  const lines = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);

  return lines.reduce<CapturePlan[]>((plans, line) => {
    const plan = planLine(line, uid);
    if (plan) plans.push(plan);
    return plans;
  }, []);
};

export const applyCaptures = async (plans: CapturePlan[]): Promise<FiledItem[]> => {
  const filed: FiledItem[] = [];
  for (const plan of plans) {
    const id = await storage.add(plan.storageKey, plan.payload);
    filed.push({ ...plan, id });
  }
  return filed;
};

export const undoFiled = async (item: FiledItem) => {
  await storage.delete(item.storageKey, item.id);
};

export const summarizeFiled = (items: FiledItem[]) => {
  if (items.length === 0) return '';
  if (items.length === 1) {
    const [item] = items;
    return `Filed to **${KIND_LABEL[item.kind]}**: ${item.title}${item.detail ? ` · ${item.detail}` : ''}.`;
  }
  return [
    `Filed ${items.length} things for you:`,
    ...items.map(item => `- **${item.title}** → ${KIND_LABEL[item.kind]}${item.detail ? ` · ${item.detail}` : ''}`),
  ].join('\n');
};
