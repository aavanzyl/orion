import { EventEmitter } from 'node:events';
import type { ChatEvent } from '@orion/models';

/**
 * In-process pub/sub for chat events, keyed by conversation id. The chat service
 * publishes streaming turn events; the HTTP layer subscribes per-conversation to
 * relay them over SSE. Mirrors {@link RunEventBus}.
 */
export class ChatEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: ChatEvent): void {
    this.emitter.emit(event.conversationId, event);
  }

  subscribe(conversationId: string, listener: (event: ChatEvent) => void): () => void {
    this.emitter.on(conversationId, listener);
    return () => this.emitter.off(conversationId, listener);
  }
}
