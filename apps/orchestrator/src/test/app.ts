import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import express, { type Express } from 'express';
import { MIGRATIONS_DIR, runMigrations } from '@orion/db';
import type { OrionEnv } from '../lib/env.js';
import { createContainer, type Container } from '../lib/container.js';
import { createApiRouter } from '../lib/http/api.js';
import { RunService } from '../lib/services/run.service.js';
import { ChatService } from '../lib/services/chat.service.js';
import { TriggerService } from '../lib/services/trigger.service.js';

/** A test app wired exactly like `main.ts` but backed by in-memory PGlite. */
export interface TestApp {
  app: Express;
  container: Container;
  runs: RunService;
  chat: ChatService;
  triggers: TriggerService;
  dispose: () => Promise<void>;
}

/**
 * A minimal, schema-valid `.orion/config.yaml` for a `local` project. Kept lean
 * (no MCP servers or command files) so specs can drop it into a temp repo dir.
 */
export const SAMPLE_CONFIG_YAML = `project:
  name: test-project
  defaultBranch: main

board:
  swimlanes: [backlog, in_progress, review, done]

workflow:
  name: default
  nodes:
    - id: implement
      type: agent
      provider: codex
      model: gpt-5-codex
      column: in_progress
    - id: verify
      type: shell
      script: 'echo "run tests here"'
      dependsOn: [implement]
      column: in_progress
    - id: approval
      type: approval
      dependsOn: [verify]
      column: review
`;

/** Create a fresh temp directory under the OS temp root. */
export function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `orion-${prefix}-`));
}

/**
 * Create a temp repo directory seeded with a `.orion/config.yaml` (and any extra
 * source files), returning its absolute path for use as a `local` project root.
 */
export async function seedProjectRepo(
  files: Record<string, string> = {},
  configYaml: string = SAMPLE_CONFIG_YAML,
): Promise<string> {
  const dir = await makeTempDir('repo');
  const all: Record<string, string> = { '.orion/config.yaml': configYaml, ...files };
  for (const [relPath, content] of Object.entries(all)) {
    const full = join(dir, relPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  return dir;
}

/**
 * Build an in-memory orchestrator for supertest. Uses `pglite://memory` so the
 * container assembles an embedded PGlite database, then applies migrations
 * before returning. No codex/github keys are set, so AI-backed flows stay
 * offline (RAG falls back to the deterministic local embedding provider).
 */
export async function createTestApp(): Promise<TestApp> {
  const workspaceDir = await makeTempDir('workspace');
  const projectsDir = await makeTempDir('projects');

  const env: OrionEnv = {
    host: 'localhost',
    port: 0,
    databaseUrl: 'pglite://memory',
    workspaceDir,
    projectsDir,
    maxConcurrentRuns: 0,
    publicUrl: 'http://localhost:0',
    codebaseMcpEnabled: true,
    boardSyncIntervalMs: 600000,
  };

  const container = createContainer(env);
  await runMigrations(container.dbHandle, MIGRATIONS_DIR);

  const runs = new RunService(container);
  const chat = new ChatService(container);
  const triggers = new TriggerService(container, runs);

  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(container, runs, chat, triggers));

  const dispose = async (): Promise<void> => {
    triggers.stopScheduler();
    await container.dbHandle.close();
  };

  return { app, container, runs, chat, triggers, dispose };
}
