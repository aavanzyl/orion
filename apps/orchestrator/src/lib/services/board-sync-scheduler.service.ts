import type { Container } from '../container.js';

/** Default cadence for the continuous Linear board sync heartbeat. */
export const BOARD_SYNC_INTERVAL_MS = 10 * 60_000;

/**
 * Periodically reconciles every project with an enabled Linear connection by
 * pulling remote issues via {@link LinearSyncService.syncNow}. Push-on-change is
 * handled elsewhere (when a ticket moves); this heartbeat covers the pull side
 * and periodic reconcile. Modeled after the cron trigger scheduler: a single
 * `unref`'d interval guarded against overlapping ticks.
 */
export class BoardSyncScheduler {
  private interval?: ReturnType<typeof setInterval>;
  /** Guards against overlapping heartbeats. */
  private ticking = false;

  constructor(private readonly c: Container) {}

  /** Start the heartbeat. Idempotent. */
  startScheduler(): void {
    if (this.interval) return;
    const period = this.c.env.boardSyncIntervalMs || BOARD_SYNC_INTERVAL_MS;
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

  /** One heartbeat: sync every project with an enabled Linear connection. */
  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const connections = await this.c.boardConnections.listEnabled();
      for (const conn of connections) {
        if (!conn.apiKey) continue;
        try {
          await this.c.linearSync.syncNow(conn.projectId);
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
