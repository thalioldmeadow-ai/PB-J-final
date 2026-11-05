import { storage } from './storage';
import { AiActionRecord, Goal, Routine, Task } from '../types';

/**
 * Structured actions for the section assistants.
 *
 * The model never touches storage, a query or a function of its choosing. It can
 * only ask for one of these named actions, and only through a JSON block that
 * this file validates field by field. Nothing is written until the person
 * confirms the proposal in the interface, and every attempt is recorded.
 */

export const AI_ACTION_NAMES = [
  'createTask',
  'updateTask',
  'createGoal',
  'addHabit',
  'setBudgetDraft',
  'addListItem',
] as const;

export type AiActionName = (typeof AI_ACTION_NAMES)[number];

export interface AiActionProposal {
  action: AiActionName;
  args: Record<string, unknown>;
  summary: string;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

const MAX_TITLE = 120;
const MAX_TEXT = 200;
const MAX_STEPS = 12;
const MAX_AMOUNT = 1_000_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar date, so a late-evening save does not land on tomorrow. */
const todayLocal = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const text = (value: unknown, max = MAX_TITLE): string | null => {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.slice(0, max);
};

const list = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => text(entry, MAX_TITLE))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, MAX_STEPS);
};

const dateString = (value: unknown): string | null => {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : value;
};

/**
 * Accept the ways a time is spoken or typed and return the 12-hour form the
 * Today schedule positions blocks with, or undefined when it is not a time.
 */
