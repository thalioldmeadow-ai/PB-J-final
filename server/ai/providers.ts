/**
 * Provider adapters.
 *
 * Freebuff, OpenAI and the Hugging Face router all speak the OpenAI chat
 * completions shape, so one adapter covers them: only the base URL, the auth
 * header, the model id and a couple of token-limit fields differ. Adding a
 * provider later means adding one entry to config.ts, not touching a feature.
 */

import { ModelSpec, ProviderId, ProviderSpec } from "./config";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatContent = string | ChatContentPart[];

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: ChatContent;
}

export interface CompletionResult {
  text: string;
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** True when the provider did not report usage and tokens were estimated. */
  estimatedUsage: boolean;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderId,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

const apiKeyFor = (provider: ProviderId): string => {
  if (provider === "freebuff") return process.env.FREEBUFF_API_KEY?.trim() || "";
  if (provider === "openai") return process.env.OPENAI_API_KEY?.trim() || "";
  return (process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || "").trim();
};

const endpointFor = (provider: ProviderSpec, path: string): string =>
  `${provider.baseUrl.replace(/\/+$/, "")}${path}`;

/** The HF router picks the upstream vendor from a model suffix. */
const wireModelId = (provider: ProviderSpec, model: ModelSpec): string =>
  provider.id === "huggingface" && provider.pinnedProvider
    ? `${model.id}:${provider.pinnedProvider}`
    : model.id;

/** Rough fallback when a provider streams text without reporting usage. */
export const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));

/** Images are not free: approximate a vision image at about 1,000 tokens. */
export const estimateMessageTokens = (messages: ChatTurn[]): number => {
  let text = "";
  let images = 0;
  for (const message of messages) {
    if (typeof message.content === "string") {
      text += ` ${message.content}`;
      continue;
    }
    for (const part of message.content) {
      if (part.type === "text") text += ` ${part.text}`;
      else images += 1;
    }
  }
  return estimateTokens(text) + images * 1_000;
};

const textFromResponse = (payload: any): string => {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  // Some multimodal models return an array of parts.
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === "string" ? part : part?.text || ""))
      .join("")
      .trim();
  }
  return "";
};

const requestBody = (options: {
  provider: ProviderSpec;
  model: ModelSpec;
  messages: ChatTurn[];
  temperature: number;
  maxOutputTokens: number;
  stream: boolean;
}): Record<string, unknown> => {
  const { provider, model, messages, temperature, maxOutputTokens, stream } = options;
  const body: Record<string, unknown> = {
    model: wireModelId(provider, model),
    messages,
    temperature,
    stream,
  };

  // OpenAI's newer models reject max_tokens; the rest still use it.
  if (provider.id === "openai") {
    body.max_completion_tokens = maxOutputTokens;
    body.reasoning_effort = process.env.OPENAI_REASONING_EFFORT?.trim() || "low";
  } else {
    body.max_tokens = maxOutputTokens;
  }

  if (stream) {
    // Ask for the usage block in the final chunk where the provider supports it.
    body.stream_options = { include_usage: true };
  }

  return body;
};

const failureFrom = async (response: Response, provider: ProviderSpec): Promise<ProviderError> => {
  const raw = await response.text().catch(() => "");
  const detail = raw.slice(0, 400).replace(/\s+/g, " ").trim();
  // Auth and quota problems are worth surfacing distinctly from a blip.
  const retryable = response.status === 429 || response.status >= 500;
  return new ProviderError(
    `${provider.label} returned ${response.status}${detail ? `: ${detail}` : ""}`,
    provider.id,
    response.status,
    retryable,
  );
};

