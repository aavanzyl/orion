import express from 'express';
import { MIGRATIONS_DIR, runMigrations } from '@orion/db';
import { loadEnv } from './lib/env.js';
import { createContainer } from './lib/container.js';
import { createApiRouter } from './lib/http/api.js';
import { mountMcpRoutes } from './lib/mcp/mcp-routes.js';
import { RunService } from './lib/services/run.service.js';
import { ChatService } from './lib/services/chat.service.js';
import { TriggerService } from './lib/services/trigger.service.js';
import { BoardSyncScheduler } from './lib/services/board-sync-scheduler.service.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const container = createContainer(env);

  const dir = process.env.ORION_MIGRATIONS_DIR ?? MIGRATIONS_DIR;
  await runMigrations(container.dbHandle, dir).catch((err: unknown) => {
    console.error('[ orion orchestrator ] migration error (continuing):', err);
  });

  const runs = new RunService(container);
  const chat = new ChatService(container);
  const triggers = new TriggerService(container, runs);
  const boardSync = new BoardSyncScheduler(container);

  // Surface any runs orphaned by a previous process before accepting traffic.
  await runs.recoverInterruptedRuns().catch((err: unknown) => {
    console.error('[ orion orchestrator ] run recovery failed:', err);
  });

  // Begin polling cron triggers once recovery has settled.
  await triggers.startScheduler().catch((err: unknown) => {
    console.error('[ orion orchestrator ] trigger scheduler failed to start:', err);
  });

  // Continuously reconcile connected Linear boards on a heartbeat.
  boardSync.startScheduler();

  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', createApiRouter(container, runs, chat, triggers));

  // Mount the codebase + tickets MCP servers (SSE transport) for external agents.
  mountMcpRoutes(app, container);

  app.listen(env.port, env.host, () => {
    console.log(`[ orion orchestrator ] http://${env.host}:${env.port}`);
  });
}

main().catch((err: unknown) => {
  console.error('[ orion orchestrator ] fatal:', err);
  process.exit(1);
});
