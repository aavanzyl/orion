import type { Express, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { CommentAttachment, TicketPriority } from '@orion/models';
import {
  createSkill,
  updateSkillContent,
  getSkillDetail,
  listSkillCatalog,
  findSkillReferences,
  uninstallSkill,
  loadProjectConfig,
  resolveIssueTypes,
} from '@orion/config';
import type { Container } from '../container.js';
import { WorkspaceService } from '../services/workspace.service.js';

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
 * When a connection is `locked` to a project, tool-supplied `projectId`
 * arguments are ignored and the bound project always wins. Used by Orion's own
 * chat/run injections so an agent cannot reach across into another project.
 */
function projectResolver(defaultProjectId: string | undefined, locked: boolean) {
  return (arg: string | undefined): string | null =>
    locked && defaultProjectId ? defaultProjectId : resolveProjectId(arg, defaultProjectId);
}

/** Projects visible to `list_projects`: only the bound one when locked. */
async function listVisibleProjects(
  c: Container,
  defaultProjectId: string | undefined,
  locked: boolean,
): Promise<Array<{ id: string; name: string }>> {
  const all = await c.projects.list();
  const visible = locked && defaultProjectId ? all.filter((p) => p.id === defaultProjectId) : all;
  return visible.map((p) => ({ id: p.id, name: p.name }));
}

/**
 * Codebase MCP — semantic code search over a project's embeddings index. Made
 * available to both external agents and Orion's own running agents. When Orion
 * injects it into a run, `defaultProjectId` binds the connection to that project
 * so tools work without an explicit id. When `locked`, that binding is enforced.
 */
function buildCodebaseServer(c: Container, defaultProjectId?: string, locked = false): McpServer {
  const server = new McpServer({ name: 'orion-codebase', version: '1.0.0' });
  const resolve = projectResolver(defaultProjectId, locked);

  server.registerTool(
    'list_projects',
    {
      description: 'List the projects Orion manages (id, name) so you can pick one to search.',
      inputSchema: {},
    },
    async () => text(await listVisibleProjects(c, defaultProjectId, locked)),
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
      const id = resolve(projectId);
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
      const id = resolve(projectId);
      if (!id) return errText(NO_PROJECT);
      return text(await c.ragService.getStatus(id));
    },
  );

  return server;
}

/**
 * Tickets MCP — read/write access to a project's native board, labels,
 * ticket relations, and comments. Epics are managed as tickets with type="epic"
 * — use create_ticket/update_ticket for epics, and list_tickets with type="epic"
 * to find them. Intended for external agents; also handed to one-off agent
 * triggers so they can file work.
 */
