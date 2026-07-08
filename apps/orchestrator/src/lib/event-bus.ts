import { EventEmitter } from 'node:events';
import type { RunEvent } from '@orion/models';

/**
 * In-process pub/sub for run events. The engine emits events (which are also
 * persisted); the HTTP layer subscribes per-run to stream them over SSE.
 */
export class RunEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: RunEvent): void {
    this.emitter.emit(event.runId, event);
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    this.emitter.on(runId, listener);
    return () => this.emitter.off(runId, listener);
  }

  emit(channel: string, payload: unknown): void {
    this.emitter.emit(channel, payload);
  }

  on(channel: string, listener: (payload: unknown) => void): () => void {
    this.emitter.on(channel, listener);
    return () => this.emitter.off(channel, listener);
  }
}
