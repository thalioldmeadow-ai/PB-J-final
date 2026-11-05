import type { AiTurn } from './ai';

/**
 * Short-term memory for a conversation.
 *
 * A long thread cannot be sent whole: it would cost more every turn and the
 * oldest turns are usually irrelevant. Instead this builds a bounded window:
 * the most recent turns, plus the older turns that share words with the current
 * question, plus a short deterministic summary of what was left out.
 *
 * Nothing here calls a model, so building the window is free, instant and
 * repeatable. It also keeps working when the assistant is unreachable.
 */

export interface StoredTurn {
  id?: string;
  role: 'user' | 'assistant';
  text: string;
}

export interface ConversationWindow {
  /** Oldest first, ready to send as `history`. */
  turns: AiTurn[];
  /** One or two sentences describing omitted earlier turns. */
  summary: string;
  /** How many stored turns were left out of `turns`. */
  omitted: number;
  /** Ids of the stored turns that were included, for tests and transparency. */
  usedIds: string[];
}

export interface WindowOptions {
  /** Most recent turns always kept verbatim. */
  maxRecent?: number;
  /** Extra older turns chosen by relevance to the current message. */
  maxRelevant?: number;
  /** Hard cap on the characters of history sent. */
  maxChars?: number;
  /** Cap on the summary line. */
  summaryChars?: number;
  /** Turns shorter than this are not worth retrieving on their own. */
  minRelevantChars?: number;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'yours', 'are', 'was', 'were', 'with', 'that', 'this',
  'have', 'has', 'had', 'but', 'not', 'can', 'could', 'would', 'should', 'will', 'just', 'like',
  'about', 'what', 'when', 'where', 'which', 'who', 'how', 'why', 'from', 'they', 'them', 'their',
  'there', 'here', 'then', 'than', 'into', 'over', 'under', 'again', 'also', 'some', 'any', 'all',
  'more', 'most', 'much', 'very', 'been', 'being', 'get', 'got', 'make', 'made', 'want', 'need',
  'today', 'tomorrow', 'yesterday', 'now', 'please', 'help', 'thanks', 'thank', 'okay', 'yes',
  'youre', 'im', 'ive', 'dont', 'doesnt', 'didnt', 'cant', 'wont', 'isnt', 'thats', 'its',
]);

const DEFAULT_OPTIONS: Required<WindowOptions> = {
  maxRecent: 8,
  maxRelevant: 3,
  maxChars: 6_000,
  summaryChars: 400,
  minRelevantChars: 20,
};

export const tokenise = (text: string): string[] => {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s$%]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  return [...new Set(words)];
};

const firstSentence = (text: string, max = 120): string => {
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  const stop = clean.search(/[.!?](\s|$)/);
  const sentence = stop > 0 ? clean.slice(0, stop + 1) : clean;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
};

/** Overlap between a stored turn and the current question, with a small recency nudge. */
export const relevanceScore = (
  turn: StoredTurn,
  queryTokens: string[],
  positionFromEnd: number
): number => {
  if (queryTokens.length === 0) return 0;
  const turnTokens = new Set(tokenise(turn.text));
  let overlap = 0;
  for (const token of queryTokens) if (turnTokens.has(token)) overlap += 1;
  const coverage = overlap / queryTokens.length;
  const recency = 1 / (1 + positionFromEnd / 6);
  return coverage * 2 + recency * 0.25;
};

/**
 * Build the window sent to the server.
 *
 * Recent turns win. Older turns are only added when they are relevant, and the
 * whole thing is trimmed from the oldest end until it fits the character cap,
 * so a pasted essay earlier in the thread can never crowd out the question.
 */
export const buildConversationWindow = (
  messages: StoredTurn[],
  query: string,
  options: WindowOptions = {}
): ConversationWindow => {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const stored = messages.filter(
    (message) =>
      message &&
      (message.role === 'user' || message.role === 'assistant') &&
      String(message.text || '').trim().length > 0
  );

  if (stored.length === 0) {
    return { turns: [], summary: '', omitted: 0, usedIds: [] };
  }

  const recent = stored.slice(-config.maxRecent);
  const older = stored.slice(0, Math.max(0, stored.length - recent.length));

  const queryTokens = tokenise(query);
  const scored = older
    .map((message, index) => ({
      message,
      index,
      positionFromEnd: older.length - index,
      score: relevanceScore(message, queryTokens, older.length - index),
      size: String(message.text || '').length,
    }))
    .filter((entry) => entry.size >= config.minRelevantChars && entry.score > 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.maxRelevant)
    .sort((a, b) => a.index - b.index);

  const chosen = new Set<StoredTurn>([...recent, ...scored.map((entry) => entry.message)]);

  // Trim the whole selection from the oldest end if it is still too large.
  let ordered = stored.filter((message) => chosen.has(message));
  const totalChars = () => ordered.reduce((sum, message) => sum + String(message.text).length, 0);
  while (ordered.length > recent.length && totalChars() > config.maxChars) {
    ordered = ordered.slice(1);
  }
  // Even the recent turns may be huge; keep the newest ones that fit.
  while (ordered.length > 0 && totalChars() > config.maxChars) {
    ordered = ordered.slice(1);
  }

  const used = new Set(ordered);
  const leftOut = older.filter((message) => !used.has(message));

  const summaryLines: string[] = [];
  for (const message of leftOut.slice(-12)) {
    if (message.role !== 'user') continue;
    const sentence = firstSentence(message.text, 100);
    if (sentence) summaryLines.push(`- They asked earlier: ${sentence}`);
  }

  let summary = summaryLines.join('\n');
  if (summary.length > config.summaryChars) {
    summary = `${summary.slice(0, config.summaryChars - 1).trimEnd()}…`;
  }

  return {
    turns: ordered.map((message) => ({ role: message.role, content: String(message.text) })),
    summary,
    omitted: leftOut.length,
    usedIds: ordered.map((message) => message.id).filter((id): id is string => Boolean(id)),
  };
};

/** How much of the conversation is being sent, for the transparency line in the UI. */
export const windowStats = (window: ConversationWindow) => ({
  turns: window.turns.length,
  omitted: window.omitted,
  chars: window.turns.reduce((sum, turn) => sum + turn.content.length, 0),
  summarised: window.summary.length > 0,
});
