import type { Container } from '../container.js';

/** Default cadence for the continuous board sync heartbeat (10 minutes). */
export const BOARD_SYNC_INTERVAL_MS = 10 * 60_000;

/**
 * Resolution the heartbeat ticks at. Per-connection cadences finer than the
 * global default are honored down to this granularity (1 minute).
 */
export const BOARD_SYNC_TICK_MS = 60_000;

/**
 * Periodically reconciles every project with an enabled board connection by
 * pulling remote issues via {@link BoardSyncService.syncNow}. Each connection is
 * gated by its own `syncIntervalMs` (falling back to the global default) and its
 * `direction` (push-only connections are skipped). Push-on-change is handled
 * elsewhere. A single `unref`'d interval, guarded against overlapping ticks.
 */
export class BoardSyncScheduler {
  private interval?: ReturnType<typeof setInterval>;
  /** Guards against overlapping heartbeats. */
  private ticking = false;

  constructor(private readonly c: Container) {}

  /** Start the heartbeat. Idempotent. */
  startScheduler(): void {
    if (this.interval) return;
    const configured = this.c.env.boardSyncIntervalMs || BOARD_SYNC_INTERVAL_MS;
    const period = Math.max(1_000, Math.min(configured, BOARD_SYNC_TICK_MS));
    this.interval = setInterval(() => {
      void this.tick();
    }, period);
    // Never keep the process alive solely for the scheduler.
    this.interval.unref?.();
  }

  stopScheduler(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  /** How long until a connection is due for its next pull. `<= 0` means now. */
  private dueIn(conn: { syncIntervalMs?: number; lastSyncedAt?: string }, now: number): number {
    const cadence =
      conn.syncIntervalMs && conn.syncIntervalMs > 0
        ? conn.syncIntervalMs
        : this.c.env.boardSyncIntervalMs || BOARD_SYNC_INTERVAL_MS;
    if (!conn.lastSyncedAt) return 0;
    return new Date(conn.lastSyncedAt).getTime() + cadence - now;
  }

  /** One heartbeat: pull every due, enabled, pull-capable connection. */
  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      const connections = await this.c.boardConnections.listEnabled();
      for (const conn of connections) {
        if (!conn.apiKey) continue;
        if (conn.direction === 'push') continue;
        if (this.dueIn(conn, now) > 0) continue;
        try {
          await this.c.boardSync.syncNow(conn.projectId);
        } catch (err) {
          console.error(
            `[ orion orchestrator ] board sync failed for project ${conn.projectId}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    } catch (err) {
      console.error('[ orion orchestrator ] board sync heartbeat failed:', err);
    } finally {
      this.ticking = false;
    }
  }
}
