import { useEffect, useRef, useState } from 'react';
import type { ChatEvent, ChatMessage } from '@orion/models';
import { chatStreamUrl } from '@/lib/api';

/** A normalized tool/agent activity item surfaced during a streaming turn. */
export interface ChatStreamItem {
  /** Stable id used to dedupe streamed updates for the same item. */
  id: string;
  /** Item kind, e.g. `reasoning`, `command_execution`, `mcp_tool_call`. */
  type: string;
  /** Short human label for the item (e.g. tool/command name). */
  title: string;
  /** Optional longer detail (command output, arguments, reasoning text). */
  detail?: string;
  /** Lifecycle status when reported (`in_progress`, `completed`, `failed`). */
  status?: string;
}

export interface ChatStreamState {
  /** Persisted messages (replayed on connect, appended live), deduped by id. */
  messages: ChatMessage[];
  /** In-progress assistant text for the current turn, or null when idle. */
  streamingText: string | null;
  /** Tool/agent activity items for the current turn, deduped by id. */
  items: ChatStreamItem[];
  /** True while an assistant turn is streaming. */
  streaming: boolean;
  /** Last error surfaced by the stream, if any. */
  error: string | null;
}

const CHAT_EVENT_TYPES = ['message', 'message.delta', 'item', 'usage', 'done', 'error'];

/** Normalize a raw harness item into a display-friendly {@link ChatStreamItem}. */
function normalizeItem(raw: unknown): ChatStreamItem | null {
  const it = (raw ?? {}) as Record<string, unknown>;
  const type = typeof it.type === 'string' ? it.type : 'item';
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const id = str(it.id) ?? type;
  const status = str(it.status);

  switch (type) {
    case 'reasoning':
      return { id, type, title: 'Thinking', detail: str(it.text), status };
    case 'command_execution':
      return {
        id,
        type,
        title: str(it.command) ?? 'Command',
        detail: str(it.aggregated_output) ?? str(it.output),
        status,
      };
    case 'mcp_tool_call':
      return {
        id,
        type,
        title: `${str(it.server) ?? 'mcp'} · ${str(it.tool) ?? 'tool'}`,
        detail: str(it.result),
        status,
      };
    case 'file_change':
      return { id, type, title: 'File changes', detail: undefined, status };
    case 'web_search':
      return { id, type, title: `Web search: ${str(it.query) ?? ''}`, status };
    case 'error':
      return { id, type, title: 'Error', detail: str(it.message) ?? str(it.text), status };
    default: {
      const detail = str(it.text) ?? str(it.command);
      return { id, type, title: type, detail, status };
    }
  }
}

/** Insert or replace an item by id (harness re-emits the same id as it updates). */
function upsertItem(items: ChatStreamItem[], next: ChatStreamItem): ChatStreamItem[] {
  const index = items.findIndex((i) => i.id === next.id);
  if (index === -1) return [...items, next];
  const copy = items.slice();
  copy[index] = next;
  return copy;
}

/**
 * Subscribe to a conversation's SSE stream. Returns persisted messages plus the
 * live streaming buffer for the current assistant turn. Mirrors `useRunStream`.
 */
export function useChatStream(conversationId: string | null): ChatStreamState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [items, setItems] = useState<ChatStreamItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    seen.current = new Set();
    setMessages([]);
    setStreamingText(null);
    setItems([]);
    setStreaming(false);
    setError(null);
    if (!conversationId) return;

    const source = new EventSource(chatStreamUrl(conversationId));

    const handler = (e: MessageEvent) => {
      let event: ChatEvent;
      try {
        event = JSON.parse(e.data) as ChatEvent;
      } catch {
        return;
      }
      switch (event.type) {
        case 'message': {
          if (!event.message || seen.current.has(event.message.id)) return;
          seen.current.add(event.message.id);
          const message = event.message;
          setMessages((prev) => [...prev, message]);
          if (message.role === 'assistant') {
            setStreamingText(null);
            setItems([]);
            setStreaming(false);
          }
          break;
        }
        case 'message.delta': {
          setStreaming(true);
          setError(null);
          setStreamingText(event.text ?? '');
          break;
        }
        case 'item': {
          setStreaming(true);
          const normalized = normalizeItem(event.item);
          if (normalized) setItems((prev) => upsertItem(prev, normalized));
          break;
        }
        case 'done': {
          setStreaming(false);
          setStreamingText(null);
          setItems([]);
          break;
        }
        case 'error': {
          setError(event.error ? normalizeStreamError(event.error) : 'Chat turn failed');
          setStreaming(false);
          break;
        }
        default:
          break;
      }
    };

    for (const type of CHAT_EVENT_TYPES) {
      source.addEventListener(type, handler as EventListener);
    }
    source.onmessage = handler;

    return () => source.close();
  }, [conversationId]);

  return { messages, streamingText, items, streaming, error };
}

function normalizeStreamError(error: string): string {
  if (/exited with code/i.test(error)) {
    return `${error}. This usually happens when the provider's API is unreachable or the model is not supported. Try again or check your provider configuration in Settings.`;
  }
  return error;
}
