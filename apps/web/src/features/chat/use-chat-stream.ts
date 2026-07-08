import { useEffect, useRef, useState } from 'react';
import type { ChatEvent, ChatMessage } from '@orion/models';
import { chatStreamUrl } from '@/lib/api';

export interface ChatStreamState {
  /** Persisted messages (replayed on connect, appended live), deduped by id. */
  messages: ChatMessage[];
  /** In-progress assistant text for the current turn, or null when idle. */
  streamingText: string | null;
  /** Tool/agent activity items for the current turn. */
  items: unknown[];
  /** True while an assistant turn is streaming. */
  streaming: boolean;
  /** Last error surfaced by the stream, if any. */
  error: string | null;
}

const CHAT_EVENT_TYPES = ['message', 'message.delta', 'item', 'usage', 'done', 'error'];

/**
 * Subscribe to a conversation's SSE stream. Returns persisted messages plus the
 * live streaming buffer for the current assistant turn. Mirrors `useRunStream`.
 */
export function useChatStream(conversationId: string | null): ChatStreamState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [items, setItems] = useState<unknown[]>([]);
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
          setItems((prev) => [...prev, event.item]);
          break;
        }
        case 'done': {
          setStreaming(false);
          setStreamingText(null);
          setItems([]);
          break;
        }
        case 'error': {
          setError(event.error ?? 'Chat turn failed');
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