function buildTicketsServer(c: Container, defaultProjectId?: string, locked = false): McpServer {
  const server = new McpServer({ name: 'orion-tickets', version: '1.0.0' });
  const board = c.boards.get('native');
  const resolve = projectResolver(defaultProjectId, locked);

  const ticketTypeEnum = z
    .enum(['feature', 'bug', 'issue', 'hotfix', 'epic'])
    .describe('Issue type: feature, bug, issue, hotfix, or epic');

  /** Lazy cache of project swimlane keys so we don't reload config on every call. */
  const swimlaneCache = new Map<string, Set<string>>();
  async function getSwimlaneKeys(projectId: string): Promise<Set<string>> {
    const cached = swimlaneCache.get(projectId);
    if (cached) return cached;
    const project = await c.projects.get(projectId);
    if (!project) return new Set();
    const ws = new WorkspaceService(c);
    const configRoot = await ws.resolveConfigRoot(project);
    const config = await loadProjectConfig(configRoot, project.configPath);
    const keys = new Set(config.board.swimlanes);
    swimlaneCache.set(projectId, keys);
    return keys;
  }

  /**
   * Validate that referenced entities exist before a mutation. Returns an
   * error message string when validation fails, or `null` when everything
   * checks out.
   */
  async function validateMutate(
    projectId: string,
    opts: {
      swimlane?: string;
      epicId?: string | null;
      parentId?: string | null;
      labelIds?: string[];
      ticketId?: string;
    },
  ): Promise<string | null> {
    if (opts.swimlane) {
      const keys = await getSwimlaneKeys(projectId);
      if (keys.size > 0 && !keys.has(opts.swimlane)) {
        return `Invalid swimlane "${opts.swimlane}". Valid keys: ${[...keys].join(', ')}`;
      }
    }

    if (opts.epicId) {
      const epic = await c.tickets.get(opts.epicId);
      if (!epic) return `Epic "${opts.epicId}" not found`;
      if (epic.type !== 'epic') return `Ticket "${opts.epicId}" is not an epic (type: ${epic.type})`;
    }

    if (opts.parentId) {
      const parent = await c.tickets.get(opts.parentId);
      if (!parent) return `Parent ticket "${opts.parentId}" not found`;
    }

    if (opts.labelIds && opts.labelIds.length > 0) {
      const existing = await board.listLabels(projectId);
      const existingIds = new Set(existing.map((l) => l.id));
      const missing = opts.labelIds.filter((lid) => !existingIds.has(lid));
      if (missing.length > 0) return `Unknown label ids: ${missing.join(', ')}`;
    }

    if (opts.ticketId) {
      const ticket = await c.tickets.get(opts.ticketId);
      if (!ticket) return `Ticket "${opts.ticketId}" not found`;
    }

    return null;
  }

  /** Resolve or create labels by name for a project. Returns label ids. */
  async function resolveLabelNames(projectId: string, names: string[]): Promise<string[]> {
    const existing = await board.listLabels(projectId);
    const nameMap = new Map(existing.map((l) => [l.name.toLowerCase(), l.id]));
    const ids: string[] = [];
    for (const name of names) {
      const key = name.trim().toLowerCase();
      if (!key) continue;
      if (nameMap.has(key)) {
        ids.push(nameMap.get(key)!);
      } else {
        const created = await board.createLabel({ projectId, name: name.trim() });
        ids.push(created.id);
      }
    }
    return ids;
  }

  /** Convert base64 image data to a data-URI attachment. */
  function imageToAttachment(name: string, data: string): CommentAttachment {
    const ext = name.split('.').pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
    };
    const mime = mimeMap[ext ?? ''] ?? 'image/png';
    const url = data.startsWith('data:') ? data : `data:${mime};base64,${data}`;
    return { name, url, type: mime };
  }

  // ── discovery ────────────────────────────────────────────────

  server.registerTool(
    'list_projects',
    {
      description: 'List the projects Orion manages (id, name) so you can pick one to work on.',
      inputSchema: {},
    },
    async () => text(await listVisibleProjects(c, defaultProjectId, locked)),
  );

  server.registerTool(
    'search_tickets',
    {
      description: 'Semantic search over project tickets; returns the most relevant tickets for a natural-language query.',
      inputSchema: {
        query: z.string().describe('Natural-language search query to find matching tickets'),
        topK: z.number().int().positive().max(20).optional().describe('Maximum results (default 8)'),
        projectId: projectIdArg,
      },
    },
    async ({ query, topK, projectId }) => {
      const id = resolve(projectId);
      if (!id) return errText(NO_PROJECT);
      return text(await c.ragService.searchTickets(id, query, topK ?? 8));
    },
  );

  server.registerTool(
    'list_swimlanes',
    {
      description:
        'Get the project\'s swimlane keys, titles, and available issue types. Use this to discover valid swimlane values for create_ticket, update_ticket, and list_tickets.',
      inputSchema: { projectId: projectIdArg },
    },
    async ({ projectId }) => {
      const id = resolve(projectId);
      if (!id) return errText(NO_PROJECT);
      const project = await c.projects.get(id);
      if (!project) return errText('Project not found');
      const ws = new WorkspaceService(c);
      const configRoot = await ws.resolveConfigRoot(project);
      const config = await loadProjectConfig(configRoot, project.configPath);
      const swimlanes = config.board.swimlanes.map((key) => ({
        key,
        title: key
          .split(/[_\-\s]+/)
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' '),
      }));
      const issueTypes = resolveIssueTypes(config);
      return text({ swimlanes, issueTypes });
    },
  );

  // ── tickets ──────────────────────────────────────────────────

  server.registerTool(
    'list_tickets',
    {
      description:
        'List a project\'s tickets, optionally filtered by swimlane, type, priority, or epic. Set type to "epic" to list only epics.',
      inputSchema: {
        swimlane: z.string().optional().describe('Board swimlane key to filter by'),
        type: ticketTypeEnum.optional().describe('Only return tickets of this type. Use "epic" to list epics.'),
        priority: priority.optional().describe('Only return tickets with this priority level'),
        epicId: z.string().optional().describe('Only return tickets belonging to this epic'),
        projectId: projectIdArg,
      },
    },
    async ({ swimlane, type, priority: p, epicId, projectId }) => {
      const id = resolve(projectId);
      if (!id) return errText(NO_PROJECT);
      let tickets = await c.tickets.listByProject(id);
      if (swimlane) tickets = tickets.filter((t) => t.swimlane === swimlane);
      if (type) tickets = tickets.filter((t) => t.type === type);
      if (p !== undefined) tickets = tickets.filter((t) => t.priority === p);
      if (epicId) tickets = tickets.filter((t) => t.epicId === epicId);
      return text(tickets);
    },
  );

  server.registerTool(
    'get_ticket',
    {
      description: 'Fetch a single ticket with its labels, parent, sub-issues, relations, and epic tickets.',
      inputSchema: { ticketId: z.string().describe('The ticket id returned from list_tickets or create_ticket') },
    },
    async ({ ticketId }) => text(await board.getTicketDetail(ticketId)),
  );

  server.registerTool(
    'create_ticket',
    {
      description:
        'Create a ticket on a project board. Set type to "epic" to create an epic. Use labelNames to auto-create labels by name. Epics and tickets are the same entity — epics are simply tickets with type="epic".',
      inputSchema: {
        title: z.string().describe('Ticket title'),
        description: z.string().optional().describe('Markdown body'),
        swimlane: z.string().optional().describe('Board swimlane key (defaults to backlog)'),
        priority: priority.optional(),
        agentId: z.string().optional().describe('Agent id to assign'),
        labelIds: z.array(z.string()).optional().describe('Label ids from manage_labels'),
        labelNames: z.array(z.string()).optional().describe('Label names to auto-create and attach (case-insensitive)'),
        parentId: z.string().optional().describe('Parent ticket id for sub-tickets'),
        type: ticketTypeEnum.optional().describe('Defaults to feature. Set to "epic" to create an epic.'),
        epicId: z.string().optional().describe('Epic id (ticket with type="epic") to assign this ticket to'),
        startDate: z.string().optional().describe('Optional start date (YYYY-MM-DD)'),
        dueDate: z.string().optional().describe('Optional due date (YYYY-MM-DD)'),
        workflowName: z.string().optional().describe('Workflow name to bind this ticket to'),
        relations: z
          .array(
            z.object({
              kind: z.enum(['blocks', 'blocked_by', 'related']).describe('Relation kind'),
              ticketId: z.string().describe('Target ticket id'),
            }),
          )
          .optional()
          .describe('Relations to create with other tickets'),
        projectId: projectIdArg,
      },
    },
    async (args) => {
      const id = resolve(args.projectId);
      if (!id) return errText(NO_PROJECT);

      let labelIds = args.labelIds ?? [];
      if (args.labelNames && args.labelNames.length > 0) {
        const nameIds = await resolveLabelNames(id, args.labelNames);
        labelIds = [...new Set([...labelIds, ...nameIds])];
      }

      const error = await validateMutate(id, {
        swimlane: args.swimlane,
        epicId: args.epicId,
        parentId: args.parentId,
        labelIds,
      });
      if (error) return errText(error);

      const ticket = await board.createTicket({
        projectId: id,
        title: args.title,
        description: args.description,
        swimlane: args.swimlane,
        priority: args.priority as TicketPriority | undefined,
        agentId: args.agentId,
        labelIds,
        parentId: args.parentId,
        type: args.type,
        epicId: args.epicId,
        startDate: args.startDate,
        dueDate: args.dueDate,
        workflowName: args.workflowName,
      });

      if (args.relations) {
        for (const rel of args.relations) {
          await board.addRelation(ticket.id, rel).catch(() => undefined);
        }
      }

      return text(ticket);
    },
  );

  server.registerTool(
    'update_ticket',
    {
      description:
        'Update a ticket\'s fields. Pass only the fields you want to change. Set a field to null to clear it (parentId, agentId, dates, epicId). Use swimlane to move the ticket between columns, and relations to add/remove ticket relations.',
      inputSchema: {
        ticketId: z.string().describe('The ticket id to update'),
        title: z.string().optional(),
        description: z.string().optional(),
        swimlane: z.string().optional().describe('Target swimlane key (also moves the ticket)'),
        order: z.number().int().optional().describe('Position within the swimlane after moving'),
        priority: priority.optional(),
        type: ticketTypeEnum.optional(),
        parentId: z.string().nullable().optional().describe('Set to null to un-parent'),
        labelIds: z.array(z.string()).optional().describe('Full replacement list of label ids'),
        labelNames: z.array(z.string()).optional().describe('Label names to auto-create and attach (added to existing labels)'),
        agentId: z.string().nullable().optional().describe('Set to null to unassign'),
        startDate: z.string().nullable().optional().describe('YYYY-MM-DD, or null to clear'),
        dueDate: z.string().nullable().optional().describe('YYYY-MM-DD, or null to clear'),
        epicId: z.string().nullable().optional().describe('Set to null to remove from epic'),
        relations: z
          .object({
            add: z
              .array(
                z.object({
                  kind: z.enum(['blocks', 'blocked_by', 'related']).describe('Relation kind'),
                  ticketId: z.string().describe('Target ticket id'),
                }),
              )
              .optional()
              .describe('Relations to create'),
            remove: z.array(z.string()).optional().describe('Relation ids to remove (from get_ticket relations)'),
          })
          .optional()
          .describe('Manage ticket relations'),
      },
    },
    async ({ ticketId, title, description, swimlane, order, priority: p, type, parentId, labelIds, labelNames, agentId, startDate, dueDate, epicId, relations }) => {
      const ticket = await c.tickets.get(ticketId);
      if (!ticket) return errText(`Ticket "${ticketId}" not found`);

      let resolvedLabelIds = labelIds;
      if (labelNames && labelNames.length > 0) {
        const nameIds = await resolveLabelNames(ticket.projectId, labelNames);
        const existing = labelIds ?? ticket.labelIds;
        resolvedLabelIds = [...new Set([...existing, ...nameIds])];
      }

      const error = await validateMutate(ticket.projectId, {
        swimlane,
        epicId,
        parentId,
        labelIds: resolvedLabelIds,
      });
      if (error) return errText(error);

      if (swimlane || order !== undefined) {
        await board.moveTicket({ ticketId, swimlane: swimlane ?? ticket.swimlane, order });
        c.boardSync.pushTicketState(ticketId).catch(() => undefined);
      }

      const updated = await board.updateTicket(ticketId, {
        title,
        description,
        swimlane,
        priority: p as TicketPriority | undefined,
        type,
        parentId,
        labelIds: resolvedLabelIds,
        agentId,
        startDate,
        dueDate,
        epicId,
      });

      if (relations?.remove) {
        for (const relId of relations.remove) {
          await board.removeRelation(relId).catch(() => undefined);
        }
      }
      if (relations?.add) {
        for (const rel of relations.add) {
          await board.addRelation(ticketId, rel).catch(() => undefined);
        }
      }

      return text(updated);
    },
  );

  server.registerTool(
    'delete_ticket',
    {
      description: 'Permanently delete a ticket. Use with caution.',
      inputSchema: {
        ticketId: z.string().describe('The ticket id to delete'),
      },
    },
    async ({ ticketId }) => {
      const deleted = await board.deleteTicket(ticketId);
      return deleted ? text({ deleted: true, ticketId }) : errText(`Ticket "${ticketId}" not found`);
    },
  );

  // ── labels ───────────────────────────────────────────────────

  server.registerTool(
    'manage_labels',
    {
      description:
        'Manage project labels in one tool. Use action "list" to see all labels, "create" to add a new label (returns id), or "delete" to remove a label by id.',
      inputSchema: {
        action: z.enum(['list', 'create', 'delete']).describe('Operation: list, create, or delete labels'),
        name: z.string().optional().describe('Label name (required for create)'),
        color: z.string().optional().describe('Hex color for create, e.g. "#ff0000". Defaults to "#6366f1".'),
        labelId: z.string().optional().describe('Label id (required for delete)'),
        projectId: projectIdArg,
      },
    },
    async ({ action, name, color, labelId, projectId }) => {
      if (action === 'list') {
        const id = resolve(projectId);
        if (!id) return errText(NO_PROJECT);
        return text(await board.listLabels(id));
      }
      if (action === 'create') {
        const id = resolve(projectId);
        if (!id) return errText(NO_PROJECT);
        if (!name) return errText('name is required for create');
        return text(await board.createLabel({ projectId: id, name, color }));
      }
      if (action === 'delete') {
        if (!labelId) return errText('labelId is required for delete');
        await board.deleteLabel(labelId);
        return text({ deleted: true, labelId });
      }
      return errText(`Unknown action: ${action}`);
    },
  );

  // ── comments ─────────────────────────────────────────────────

  server.registerTool(
    'add_comment',
    {
      description:
        'Add a comment to a ticket, optionally with image attachments. Images should be base64-encoded data (omit the "data:image/..." prefix — the mime type is inferred from the filename extension).',
      inputSchema: {
        ticketId: z.string().describe('The ticket id to comment on'),
        body: z.string().describe('Markdown comment body'),
        images: z
          .array(
            z.object({
              name: z.string().describe('Filename with extension, e.g. "screenshot.png"'),
              data: z.string().describe('Base64-encoded image data (without the data URI prefix)'),
            }),
          )
          .optional()
          .describe('Optional image attachments'),
      },
    },
    async ({ ticketId, body, images }) => {
      const ticket = await c.tickets.get(ticketId);
      if (!ticket) return errText(`Ticket "${ticketId}" not found`);
      const attachments: CommentAttachment[] = (images ?? []).map((img) => imageToAttachment(img.name, img.data));
      return text(await c.comments.create(ticketId, body, attachments));
    },
  );

  server.registerTool(
    'list_comments',
    {
      description: 'List all comments on a ticket, including any image attachments.',
      inputSchema: {
        ticketId: z.string().describe('The ticket id to list comments for'),
      },
    },
    async ({ ticketId }) => {
      const ticket = await c.tickets.get(ticketId);
      if (!ticket) return errText(`Ticket "${ticketId}" not found`);
      return text(await c.comments.listByTicket(ticketId));
    },
  );

  return server;
}