export const completeChat = async (options: {
  provider: ProviderSpec;
  model: ModelSpec;
  messages: ChatTurn[];
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}): Promise<CompletionResult> => {
  const { provider, model, messages, temperature, maxOutputTokens, timeoutMs } = options;
  const apiKey = apiKeyFor(provider.id);
  if (!apiKey) {
    throw new ProviderError(`${provider.label} is not configured.`, provider.id, 503, false);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(endpointFor(provider, "/chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(
        requestBody({ provider, model, messages, temperature, maxOutputTokens, stream: false }),
      ),
      signal: controller.signal,
    });

    if (!response.ok) throw await failureFrom(response, provider);

    const payload = await response.json();
    const text = textFromResponse(payload);
    if (!text) {
      throw new ProviderError(`${provider.label} returned an empty reply.`, provider.id, 502, true);
    }

    const reportedInput = Number(payload?.usage?.prompt_tokens) || 0;
    const reportedOutput = Number(payload?.usage?.completion_tokens) || 0;

    return {
      text,
      provider: provider.id,
      model: model.id,
      // Provider-reported usage only. A missing usage block is recorded as
      // estimated/zero rather than invented from message length.
      inputTokens: reportedInput,
      outputTokens: reportedOutput,
      latencyMs: Date.now() - startedAt,
      estimatedUsage: !reportedInput || !reportedOutput,
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      error instanceof Error && error.name === "AbortError"
        ? `${provider.label} took longer than ${timeoutMs}ms.`
        : `${provider.label} could not be reached: ${(error as Error).message}`,
      provider.id,
      error instanceof Error && error.name === "AbortError" ? 504 : 502,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
};

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; result: CompletionResult };

/**
 * Streams a reply as it is generated. Yields deltas, then a final result with
 * usage. Throws ProviderError only before the first delta, so the caller knows
 * whether it is still safe to fall back to another provider.
 */
export async function* streamChat(options: {
  provider: ProviderSpec;
  model: ModelSpec;
  messages: ChatTurn[];
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}): AsyncGenerator<StreamEvent, void, unknown> {
  const { provider, model, messages, temperature, maxOutputTokens, timeoutMs } = options;
  const apiKey = apiKeyFor(provider.id);
  if (!apiKey) {
    throw new ProviderError(`${provider.label} is not configured.`, provider.id, 503, false);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let started = false;

  try {
    const response = await fetch(endpointFor(provider, "/chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(
        requestBody({ provider, model, messages, temperature, maxOutputTokens, stream: true }),
      ),
      signal: controller.signal,
    });

    if (!response.ok) throw await failureFrom(response, provider);
    if (!response.body) {
      throw new ProviderError(`${provider.label} returned no stream.`, provider.id, 502, true);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; keep the remainder buffered.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";

      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          let payload: any;
          try {
            payload = JSON.parse(data);
          } catch {
            continue;
          }

          if (payload?.usage) {
            inputTokens = Number(payload.usage.prompt_tokens) || inputTokens;
            outputTokens = Number(payload.usage.completion_tokens) || outputTokens;
          }

          const delta = payload?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            text += delta;
            started = true;
            yield { type: "delta", text: delta };
          }
        }
      }
    }

    if (!text.trim()) {
      throw new ProviderError(`${provider.label} returned an empty reply.`, provider.id, 502, !started);
    }

    yield {
      type: "done",
      result: {
        text,
        provider: provider.id,
        model: model.id,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - startedAt,
        estimatedUsage: !inputTokens || !outputTokens,
      },
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      error instanceof Error && error.name === "AbortError"
        ? `${provider.label} took longer than ${timeoutMs}ms.`
        : `${provider.label} stream failed: ${(error as Error).message}`,
      provider.id,
      error instanceof Error && error.name === "AbortError" ? 504 : 502,
      !started,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Live model discovery. Used by the status route and the check script so a
 * configured model can be verified against the provider instead of assumed.
 */
export const listModels = async (
  provider: ProviderSpec,
  timeoutMs = 15_000,
): Promise<{ id: string; ownedBy?: string }[]> => {
  const apiKey = apiKeyFor(provider.id);
  if (!apiKey) {
    throw new ProviderError(`${provider.label} is not configured.`, provider.id, 503, false);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpointFor(provider, "/models"), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) throw await failureFrom(response, provider);

    const payload = await response.json();
    const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    return items
      .map((entry: any) => ({
        id: String(entry?.id || entry?.model || ""),
        ownedBy: entry?.owned_by ? String(entry.owned_by) : undefined,
      }))
      .filter((entry: { id: string }) => entry.id);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      error instanceof Error && error.name === "AbortError"
        ? `${provider.label} model list timed out.`
        : `${provider.label} model list failed: ${(error as Error).message}`,
      provider.id,
      502,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
};
