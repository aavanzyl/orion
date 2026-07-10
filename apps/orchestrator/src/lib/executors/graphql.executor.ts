import { renderTemplate } from '@orion/config';
import type { NodeExecutor, NodeExecutionContext, NodeOutcome } from '@orion/workflow-engine';
import { decrypt } from '../crypto.js';

export interface GraphqlExecutorOptions {
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
 * Executes a `graphql` node: POSTs a GraphQL query/mutation to an endpoint and
 * captures the response for downstream data-flow. GraphQL errors reported in the
 * response body fail the node even on a 200 response.
 *
 * Security: a bearer `token` is decrypted in-process and only ever placed in the
 * outgoing `Authorization` header. It is NEVER logged, emitted, or returned.
 */
export class GraphqlNodeExecutor implements NodeExecutor {
  readonly type = 'graphql' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly decryptToken: (ciphertext: string, salt: string) => string;

  constructor(private readonly options: GraphqlExecutorOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.decryptToken = options.decryptToken ?? decrypt;
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeOutcome> {
    const cfg = ctx.nodeConfig;
    if (!cfg.url) {
      return { status: 'failed', error: 'graphql node has no url' };
    }
    if (!cfg.query) {
      return { status: 'failed', error: 'graphql node has no query' };
    }
    if (typeof this.fetchImpl !== 'function') {
      return { status: 'failed', error: 'no fetch implementation available' };
    }

    const url = renderTemplate(cfg.url, {}, ctx.nodeOutputs);
    const query = renderTemplate(cfg.query, {}, ctx.nodeOutputs);

    let variables: unknown;
    if (cfg.variables) {
      const rendered = renderTemplate(cfg.variables, {}, ctx.nodeOutputs).trim();
      if (rendered) {
        try {
          variables = JSON.parse(rendered);
        } catch (err) {
          return {
            status: 'failed',
            error: `graphql variables are not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    for (const [key, value] of Object.entries(cfg.headers ?? {})) {
      headers[key] = renderTemplate(value, {}, ctx.nodeOutputs);
    }

    if (cfg.token) {
      const salt = this.options.encryptionSalt;
      const token = salt ? this.decryptToken(cfg.token, salt) : cfg.token;
      headers.Authorization = `Bearer ${token}`;
    }

    const body = JSON.stringify(variables !== undefined ? { query, variables } : { query });

    try {
      const response = await this.fetchImpl(url, { method: 'POST', headers, body, signal: ctx.signal });
      const text = await response.text();

      await ctx.emit('log', {
        message: `GraphQL ${url} -> ${response.status}`,
        status: response.status,
      });

      if (!response.ok) {
        const status = `HTTP ${response.status} ${response.statusText ?? ''}`.trim();
        const snippet = text.slice(0, MAX_ERROR_SNIPPET).trim();
        return { status: 'failed', error: snippet ? `${status}: ${snippet}` : status };
      }

      let parsed: { data?: unknown; errors?: unknown };
      try {
        parsed = JSON.parse(text) as { data?: unknown; errors?: unknown };
      } catch {
        return { status: 'failed', error: 'graphql response was not valid JSON' };
      }

      if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
        const snippet = JSON.stringify(parsed.errors).slice(0, MAX_ERROR_SNIPPET);
        return { status: 'failed', error: `graphql errors: ${snippet}` };
      }

      return { status: 'completed', output: { status: response.status, data: parsed.data } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'failed', error: `graphql request failed: ${message}` };
    }
  }
}
