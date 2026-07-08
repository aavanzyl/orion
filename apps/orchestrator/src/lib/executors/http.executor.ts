import { renderTemplate } from '@orion/config';
import type { NodeExecutor, NodeExecutionContext, NodeOutcome } from '@orion/workflow-engine';
import { decrypt } from '../crypto.js';

export interface HttpExecutorOptions {
  /**
   * Server encryption salt. When set, a `token` stored on the node is treated
   * as ciphertext (prefixed `aes256:`) and decrypted in-process before use.
   */
  encryptionSalt?: string;
  /** Injectable fetch implementation (defaults to the global `fetch`). */
  fetchImpl?: typeof fetch;
  /** Injectable token decryptor (defaults to the orchestrator AES-GCM decrypt). */
  decryptToken?: (ciphertext: string, salt: string) => string;
}

/** Maximum length of a response snippet embedded in a failure error. */
const MAX_ERROR_SNIPPET = 500;

/**
 * Executes an `http` node: performs an HTTP request and captures the response
 * for downstream data-flow.
 *
 * Security: a bearer `token` is decrypted in-process and only ever placed in the
 * outgoing `Authorization` request header. It is NEVER logged, emitted, or
 * returned in the node output. Emitted logs are restricted to method/url/status.
 */
export class HttpNodeExecutor implements NodeExecutor {
  readonly type = 'http' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly decryptToken: (ciphertext: string, salt: string) => string;

  constructor(private readonly options: HttpExecutorOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.decryptToken = options.decryptToken ?? decrypt;
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeOutcome> {
    const cfg = ctx.nodeConfig;
    if (!cfg.url) {
      return { status: 'failed', error: 'http node has no url' };
    }
    if (typeof this.fetchImpl !== 'function') {
      return { status: 'failed', error: 'no fetch implementation available' };
    }

    const url = renderTemplate(cfg.url, {}, ctx.nodeOutputs);
    const method = (cfg.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(cfg.headers ?? {})) {
      headers[key] = renderTemplate(value, {}, ctx.nodeOutputs);
    }

    if (cfg.token) {
      const salt = this.options.encryptionSalt;
      const token = salt ? this.decryptToken(cfg.token, salt) : cfg.token;
      headers.Authorization = `Bearer ${token}`;
    }

    const allowsBody = method !== 'GET' && method !== 'HEAD';
    let body: string | undefined;
    if (cfg.body && allowsBody) {
      body = renderTemplate(cfg.body, {}, ctx.nodeOutputs);
      const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type');
      if (!hasContentType) headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await this.fetchImpl(url, { method, headers, body, signal: ctx.signal });
      const text = await response.text();
      const data = parseResponse(text);

      // Only method/url/status are ever emitted — never the token or request headers.
      await ctx.emit('log', { message: `HTTP ${method} ${url} -> ${response.status}`, status: response.status });

      if (!response.ok) {
        const status = `HTTP ${response.status} ${response.statusText ?? ''}`.trim();
        const snippet = text.slice(0, MAX_ERROR_SNIPPET).trim();
        return { status: 'failed', error: snippet ? `${status}: ${snippet}` : status };
      }
      return { status: 'completed', output: { status: response.status, body: data } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'failed', error: `http request failed: ${message}` };
    }
  }
}

/** Parse a response body as JSON, falling back to the raw text (or undefined). */
function parseResponse(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
