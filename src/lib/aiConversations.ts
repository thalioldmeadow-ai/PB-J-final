import { storage } from './storage';
import { AiConversation, AiStoredMessage } from '../types';

/**
 * Conversations live in the encrypted vault alongside everything else, so the
 * list, titles and messages are only readable with the account password and
 * never leave the device except as the messages the owner sends.
 *
 * The storage service generates its own ids for `add`, so conversation records
 * are written with `replaceAll` to keep the id that their messages point at.
 * Losing that link is what makes a thread look empty, so it is deliberate here.
 */

const LEGACY_THREAD = 'coach';
const MAX_TITLE = 60;

export const newConversationId = (): string =>
  `c_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

/** A short, readable title from the first thing the person said. */
export const titleFromMessage = (text: string): string => {
  const clean = String(text || '')
    .replace(/^\s*(remember|keep in mind)\b\s*(that|to)?\s*[:,]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[#*_`>]/g, '')
    .trim();
  if (!clean) return 'New conversation';
  return clean.length > MAX_TITLE ? `${clean.slice(0, MAX_TITLE - 1)}…` : clean;
};

export const listConversations = async (): Promise<AiConversation[]> => {
  const conversations = await storage.getAll<AiConversation>(storage.key.AI_CONVERSATIONS);
  return [...conversations].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
};

export const getConversation = async (id: string): Promise<AiConversation | null> =>
  (await listConversations()).find((conversation) => conversation.id === id) || null;

export const loadMessages = async (conversationId: string): Promise<AiStoredMessage[]> => {
  const all = await storage.getAll<AiStoredMessage>(storage.key.AI_MESSAGES);
  return all
    .filter((message) => message.conversationId === conversationId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
};

export const addMessage = async (
  message: Omit<AiStoredMessage, 'id'> & { id?: string }
): Promise<AiStoredMessage> => {
  const id = await storage.add(storage.key.AI_MESSAGES, {
    conversationId: message.conversationId,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
    provider: message.provider,
    model: message.model,
    attachments: message.attachments,
  });
  return { ...message, id };
};

export const createConversation = async (title = 'New conversation'): Promise<AiConversation> => {
  const now = new Date().toISOString();
  const conversation: AiConversation = {
    id: newConversationId(),
    title: title.slice(0, MAX_TITLE),
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
  const existing = await storage.getAll<AiConversation>(storage.key.AI_CONVERSATIONS);
  await storage.replaceAll(storage.key.AI_CONVERSATIONS, [...existing, conversation]);
  return conversation;
};

export const touchConversation = async (
  id: string,
  updates: Partial<Pick<AiConversation, 'title' | 'updatedAt' | 'messageCount'>> = {}
): Promise<void> => {
  await storage.update(storage.key.AI_CONVERSATIONS, id, {
    updatedAt: updates.updatedAt || new Date().toISOString(),
    ...(updates.title ? { title: updates.title.slice(0, MAX_TITLE) } : {}),
    ...(typeof updates.messageCount === 'number' ? { messageCount: updates.messageCount } : {}),
  });
};

export const renameConversation = async (id: string, title: string): Promise<void> => {
  const clean = title.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE);
  if (!clean) return;
  await touchConversation(id, { title: clean });
};

/** Deleting a conversation removes its messages too; other threads are untouched. */
export const deleteConversation = async (id: string): Promise<void> => {
  const messages = await storage.getAll<AiStoredMessage>(storage.key.AI_MESSAGES);
  const remaining = messages.filter((message) => message.conversationId !== id);
  if (remaining.length !== messages.length) {
    await storage.replaceAll(storage.key.AI_MESSAGES, remaining);
  }
  await storage.delete(storage.key.AI_CONVERSATIONS, id);
};

const dedupe = (items: AiConversation[]): AiConversation[] => {
  const byId = new Map<string, AiConversation>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing || existing.updatedAt < item.updatedAt) byId.set(item.id, item);
  }
  return [...byId.values()];
};

/**
 * Load the conversation list and repair it:
 *
 * 1. duplicate records (two tabs adopting the same thread) are merged,
 * 2. messages whose conversation record is missing are adopted into one, which
 *    is how an earlier single-thread build is carried forward,
 * 3. message counts are recomputed from the messages that actually exist.
 */
export const ensureConversations = async (): Promise<AiConversation[]> => {
  const loaded = await listConversations();
  const unique = dedupe(loaded);
  if (unique.length !== loaded.length) {
    await storage.replaceAll(storage.key.AI_CONVERSATIONS, unique);
  }

  const messages = await storage.getAll<AiStoredMessage>(storage.key.AI_MESSAGES);
  let conversations = unique;

  const known = new Set(conversations.map((conversation) => conversation.id));
  const orphans = new Map<string, AiStoredMessage[]>();
  for (const message of messages) {
    if (known.has(message.conversationId)) continue;
    const group = orphans.get(message.conversationId) || [];
    group.push(message);
    orphans.set(message.conversationId, group);
  }

  if (orphans.size > 0) {
    const adopted = [...conversations];
    for (const [id, group] of orphans) {
      const ordered = [...group].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      const firstUser = ordered.find((message) => message.role === 'user');
      adopted.push({
        id,
        title: firstUser ? titleFromMessage(firstUser.text) : 'Earlier conversation',
        createdAt: ordered[0].createdAt,
        updatedAt: ordered[ordered.length - 1].createdAt,
        messageCount: ordered.length,
      });
    }
    conversations = adopted;
    await storage.replaceAll(storage.key.AI_CONVERSATIONS, conversations);
  }

  if (conversations.length === 0) {
    const fresh = await createConversation();
    return [fresh];
  }

  const counted = new Map<string, number>();
  for (const message of messages) {
    counted.set(message.conversationId, (counted.get(message.conversationId) || 0) + 1);
  }

  for (const conversation of conversations) {
    const actual = counted.get(conversation.id) || 0;
    if (conversation.messageCount !== actual) {
      await storage.update(storage.key.AI_CONVERSATIONS, conversation.id, { messageCount: actual });
      conversation.messageCount = actual;
    }
  }

  return conversations.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
};

export const LEGACY_CONVERSATION_ID = LEGACY_THREAD;
