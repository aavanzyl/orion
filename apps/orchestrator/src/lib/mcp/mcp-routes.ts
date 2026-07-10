import type { Express, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { TicketPriority } from '@orion/models';
import type { Container } from '../container.js';

/** Wrap any structured payload as a single MCP text content block. */
function text(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

/** An error result the calling agent can read and recover from. */
function errText(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

const priority = z.number().int().min(0).max(4);
const projectIdArg = z
  .string()
  .optional()
  .describe('Target project id. Optional if a default project is bound to the connection; call list_projects to discover ids.');

/**
 * Resolve the project to act on: an explicit tool argument wins, otherwise the
 * default bound to the connection (used when Orion injects the server into its
 * own runs). Returns `null` when neither is available.
 */
function resolveProjectId(arg: string | undefined, fallback: string | undefined): string | null {
  return arg ?? fallback ?? null;
}

const NO_PROJECT =
  'No project selected. Pass a "projectId" argument, or call list_projects to discover available project ids.';

/**
 * Codebase MCP — semantic code search over a project's embeddings index. Made
 * available to both external agents and Orion's own running agents. When Orion
 * injects it into a run, `defaultProjectId` binds the connection to that project
 * so tools work without an explicit id.
 */
function buildCodebaseServer(c: Container, defaultProjectId?: string): McpServer {
  const server = new McpServer({ name: 'orion-codebase', version: '1.0.0' });

  server.registerTool(
    'list_projects',
    {
      description: 'List the projects Orion manages (id, name) so you can pick one to search.',
      inputSchema: {},
    },
    async () => text((await c.projects.list()).map((p) => ({ id: p.id, name: p.name }))),
  );

  server.registerTool(
    'search_code',
    {
      description: "Semantic search over a project's codebase index; returns the most relevant file chunks.",
      inputSchema: {
        query: z.string().describe('Natural-language or code search query'),
        topK: z.number().int().positive().max(20).optional().describe('Maximum results (default 8)'),
        projectId: projectIdArg,
      },
    },
    async ({ query, topK, projectId }) => {
      const id = resolveProjectId(projectId, defaultProjectId);
      if (!id) return errText(NO_PROJECT);
      return text(await c.ragService.search(id, query, topK ?? 8));
    },
  );

  server.registerTool(
    'index_status',
    {
      description: "Report the status of a project's codebase index (provider, counts, freshness).",
      inputSchema: { projectId: projectIdArg },
    },
    async ({ projectId }) => {
      const id = resolveProjectId(projectId, defaultProjectId);
      if (!id) return errText(NO_PROJECT);
      return text(await c.ragService.getStatus(id));
    },
  );

  return server;
}

/**
 * Tickets MCP — read/write access to a project's native board. Intended for
 * external agents; also handed to one-off agent triggers so they can file work.
 */
function buildTicketsServer(c: Container, defaultProjectId?: string): McpServer {
  const server = new McpServer({ name: 'orion-tickets', version: '1.0.0' });
  const board = c.boards.get('native');

  server.registerTool(
    'list_projects',
    {
      description: 'List the projects Orion manages (id, name) so you can pick one to work on.',
      inputSchema: {},
    },
    async () => text((await c.projects.list()).map((p) => ({ id: p.id, name: p.name }))),
  );

  server.registerTool(
    'list_tickets',
    {
      description: 'List a project\'s tickets, optionally filtered to a single board column.',
      inputSchema: {
        swimlane: z.string().optional().describe('Board swimlane key to filter by'),
        projectId: projectIdArg,
      },
    },
    async ({ swimlane, projectId }) => {
      const id = resolveProjectId(projectId, defaultProjectId);
      if (!id) return errText(NO_PROJECT);
      const tickets = await c.tickets.listByProject(id);
      return text(swimlane ? tickets.filter((t) => t.swimlane === swimlane) : tickets);
    },
  );

  server.registerTool(
    'get_ticket',
    {
      description: 'Fetch a single ticket with its labels, parent, sub-issues and relations.',
      inputSchema: { ticketId: z.string() },
    },
    async ({ ticketId }) => text(await board.getTicketDetail(ticketId)),
  );

  server.registerTool(
    'create_ticket',
    {
      description: 'Create a ticket on a project board.',
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        swimlane: z.string().optional(),
        priority: priority.optional(),
        agentId: z.string().optional(),
        labelIds: z.array(z.string()).optional(),
        parentId: z.string().optional(),
        projectId: projectIdArg,
      },
    },
    async (args) => {
      const id = resolveProjectId(args.projectId, defaultProjectId);
      if (!id) return errText(NO_PROJECT);
      return text(
        await board.createTicket({
          projectId: id,
          title: args.title,
          description: args.description,
          swimlane: args.swimlane,
          priority: args.priority as TicketPriority | undefined,
          agentId: args.agentId,
          labelIds: args.labelIds,
          parentId: args.parentId,
        }),
      );
    },
  );

  server.registerTool(
    'update_ticket',
    {
      description: 'Update a ticket\'s title, description, column or priority.',
      inputSchema: {
        ticketId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        swimlane: z.string().optional(),
        priority: priority.optional(),
      },
    },
    async ({ ticketId, title, description, swimlane, priority: p }) =>
      text(
        await board.updateTicket(ticketId, {
          title,
          description,
          swimlane,
          priority: p as TicketPriority | undefined,
        }),
      ),
  );

  server.registerTool(
    'move_ticket',
    {
      description: 'Move a ticket to a different board column (and optionally set its order).',
      inputSchema: {
        ticketId: z.string(),
        swimlane: z.string(),
        order: z.number().int().optional(),
      },
    },
    async ({ ticketId, swimlane, order }) => {
      const result = await board.moveTicket({ ticketId, swimlane, order });
      c.boardSync.pushTicketState(ticketId).catch(() => undefined);
      return text(result);
    },
  );

  server.registerTool(
    'list_labels',
    {
      description: 'List the labels defined for a project.',
      inputSchema: { projectId: projectIdArg },
    },
    async ({ projectId }) => {
      const id = resolveProjectId(projectId, defaultProjectId);
      if (!id) return errText(NO_PROJECT);
      return text(await board.listLabels(id));
    },
  );

  return server;
}

/**
 * Register a generic MCP server over SSE. A `GET /mcp/<kind>` opens the event
 * stream; the client then POSTs JSON-RPC to `/mcp/<kind>/messages?sessionId=...`.
 * An optional `?projectId=` on the stream binds the connection to a project so
 * Orion's own runs work without passing an id; external clients omit it and use
 * `list_projects` + a per-tool `projectId`. One transport is kept per session.
 */
function mountSseServer(
  app: Express,
  kind: string,
  build: (defaultProjectId?: string) => McpServer,
): void {
  const transports = new Map<string, SSEServerTransport>();

  app.get(`/mcp/${kind}`, (req: Request, res: Response) => {
    const defaultProjectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const transport = new SSEServerTransport(`/mcp/${kind}/messages`, res);
    transports.set(transport.sessionId, transport);
    res.on('close', () => {
      transports.delete(transport.sessionId);
    });
    build(defaultProjectId)
      .connect(transport)
      .catch((err: unknown) => {
        transports.delete(transport.sessionId);
        console.error(`[ orion orchestrator ] MCP ${kind} connect failed:`, err);
      });
  });

  app.post(`/mcp/${kind}/messages`, (req: Request, res: Response) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(400).json({ error: 'No active MCP session for sessionId' });
      return;
    }
    transport.handlePostMessage(req, res, req.body).catch((err: unknown) => {
      console.error(`[ orion orchestrator ] MCP ${kind} message failed:`, err);
    });
  });
}

/** Mount the codebase and tickets MCP servers onto the orchestrator app. */
export function mountMcpRoutes(app: Express, c: Container): void {
  mountSseServer(app, 'codebase', (defaultProjectId) => buildCodebaseServer(c, defaultProjectId));
  mountSseServer(app, 'tickets', (defaultProjectId) => buildTicketsServer(c, defaultProjectId));
}
