import { AiChatAttachment, AiCreditSummary, AiProviderChoice, AiStatus } from '../types';
import { notifyCreditChange } from './aiCredits';

/**
 * Browser side of the AI system.
 *
 * Features never talk to a provider. They call this, which posts to the app's
 * own server, which holds the keys. Nothing here knows a model name beyond the
 * one the server reports.
 */

export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'AiRequestError';
  }
}

const parseError = async (response: Response): Promise<AiRequestError> => {
  let message = 'The assistant is not available right now.';
  let code = 'unknown';
  try {
    const body = await response.json();
    if (typeof body?.error === 'string') message = body.error;
    if (typeof body?.code === 'string') code = body.code;
  } catch {
    // Keep the default message for non-JSON responses.
  }
  return new AiRequestError(message, code, response.status);
};

export const fetchAiStatus = async (user?: string): Promise<AiStatus | null> => {
  try {
    const response = await fetch('/api/ai/status', {
      headers: await headersFor(false, { message: '', user }),
    });
    if (!response.ok) return null;
    return (await response.json()) as AiStatus;
  } catch {
    return null;
  }
};

export interface AiTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Which screen an ask came from, so the server can add the right guidance. */
export type AiFeatureMode = 'planning' | 'budget' | 'habits' | 'progress' | 'lists' | 'general';

export interface AskAiOptions {
  message: string;
  mode?: AiFeatureMode;
  /** Named actions the assistant may propose on this screen, never run itself. */
  actions?: string[];
  history?: AiTurn[];
  /** Deterministic summary of earlier turns that were not sent verbatim. */
  summary?: string;
  memory?: string[];
  context?: Record<string, unknown>;
  ageBand?: 'child' | 'teen' | 'adult';
  name?: string;
  provider?: AiProviderChoice;
  /** Local account id; hashed in the browser, never sent as itself. */
  user?: string;
  /** Files sent with this message only. */
  attachments?: AiChatAttachment[];
  /** Reusing this id makes a retry idempotent on the credit server. */
  requestId?: string;
}

export interface AskAiResult {
  reply: string;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number; estimated?: boolean };
  latencyMs: number;
  fellBack: boolean;
  streaming?: boolean;
  cached?: boolean;
  safety: { crisis: boolean; blocked: boolean; flags?: string[] };
  /** What the app actually sent, shown as a short line in the interface. */
  shared?: { contextTopics: string[]; memoryCount: number; historyTurns: number; summarised: boolean };
  /** The caller's wallet after the request. */
  credits?: AiCreditSummary;
}

const newAiRequestId = (): string =>
  'req-' +
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

const bodyFor = (options: AskAiOptions): string =>
  JSON.stringify({
    message: options.message,
    history: options.history || [],
    summary: options.summary || '',
    memory: options.memory || [],
    context: options.context || {},
    ageBand: options.ageBand || 'adult',
    name: options.name,
    mode: options.mode || 'general',
    actions: options.actions || [],
    provider: options.provider && options.provider !== 'auto' ? options.provider : undefined,
    attachments: (options.attachments || []).map((attachment) => ({
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      kind: attachment.kind,
      dataUrl: attachment.preview,
      text: attachment.text,
    })),
  });

const headersFor = async (contentType: boolean, options: AskAiOptions): Promise<Record<string, string>> => {
  return {
    ...(contentType ? { 'Content-Type': 'application/json' } : {}),
    ...(options.requestId ? { 'x-ai-request-id': options.requestId } : {}),
  };
};

const timeout = (ms: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(timer) };
};

const offlineError = (error: unknown): AiRequestError =>
  error instanceof Error && error.name === 'AbortError'
    ? new AiRequestError('The assistant took too long to answer.', 'timeout', 504)
    : new AiRequestError(
        'The assistant could not be reached. Check your connection and try again.',
        'offline',
        0
      );

/**
 * Report a reply by reason category only. The reply text is never uploaded, so
 * the operator can count reports without reading anyone's conversation.
 */
export const reportAiReply = async (
  reason: 'inaccurate' | 'unsafe' | 'unhelpful' | 'other'
): Promise<boolean> => {
  try {
    const response = await fetch('/api/ai/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const askAi = async (options: AskAiOptions): Promise<AskAiResult> => {
  const { controller, clear } = timeout(45_000);
  const requestId = options.requestId || newAiRequestId();

  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: await headersFor(true, { ...options, requestId }),
      body: bodyFor(options),
      signal: controller.signal,
    });

    if (!response.ok) throw await parseError(response);
    return (await response.json()) as AskAiResult;
  } catch (error) {
    if (error instanceof AiRequestError) throw error;
    throw offlineError(error);
  } finally {
    clear();
    notifyCreditChange();
  }
};

/**
 * Streams a reply through server-sent events, calling onDelta with each chunk.
 * Falls back only when the server never started answering, so half a reply is
 * never duplicated.
 */
export const askAiStream = async (
  options: AskAiOptions,
  onDelta: (text: string) => void
): Promise<AskAiResult> => {
  const { controller, clear } = timeout(90_000);
  const requestId = options.requestId || newAiRequestId();

  try {
    const response = await fetch('/api/ai/chat/stream', {
      method: 'POST',
      headers: {
        ...(await headersFor(true, { ...options, requestId })),
        Accept: 'text/event-stream',
      },
      body: bodyFor(options),
      signal: controller.signal,
    });

    if (!response.ok) throw await parseError(response);
    if (!response.body) throw new AiRequestError('No stream from the server.', 'no_stream', 502);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let final: AskAiResult | undefined;
    let streamError: AiRequestError | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';

      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;

          let payload: any;
          try {
            payload = JSON.parse(data);
          } catch {
            continue;
          }

          if (payload?.type === 'delta' && typeof payload.text === 'string') {
            onDelta(payload.text);
          } else if (payload?.type === 'done' && payload.response) {
            final = payload.response as AskAiResult;
          } else if (payload?.type === 'error') {
            streamError = new AiRequestError(
              typeof payload.error === 'string' ? payload.error : 'The reply stopped early.',
              typeof payload.code === 'string' ? payload.code : 'stream_error',
              502
            );
          }
        }
      }
    }

    if (streamError) throw streamError;
    if (!final) throw new AiRequestError('The reply ended unexpectedly.', 'stream_incomplete', 502);
    return final;
  } catch (error) {
    if (error instanceof AiRequestError) throw error;
    throw offlineError(error);
  } finally {
    clear();
    notifyCreditChange();
  }
};
