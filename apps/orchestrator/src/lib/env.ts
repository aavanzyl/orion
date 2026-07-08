import { resolve } from 'node:path';
import { homedir } from 'node:os';

export interface OrionEnv {
  host: string;
  port: number;
  databaseUrl: string;
  workspaceDir: string;
  /** Root directory the filesystem browser is allowed to list (path picker). */
  projectsDir: string;
  codexApiKey?: string;
  codexBaseUrl?: string;
  githubToken?: string;
  /** When set, run lifecycle notifications are POSTed to this webhook URL. */
  notifyWebhookUrl?: string;
  /** When set, a Slack notifier (key `slack`) is registered for `notify` nodes. */
  slackWebhookUrl?: string;
  /** Max runs executing at once; further runs are queued. 0 = unlimited. */
  maxConcurrentRuns: number;
  /** Public base URL the orchestrator is reachable at (for MCP self-links). */
  publicUrl: string;
  /** Whether the codebase MCP is auto-injected into running agents (default on). */
  codebaseMcpEnabled: boolean;
  /** When set, provider API keys are encrypted with this salt before storage. */
  providerEncryptionSalt?: string;
  /** How often the continuous Linear board sync runs, in milliseconds. */
  boardSyncIntervalMs: number;
}

function parseCount(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return !/^(0|false|no|off)$/i.test(value.trim());
}

export function loadEnv(): OrionEnv {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const host = process.env.HOST ?? 'localhost';
  const port = process.env.PORT ? Number(process.env.PORT) : 3333;
  return {
    host,
    port,
    databaseUrl,
    workspaceDir: resolve(process.env.ORION_WORKSPACE_DIR ?? './.orion-workspace'),
    projectsDir: resolve(process.env.ORION_PROJECTS_DIR ?? homedir()),
    codexApiKey: process.env.CODEX_API_KEY,
    codexBaseUrl: process.env.CODEX_BASE_URL,
    githubToken: process.env.GITHUB_TOKEN,
    notifyWebhookUrl: process.env.ORION_NOTIFY_WEBHOOK_URL,
    slackWebhookUrl: process.env.ORION_SLACK_WEBHOOK_URL,
    maxConcurrentRuns: parseCount(process.env.ORION_MAX_CONCURRENT_RUNS, 3),
    publicUrl: (process.env.ORION_PUBLIC_URL ?? `http://${host}:${port}`).replace(/\/+$/, ''),
    codebaseMcpEnabled: parseBool(process.env.ORION_CODEBASE_MCP, true),
    boardSyncIntervalMs: parseCount(process.env.ORION_BOARD_SYNC_INTERVAL_MS, 600000),
    providerEncryptionSalt: process.env.PROVIDER_ENCRYPTION_SALT,
  };
}