/**
 * Skills MCP — create, read, update, and delete Orion skills in a project's
 * `.agents/skills/` directory. The chat agent uses these tools when the user
 * asks to create or modify a skill.
 */
function buildSkillsServer(c: Container, defaultProjectId?: string, locked = false): McpServer {
  const server = new McpServer({ name: 'orion-skills', version: '1.0.0' });
  const resolve = projectResolver(defaultProjectId, locked);
  const workspaces = new WorkspaceService(c);

  async function resolveSkillRoot(projectId: string): Promise<string> {
    const project = await c.projects.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    return workspaces.resolveSkillRoot(project);
  }

  async function resolveConfigRoot(projectId: string): Promise<string> {
    const project = await c.projects.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    return workspaces.resolveConfigRoot(project);
  }

  server.registerTool(
    'list_projects',
    {
      description: 'List the projects Orion manages (id, name) so you can pick one to work on.',
      inputSchema: {},
    },
    async () => text(await listVisibleProjects(c, defaultProjectId, locked)),
  );

  server.registerTool(
    'list_skills',
    {
      description: "List all skills in a project's catalog (built-ins, global, and project-installed).",
      inputSchema: { projectId: projectIdArg },
    },
    async ({ projectId }) => {
      const id = resolve(projectId);
      if (!id) return errText(NO_PROJECT);
      const repoRoot = await resolveSkillRoot(id);
      const skills = await listSkillCatalog(repoRoot);
      return text(skills);
    },
  );

  server.registerTool(
    'get_skill',
    {
      description: "Get a skill's full SKILL.md content, frontmatter, and metadata.",
      inputSchema: {
        name: z.string().describe('The skill name'),
        projectId: projectIdArg,
      },
    },
    async ({ name, projectId }) => {
      const id = resolve(projectId);
      if (!id) return errText(NO_PROJECT);
      const repoRoot = await resolveSkillRoot(id);
      const detail = await getSkillDetail(repoRoot, name);
      if (!detail) return errText(`Skill "${name}" not found`);
      return text(detail);
    },
  );

  server.registerTool(
    'create_skill',
    {
      description: 'Create a new local skill in the project. Provide a name, a short description, and the Markdown body content (instructions for the agent).',
      inputSchema: {
        name: z.string().describe('A unique kebab-case name for the skill, e.g. "my-code-review"'),
        description: z.string().describe('A one-line description of what this skill does'),
        content: z.string().describe('The Markdown body of SKILL.md — instructions the agent will follow'),
        projectId: projectIdArg,
      },
    },
    async ({ name, description, content, projectId }) => {
      const id = resolve(projectId);
      if (!id) return errText(NO_PROJECT);
      const repoRoot = await resolveSkillRoot(id);
      await createSkill(repoRoot, name, description, content, undefined, 'project');
      return text({ created: true, name, description });
    },
  );

  server.registerTool(
    'update_skill',
    {
      description: "Update a local skill's body content. Optionally rename it or change its description.",
      inputSchema: {
        name: z.string().describe('The current skill name'),
        content: z.string().describe('The new Markdown body for SKILL.md'),
        newName: z.string().optional().describe('Optional new name to rename the skill'),
        newDescription: z.string().optional().describe('Optional new description'),
        projectId: projectIdArg,
      },
    },
    async ({ name, content, newName, newDescription, projectId }) => {
      const id = resolve(projectId);
      if (!id) return errText(NO_PROJECT);
      const repoRoot = await resolveSkillRoot(id);
      await updateSkillContent(repoRoot, name, content, undefined, 'project', newName, newDescription);
      return text({ updated: true, name: newName ?? name });
    },
  );

  server.registerTool(
    'delete_skill',
    {
      description: 'Delete a local skill from the project, including its files. Use with caution.',
      inputSchema: {
        name: z.string().describe('The skill name to delete'),
        projectId: projectIdArg,
      },
    },
    async ({ name, projectId }) => {
      const id = resolve(projectId);
      if (!id) return errText(NO_PROJECT);
      const repoRoot = await resolveSkillRoot(id);
      const configRoot = await resolveConfigRoot(id);
      const project = await c.projects.get(id);
      if (!project) return errText('Project not found');
      const references = await findSkillReferences(configRoot, name, project.configPath);
      if (references.length > 0) {
        return errText(
          `Skill "${name}" is referenced by ${references.length} workflow node(s): ${
            references.map((r) => `${r.workflowName}:${r.nodeId}`).join(', ')
          }. Remove the references first.`,
        );
      }
      const removed = await uninstallSkill(repoRoot, name, project.configPath, 'project');
      if (!removed) return errText(`Skill "${name}" not found`);
      return text({ deleted: true, name });
    },
  );

  return server;
}

