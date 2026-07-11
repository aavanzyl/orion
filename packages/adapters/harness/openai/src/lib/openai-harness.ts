import type {
  AgentProvider,
  HarnessEvent,
  HarnessRunOptions,
  HarnessTurnResult,
  HarnessUsage,
} from '@orion/harness-core';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

export interface OpenAiHarnessDefaults {
  /** Fallback API key when a run does not supply one. */
  apiKey?: string;
  /** Fallback base URL (OpenAI-compatible), e.g. https://api.deepseek.com/v1. */
  baseUrl?: string;
  /** Default model when a run/agent does not specify one. */
  model?: string;
}

/** Minimal shape of a streamed Chat Completions SSE chunk. */
interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}

/**
 * Conversational harness that talks directly to an OpenAI-compatible
 * `/chat/completions` endpoint. Unlike the Codex harness (which now requires
 * OpenAI's Responses API), this works with DeepSeek, OpenAI, and any provider
 * exposing the Chat Completions wire protocol. It performs no repository edits
 * or tool execution — it is a pure text turn suited to the chat experience.
 */
export class OpenAiHarness implements AgentProvider {
  readonly key = 'openai';

  constructor(private readonly defaults: OpenAiHarnessDefaults = {}) {}

  async run(prompt: string, options: HarnessRunOptions): Promise<HarnessTurnResult> {
    let finalResponse = '';
    let usage: HarnessUsage | undefined;
    for await (const event of this.runStreamed(prompt, options)) {
      if (event.type === 'message') finalResponse = event.text;
      else if (event.type === 'completed') {
        finalResponse = event.result.finalResponse || finalResponse;
        usage = event.result.usage;
      }
    }
    return { finalResponse, threadId: options.threadId, items: [], usage };
  }

  async *runStreamed(
    prompt: string,
    options: HarnessRunOptions,
  ): AsyncIterable<HarnessEvent> {
    const apiKey = options.apiKey ?? this.defaults.apiKey;
    if (!apiKey) throw new Error('OpenAI harness requires an API key.');

    const baseUrl = (options.baseUrl ?? this.defaults.baseUrl ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      '',
    );
    const model = options.model ?? this.defaults.model ?? DEFAULT_MODEL;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: options.signal,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Chat Completions request failed (${response.status} ${response.statusText})${
          detail ? `: ${detail.slice(0, 500)}` : ''
        }`,
      );
    }

    let finalResponse = '';
    let reasoning = '';
    let usage: HarnessUsage | undefined;

    for await (const data of parseSseStream(response.body)) {
      if (data === '[DONE]') break;
      let chunk: ChatCompletionChunk;
      try {
        chunk = JSON.parse(data) as ChatCompletionChunk;
      } catch {
        continue;
      }
      const reasoningDelta = chunk.choices?.[0]?.delta?.reasoning_content;
      if (reasoningDelta) {
        reasoning += reasoningDelta;
        yield { type: 'item', item: { id: 'reasoning', type: 'reasoning', text: reasoning } };
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        finalResponse += delta;
        yield { type: 'message', text: finalResponse };
      }
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        };
      }
    }

    yield {
      type: 'completed',
      result: { finalResponse, threadId: options.threadId, items: [], usage },
    };
  }
}

/**
 * Decode a `text/event-stream` body into the raw `data:` payloads, buffering
 * partial lines across chunk boundaries.
 */
async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) yield tail.slice(5).trim();
  } finally {
    reader.releaseLock();
  }
}
