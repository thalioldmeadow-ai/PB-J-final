import { storage } from './storage';
import { AiMemoryFact } from '../types';

/**
 * Long-term memory.
 *
 * Only two things ever get saved: something the person explicitly asks to be
 * remembered, and (if they switch it on) a short durable statement they make
 * about themselves. Whole conversations are never harvested.
 *
 * Memory lives in the same encrypted vault as everything else, keyed by the
 * unlocked account, so one account can never read another's notes and nothing
 * is readable without the password.
 */

export const MAX_FACTS = 50;
const MAX_TEXT = 200;
const MAX_SELECTED_CHARS = 1_200;

export type MemoryKind = 'preference' | 'goal' | 'project' | 'routine' | 'planning' | 'note';

export const MEMORY_KINDS: { id: MemoryKind; label: string }[] = [
  { id: 'preference', label: 'Preference' },
  { id: 'goal', label: 'Goal' },
  { id: 'project', label: 'Project' },
  { id: 'routine', label: 'Routine' },
  { id: 'planning', label: 'Planning' },
  { id: 'note', label: 'Note' },
];

export const isMemoryKind = (value: unknown): value is MemoryKind =>
  typeof value === 'string' && MEMORY_KINDS.some((kind) => kind.id === value);

export const memoryId = (): string =>
  Math.random().toString(36).slice(2, 11) + Math.random().toString(36).slice(2, 6);

const clean = (text: string): string => String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

export const loadMemory = async (): Promise<AiMemoryFact[]> => {
  const facts = await storage.getAll<AiMemoryFact>(storage.key.AI_MEMORY);
  return [...facts].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
};