/**
 * Register a generic MCP server over SSE. A `GET /mcp/<kind>` opens the event
 * stream; the client then POSTs JSON-RPC to `/mcp/<kind>/messages?sessionId=...`.
 * An optional `?projectId=` on the stream binds the connection to a project so
 * Orion's own runs work without passing an id; external clients omit it and use
 * `list_projects` + a per-tool `projectId`. Add `?lock=1` to forbid tool-supplied
 * project overrides entirely. One transport is kept per session.
 */
function mountSseServer(
  app: Express,
  kind: string,
  build: (defaultProjectId?: string, locked?: boolean) => McpServer,
): void {
  const transports = new Map<string, SSEServerTransport>();

  app.get(`/mcp/${kind}`, (req: Request, res: Response) => {
    const defaultProjectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const locked = req.query.lock === '1' || req.query.lock === 'true';
    const transport = new SSEServerTransport(`/mcp/${kind}/messages`, res);
    transports.set(transport.sessionId, transport);
    res.on('close', () => {
      transports.delete(transport.sessionId);
    });
    build(defaultProjectId, locked)
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

/** Mount the codebase, tickets, and skills MCP servers onto the orchestrator app. */
export function mountMcpRoutes(app: Express, c: Container): void {
  mountSseServer(app, 'codebase', (defaultProjectId, locked) =>
    buildCodebaseServer(c, defaultProjectId, locked),
  );
  mountSseServer(app, 'tickets', (defaultProjectId, locked) =>
    buildTicketsServer(c, defaultProjectId, locked),
  );
  mountSseServer(app, 'skills', (defaultProjectId, locked) =>
    buildSkillsServer(c, defaultProjectId, locked),
  );
}