export const normalizeTimeSlot = (value: string): string | undefined => {
  const cleaned = value
    .toLowerCase()
    .replace(/^at\s+/, '')
    .replace(/\b([ap])\.?m\.?/g, '$1m')
    .replace(/\./g, ':')
    .replace(/\s+/g, ' ')
    .trim();

  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(cleaned);
  if (!match) return undefined;

  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = match[3];
  if (!Number.isInteger(hours) || minutes > 59) return undefined;

  if (meridiem) {
    if (hours < 1 || hours > 12) return undefined;
    if (hours === 12) hours = 0;
    if (meridiem === 'pm') hours += 12;
  } else if (hours > 23) {
    return undefined;
  }

  const suffix = hours >= 12 ? 'PM' : 'AM';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(display).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${suffix}`;
};

const positiveNumber = (value: unknown, max: number): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) return null;
  return Math.round(parsed * 100) / 100;
};

export const isActionName = (value: unknown): value is AiActionName =>
  typeof value === 'string' && (AI_ACTION_NAMES as readonly string[]).includes(value);

/**
 * Accept only a well-formed proposal with the exact fields an action needs.
 * Unknown fields are dropped, wrong types reject the whole proposal, so a
 * malformed or partially invented action never reaches storage.
 */
export const validateProposal = (raw: unknown): AiActionProposal | null => {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (!isActionName(candidate.action)) return null;

  const args = (candidate.args || {}) as Record<string, unknown>;
  const summary = text(candidate.summary, 160) || '';

  switch (candidate.action) {
    case 'createTask': {
      const title = text(args.title);
      if (!title) return null;
      const date = dateString(args.date) || todayLocal();
      const rawTime = text(args.timeSlot ?? args.time, 20);
      const timeSlot = rawTime ? normalizeTimeSlot(rawTime) : undefined;
      return {
        action: 'createTask',
        args: { title, date, timeSlot },
        summary: summary || `Add task "${title}" on ${date}${timeSlot ? ` at ${timeSlot}` : ''}`,
      };
    }
    case 'updateTask': {
      const taskId = text(args.taskId, 64);
      if (!taskId) return null;
      const patch: Record<string, unknown> = {};
      const title = text(args.title);
      if (title) patch.title = title;
      const date = dateString(args.date);
      if (date) patch.date = date;
      if (typeof args.completed === 'boolean') patch.completed = args.completed;
      if (Object.keys(patch).length === 0) return null;
      return {
        action: 'updateTask',
        args: { taskId, ...patch },
        summary: summary || 'Update one of your tasks',
      };
    }
    case 'createGoal': {
      const title = text(args.title);
      if (!title) return null;
      const steps = list(args.steps);
      return {
        action: 'createGoal',
        args: { title, steps },
        summary: summary || `Create goal "${title}"`,
      };
    }
    case 'addHabit': {
      const name = text(args.name || args.title);
      if (!name) return null;
      const steps = list(args.steps);
      const rawTime = typeof args.timeOfDay === 'string' ? args.timeOfDay : '';
      const timeOfDay = ['morning', 'night', 'custom'].includes(rawTime) ? rawTime : 'custom';
      return {
        action: 'addHabit',
        args: { name, steps, timeOfDay },
        summary: summary || `Add routine "${name}"`,
      };
    }
    case 'setBudgetDraft': {
      const totalBudget = positiveNumber(args.totalBudget ?? args.amount, MAX_AMOUNT);
      if (totalBudget === null) return null;
      return {
        action: 'setBudgetDraft',
        args: { totalBudget },
        summary: summary || `Set the monthly budget to ${totalBudget}`,
      };
    }
    case 'addListItem': {
      const itemText = text(args.text || args.item, MAX_TEXT);
      if (!itemText) return null;
      const listTitle = text(args.listTitle, 60);
      const listId = text(args.listId, 64);
      return {
        action: 'addListItem',
        args: { text: itemText, ...(listTitle ? { listTitle } : {}), ...(listId ? { listId } : {}) },
        summary: summary || `Add "${itemText}" to a list`,
      };
    }
    default:
      return null;
  }
};

/**
 * Pull at most one proposal out of a reply. A missing block simply means the
 * answer was advice only, which is the common case.
 */
export const proposalFromReply = (reply: string, allowed: AiActionName[]): AiActionProposal | null => {
  if (!reply || allowed.length === 0) return null;
  const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return null;
  }

  const proposal = validateProposal(parsed);
  if (!proposal || !allowed.includes(proposal.action)) return null;
  return proposal;
};

/** Remove the machine block before showing the answer to a person. */
export const stripProposalBlock = (reply: string): string =>
  reply.replace(/```(?:json)?\s*[\s\S]*?```/gi, '').replace(/\n{3,}/g, '\n\n').trim();

const record = async (entry: Omit<AiActionRecord, 'id'>): Promise<void> => {
  try {
    await storage.add(storage.key.AI_ACTIONS, entry);
  } catch {
    // History is useful, but never worth failing an applied action for.
  }
};

const fail = async (action: AiActionName, summary: string, message: string): Promise<ActionResult> => {
  await record({
    action,
    summary,
    status: 'failed',
    message,
    createdAt: new Date().toISOString(),
    uid: 'unavailable',
  });
  return { ok: false, message };
};

/**
 * Apply a confirmed proposal. The action, its arguments and its history entry
 * are all fixed here; the model supplies text only.
 */
export const applyProposal = async (
  proposal: AiActionProposal,
  allowed: AiActionName[]
): Promise<ActionResult> => {
  if (!storage.isUnlocked) {
    return { ok: false, message: 'The vault is locked. Sign in again to make changes.' };
  }
  if (!allowed.includes(proposal.action)) {
    return { ok: false, message: 'That action is not available on this screen.' };
  }

  const now = new Date().toISOString();

  try {
    let message = '';

    if (proposal.action === 'createTask') {
      const title = text(proposal.args.title);
      if (!title) return fail(proposal.action, proposal.summary, 'The task needs a title.');
      const date = dateString(proposal.args.date) || todayLocal();
      const time = normalizeTimeSlot(String(proposal.args.timeSlot || ''));
      const existing = await storage.getAll<Task>(storage.key.TASKS);

      // A stated time makes this a schedule block, so it appears in the daily
      // schedule as well as the calendar. Without a time it stays a to-do.
      await storage.add(storage.key.TASKS, {
        uid: 'local',
        title,
        completed: false,
        date: new Date(`${date}T12:00:00`).toISOString(),
        order: time
          ? existing.filter((task) => task.type === 'timeblock').length
          : existing.length,
        ...(time
          ? {
              type: 'timeblock' as const,
              time,
              duration: 30,
              color: '#C7AF94',
              subtasks: [],
            }
          : { type: 'todo' as const }),
      });
      message = time
        ? `Added "${title}" to ${date} at ${time}.`
        : `Added "${title}" to ${date}.`;
    }

    if (proposal.action === 'updateTask') {
      const taskId = text(proposal.args.taskId, 64);
      const tasks = await storage.getAll<Task>(storage.key.TASKS);
      const task = tasks.find((entry) => entry.id === taskId);
      if (!task) return fail(proposal.action, proposal.summary, 'That task no longer exists.');
      const patch: Partial<Task> = {};
      const title = text(proposal.args.title);
      if (title) patch.title = title;
      const date = dateString(proposal.args.date);
      if (date) patch.date = new Date(`${date}T12:00:00`).toISOString();
      if (typeof proposal.args.completed === 'boolean') patch.completed = proposal.args.completed;
      await storage.update(storage.key.TASKS, task.id, patch);
      message = `Updated "${title || task.title}".`;
    }

    if (proposal.action === 'createGoal') {
      const title = text(proposal.args.title);
      if (!title) return fail(proposal.action, proposal.summary, 'The goal needs a title.');
      const steps = list(proposal.args.steps);
      await storage.add(storage.key.GOALS, {
        uid: 'local',
        title,
        progress: 0,
        steps: steps.map((stepTitle) => ({
          id: Math.random().toString(36).slice(2, 9),
          title: stepTitle,
          completed: false,
        })),
        createdAt: now,
      });
      message = `Created the goal "${title}"${steps.length > 0 ? ` with ${steps.length} steps.` : '.'}`;
    }

    if (proposal.action === 'addHabit') {
      const name = text(proposal.args.name);
      if (!name) return fail(proposal.action, proposal.summary, 'The routine needs a name.');
      const steps = list(proposal.args.steps);
      const timeOfDay = ['morning', 'night', 'custom'].includes(String(proposal.args.timeOfDay))
        ? (proposal.args.timeOfDay as Routine['type'])
        : 'custom';
      await storage.add(storage.key.ROUTINES, {
        uid: 'local',
        name,
        type: timeOfDay,
        steps: steps.map((stepTitle) => ({
          id: Math.random().toString(36).slice(2, 9),
          title: stepTitle,
          duration: 120,
          completed: false,
        })),
        order: (await storage.getAll<Routine>(storage.key.ROUTINES)).length,
        createdAt: now,
        streakEnabled: true,
        streak: 0,
        bestStreak: 0,
      });
      message = `Added the routine "${name}".`;
    }

    if (proposal.action === 'setBudgetDraft') {
      const totalBudget = positiveNumber(proposal.args.totalBudget, MAX_AMOUNT);
      if (totalBudget === null) return fail(proposal.action, proposal.summary, 'That budget amount is not valid.');
      const budgets = await storage.getAll<{ id: string; uid: string; totalBudget: number }>(storage.key.BUDGET);
      if (budgets[0]) {
        await storage.update(storage.key.BUDGET, budgets[0].id, { totalBudget, updatedAt: now });
      } else {
        await storage.add(storage.key.BUDGET, { uid: 'local', totalBudget, updatedAt: now });
      }
      message = `Set the monthly budget to ${totalBudget}.`;
    }

    if (proposal.action === 'addListItem') {
      const itemText = text(proposal.args.text, MAX_TEXT);
      if (!itemText) return fail(proposal.action, proposal.summary, 'The list item needs text.');
      const lists = await storage.getAll<{ id: string; title: string; items: { id: string; text: string; completed: boolean }[] }>(
        storage.key.LISTS
      );
      const wantedId = text(proposal.args.listId, 64);
      const wantedTitle = text(proposal.args.listTitle, 60);
      const list =
        (wantedId && lists.find((entry) => entry.id === wantedId)) ||
        (wantedTitle && lists.find((entry) => entry.title.toLowerCase() === wantedTitle.toLowerCase())) ||
        (!wantedId && !wantedTitle ? lists[0] : undefined);
      if (!list) return fail(proposal.action, proposal.summary, 'That list was not found.');
      await storage.update(storage.key.LISTS, list.id, {
        items: [...(list.items || []), { id: Math.random().toString(36).slice(2, 10), text: itemText, completed: false }],
      });
      message = `Added "${itemText}" to ${list.title}.`;
    }

    await record({
      action: proposal.action,
      summary: proposal.summary,
      status: 'applied',
      message,
      createdAt: now,
      uid: 'local',
    });

    return { ok: true, message };
  } catch {
    return fail(proposal.action, proposal.summary, 'That change could not be saved. Try again.');
  }
};

export const listActionHistory = async (limit = 10): Promise<AiActionRecord[]> => {
  const entries = await storage.getAll<AiActionRecord>(storage.key.AI_ACTIONS);
  return [...entries]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
};

export type { Goal };