export const addMemory = async (
  text: string,
  kind: MemoryKind = 'note',
  source: 'explicit' | 'manual' | 'auto' = 'explicit'
): Promise<AiMemoryFact | null> => {
  const value = clean(text);
  if (value.length < 3) return null;

  const existing = await loadMemory();
  if (existing.some((fact) => fact.text.toLowerCase() === value.toLowerCase())) return null;

  const fact: AiMemoryFact = {
    id: memoryId(),
    text: value,
    kind: isMemoryKind(kind) ? kind : 'note',
    source,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const next = [...existing, fact].slice(-MAX_FACTS);
  await storage.replaceAll(storage.key.AI_MEMORY, next);
  return fact;
};

/** Editing keeps the id, so the note never multiplies when corrected. */
export const updateMemory = async (
  id: string,
  updates: { text?: string; kind?: MemoryKind }
): Promise<boolean> => {
  const existing = await loadMemory();
  const fact = existing.find((entry) => entry.id === id);
  if (!fact) return false;

  const value = updates.text === undefined ? fact.text : clean(updates.text);
  if (value.length < 3) return false;

  const duplicate = existing.some(
    (entry) => entry.id !== id && entry.text.toLowerCase() === value.toLowerCase()
  );
  if (duplicate) return false;

  await storage.update(storage.key.AI_MEMORY, id, {
    text: value,
    kind: updates.kind && isMemoryKind(updates.kind) ? updates.kind : fact.kind || 'note',
    updatedAt: new Date().toISOString(),
  });
  return true;
};

export const forgetMemory = async (id: string): Promise<void> => {
  await storage.delete(storage.key.AI_MEMORY, id);
};

export const clearMemory = async (): Promise<void> => {
  await storage.replaceAll(storage.key.AI_MEMORY, []);
};

/** Words used to match a note to the current question. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'are', 'was', 'were', 'with', 'that', 'this', 'have', 'has',
  'had', 'but', 'not', 'can', 'could', 'would', 'should', 'will', 'just', 'like', 'about', 'what',
  'when', 'where', 'which', 'who', 'how', 'why', 'from', 'they', 'them', 'their', 'there', 'then',
  'than', 'into', 'over', 'under', 'again', 'also', 'some', 'any', 'all', 'more', 'most', 'much',
  'very', 'been', 'being', 'get', 'got', 'make', 'made', 'want', 'need', 'prefer', 'always',
]);

const tokens = (text: string): string[] =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));

const KIND_BONUS: Record<MemoryKind, number> = {
  preference: 0.6,
  goal: 0.5,
  project: 0.4,
  routine: 0.4,
  planning: 0.3,
  note: 0.1,
};

/**
 * Choose the notes worth sending with this question.
 *
 * Everything is scored by word overlap, with a small bonus for kinds that tend
 * to matter in every conversation, and the result is capped by count and by
 * total characters so memory cannot quietly become a second transcript.
 */
export const selectRelevantMemory = (
  facts: AiMemoryFact[],
  query: string,
  limit = 8
): AiMemoryFact[] => {
  if (facts.length === 0 || limit <= 0) return [];
  const queryTokens = new Set(tokens(query));

  const scored = facts.map((fact) => {
    const factTokens = tokens(fact.text);
    const overlap = factTokens.filter((token) => queryTokens.has(token)).length;
    const coverage = factTokens.length > 0 ? overlap / Math.sqrt(factTokens.length) : 0;
    const kind = isMemoryKind(fact.kind) ? fact.kind : 'note';
    return { fact, score: coverage * 2 + KIND_BONUS[kind] };
  });

  const ordered = scored.sort((a, b) => b.score - a.score);
  const chosen: AiMemoryFact[] = [];
  let total = 0;
  for (const entry of ordered) {
    if (chosen.length >= limit) break;
    if (total + entry.fact.text.length > MAX_SELECTED_CHARS) continue;
    chosen.push(entry.fact);
    total += entry.fact.text.length;
  }
  return chosen;
};

/** "remember to ..." and "remember that ..." become durable notes. */
export const memoryCommand = (message: string): { text: string; kind: MemoryKind } | null => {
  const match = message.match(/^\s*(?:remember|keep in mind)\b\s*(?:that|to)?\s*[:,]?\s*(.+)$/i);
  const value = match?.[1]?.trim();
  if (!value || value.length < 3) return null;
  return { text: value.slice(0, MAX_TEXT), kind: guessKind(value) };
};

export const guessKind = (text: string): MemoryKind => {
  if (/\b(prefer|favourite|favorite|don'?t like|hate|love|always|never)\b/i.test(text)) return 'preference';
  if (/\b(goal|aim|target|train for|want to (run|learn|build))\b/i.test(text)) return 'goal';
  if (/\b(project|working on|building|deadline|launch)\b/i.test(text)) return 'project';
  if (/\b(routine|habit|every (morning|night|day)|weekly)\b/i.test(text)) return 'routine';
  if (/\b(plan|schedule|appointment|book|due)\b/i.test(text)) return 'planning';
  return 'note';
};

/**
 * A single durable self-statement, used only when the person has switched on
 * automatic notes. It is deliberately narrow: first person, present tense,
 * about their own preferences, goals, routines or projects. Questions, requests
 * and anything about other people are ignored.
 */
export const autoMemoryCandidate = (message: string): { text: string; kind: MemoryKind } | null => {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (text.length < 12 || text.length > 240) return null;
  if (text.endsWith('?')) return null;
  if (/^\s*(remember|keep in mind)\b/i.test(text)) return null;
  // A statement about someone else is their information, not the user's.
  const thirdParty =
    /\b(he|she|they|my (mum|mom|dad|friend|partner|husband|wife|boyfriend|girlfriend|boss|doctor|therapist|carer|teacher))\b.{0,40}\b(said|says|told|tells|thinks|wants|wanted|reckons|suggested)\b/i;
  if (thirdParty.test(text)) return null;
  if (/\b(he|she|they|my (mum|mom|dad|friend|partner|boss|doctor))\b/i.test(text) && !/\bi\b/i.test(text)) return null;
  if (/\b(password|email|address|phone|card|medicare|passport)\b/i.test(text)) return null;
  if (!/\b(i|i'm|im|my|i've|ive)\b/i.test(text)) return null;
  if (!/\b(prefer|always|never|usually|goal|working on|trying to|routine|every (morning|night|week)|from now on)\b/i.test(text)) {
    return null;
  }
  return { text: text.slice(0, MAX_TEXT), kind: guessKind(text) };
};
