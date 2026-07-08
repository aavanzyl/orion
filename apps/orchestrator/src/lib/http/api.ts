import { Router, type Request, type Response } from 'express';
import type { ApiResponse, RunStatus } from '@orion/models';
import {
  ConfigError,
  getWorkflowTemplate,
  listWorkflowTemplates,
  renderWorkflowTemplateYaml,
  toWorkflowTemplateSummary,
  installSkillFromGitHub,
  listGlobalSkillCatalog,
  getGlobalSkillDetail,
  updateSkillLockEntry,
  uninstallSkill,
  syncSkill,
} from '@orion/config';
import type { Container } from '../container.js';
import { ProjectService } from '../services/project.service.js';
import { RunService } from '../services/run.service.js';
import { ChatService } from '../services/chat.service.js';
import { TriggerService, TriggerNotFoundError, type TriggerFireResult } from '../services/trigger.service.js';
import { FilesystemService } from '../services/filesystem.service.js';
import { encrypt, decrypt } from '../crypto.js';

function parseSkillTags(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tags = raw.filter((t: unknown): t is string => typeof t === 'string').map((t: string) => t.trim()).filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

function ok<T>(res: Response, data: T, status = 200): void {
  const body: ApiResponse<T> = { data, success: true };
  res.status(status).json(body);
}

/** Shape a trigger fire result for HTTP: a run id for workflows, text for agents. */
function fireResponse(result: TriggerFireResult): Record<string, unknown> {
  return result.kind === 'agent'
    ? { agentResponse: result.agentResponse }
    : { runId: result.run.id };
}

function fail(res: Response, error: string, status = 400): void {
  const body: ApiResponse<null> = { data: null, success: false, error };
  res.status(status).json(body);
}

function encryptApiKey(apiKey: string, salt?: string): string {
  if (!apiKey) return '';
  if (salt) return encrypt(apiKey, salt);
  return apiKey;
}

function decryptApiKey(encrypted: string, salt?: string): string {
  if (!encrypted) return '';
  if (salt) return decrypt(encrypted, salt);
  return encrypted;
}

function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => void {
  return (req, res) => {
    handler(req, res).catch((err: unknown) => {
      fail(res, err instanceof Error ? err.message : String(err), 500);
    });
  };
}

export function createApiRouter(
  c: Container,
  runs: RunService,
  chat: ChatService,
  triggers: TriggerService,
): Router {
  const router = Router();
  const projects = new ProjectService(c);
  const filesystem = new FilesystemService(c);

  // Global skills service (project-independent, stored under ~/.orion/skills/)
  const skills = {
    listGlobal: () => listGlobalSkillCatalog(),
    getGlobalDetail: (name: string) => getGlobalSkillDetail(name),
    installGlobal: (input: Record<string, unknown>) =>
      installSkillFromGitHub({ ...input, repoDir: '', scope: 'global', token: c.env.githubToken, configPath: '.orion/config.yaml' } as Parameters<typeof installSkillFromGitHub>[0]),
    updateGlobal: (name: string, updates: { tags?: string[]; syncEnabled?: boolean }) =>
      updateSkillLockEntry('', name, updates, '.orion/config.yaml', 'global'),
    syncGlobal: (name: string) =>
      syncSkill('', name, '.orion/config.yaml', 'global', c.env.githubToken),
    uninstallGlobal: (name: string) =>
      uninstallSkill('', name, '.orion/config.yaml', 'global'),
  };

  router.get(
    '/fs/dirs',
    asyncHandler(async (req, res) => {
      const path = typeof req.query.path === 'string' ? req.query.path : '';
      ok(res, await filesystem.browse(path));
    }),
  );

  // --- Workflow templates: the built-in catalog of ready-made workflows ------

  router.get(
    '/workflows/templates',
    asyncHandler(async (_req, res) =>
      ok(res, listWorkflowTemplates().map(toWorkflowTemplateSummary)),
    ),
  );

  router.get(
    '/workflows/templates/:name',
    asyncHandler(async (req, res) => {
      const template = getWorkflowTemplate(req.params.name);
      if (!template) return fail(res, 'Workflow template not found', 404);
      ok(res, {
        ...template,
        yaml: renderWorkflowTemplateYaml(template),
        suggestedSwimlanes: template.suggestedSwimlanes ?? [],
      });
    }),
  );

  // --- Providers: the configurable AI provider + model catalog ---------------

  router.get(
    '/providers',
    asyncHandler(async (_req, res) => ok(res, await c.providers.list())),
  );

  router.post(
    '/providers',
    asyncHandler(async (req, res) => {
      const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
      if (!key) return fail(res, 'key is required');
      const harness = typeof req.body?.harness === 'string' ? req.body.harness.trim() : undefined;
      const models = Array.isArray(req.body?.models)
        ? req.body.models.filter((m: unknown): m is string => typeof m === 'string')
        : [];
      const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : undefined;
      ok(
        res,
        await c.providers.create({
          key,
          label: typeof req.body?.label === 'string' ? req.body.label : '',
          harness,
          baseUrl: typeof req.body?.baseUrl === 'string' ? req.body.baseUrl : undefined,
          models,
          apiKey: apiKey ? encryptApiKey(apiKey, c.env.providerEncryptionSalt) : undefined,
        }),
        201,
      );
    }),
  );

  router.patch(
    '/providers/:id',
    asyncHandler(async (req, res) => {
      const existing = await c.providers.get(req.params.id);
      if (!existing) return fail(res, 'Provider not found', 404);
      const input: Record<string, unknown> = { ...(req.body ?? {}) };
      if (typeof input.apiKey === 'string') {
        input.apiKey = input.apiKey.trim()
          ? encryptApiKey(input.apiKey as string, c.env.providerEncryptionSalt)
          : null;
      }
      const updated = await c.providers.update(req.params.id, input);
      if (!updated) return fail(res, 'Provider not found', 404);
      ok(res, updated);
    }),
  );

  router.delete(
    '/providers/:id',
    asyncHandler(async (req, res) => {
      const existing = await c.providers.get(req.params.id);
      if (!existing) return fail(res, 'Provider not found', 404);
      await c.providers.delete(req.params.id);
      ok(res, { deleted: true });
    }),
  );

  /** Internal: returns the decrypted provider API key for harness use. */
  router.get(
    '/providers/:id/api-key',
    asyncHandler(async (req, res) => {
      const existing = await c.providers.get(req.params.id);
      if (!existing) return fail(res, 'Provider not found', 404);
      const raw = await c.providers.getApiKey(req.params.id);
      ok(res, { apiKey: raw ? decryptApiKey(raw, c.env.providerEncryptionSalt) : null });
    }),
  );

  // --- Command templates: the markdown instruction files under .orion/ -------

  router.get(
    '/projects/:id/commands',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      ok(res, { files: await projects.listCommandFiles(project) });
    }),
  );

  router.get(
    '/projects/:id/command',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      const path = typeof req.query.path === 'string' ? req.query.path : '';
      if (!path) return fail(res, 'path is required');
      try {
        const content = await projects.readCommandFile(project, path);
        ok(res, { content, path });
      } catch (err) {
        if (err instanceof ConfigError) return fail(res, err.message, 422);
        throw err;
      }
    }),
  );

  router.put(
    '/projects/:id/command',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      const path = typeof req.body?.path === 'string' ? req.body.path : '';
      if (!path) return fail(res, 'path is required');
      if (typeof req.body?.content !== 'string') return fail(res, 'content is required');
      try {
        await projects.saveCommandFile(project, path, req.body.content);
        ok(res, { path });
      } catch (err) {
        if (err instanceof ConfigError) return fail(res, err.message, 422);
        throw err;
      }
    }),
  );

  // --- Skills: the catalog of reusable instruction bundles for agents --------

  // Global skills (no project required) — installed to ~/.orion/skills/

  router.get(
    '/skills',
    asyncHandler(async (_req, res) => {
      ok(res, { skills: await skills.listGlobal() });
    }),
  );

  router.get(
    '/skills/:name',
    asyncHandler(async (req, res) => {
      const detail = await skills.getGlobalDetail(req.params.name);
      if (!detail) return fail(res, 'Skill not found', 404);
      ok(res, detail);
    }),
  );

  router.post(
    '/skills',
    asyncHandler(async (req, res) => {
      const source = typeof req.body?.source === 'string' ? req.body.source.trim() : '';
      const skillPath = typeof req.body?.skillPath === 'string' ? req.body.skillPath.trim() : '';
      if (!source) return fail(res, 'source is required (full GitHub URL)');
      if (!skillPath) return fail(res, 'skillPath is required');
      try {
        const tags = parseSkillTags(req.body?.tags);
        const result = await skills.installGlobal({
          source,
          skillPath,
          ref: typeof req.body?.ref === 'string' ? req.body.ref : undefined,
          ...(tags?.length ? { tags } : {}),
          scope: 'global',
        });
        ok(res, result, 201);
      } catch (err) {
        if (err instanceof ConfigError) return fail(res, err.message, 422);
        throw err;
      }
    }),
  );

  router.put(
    '/skills/:name',
    asyncHandler(async (req, res) => {
      try {
        const updated = await skills.updateGlobal(req.params.name, {
          tags: parseSkillTags(req.body?.tags),
          syncEnabled: typeof req.body?.syncEnabled === 'boolean' ? req.body.syncEnabled : undefined,
        });
        if (!updated) return fail(res, 'Skill not found', 404);
        ok(res, updated);
      } catch (err) {
        if (err instanceof ConfigError) return fail(res, err.message, 422);
        throw err;
      }
    }),
  );

  router.post(
    '/skills/:name/sync',
    asyncHandler(async (req, res) => {
      try {
        const result = await skills.syncGlobal(req.params.name);
        ok(res, result);
      } catch (err) {
        if (err instanceof ConfigError) return fail(res, err.message, 422);
        throw err;
      }
    }),
  );

  router.delete(
    '/skills/:name',
    asyncHandler(async (req, res) => {
      const removed = await skills.uninstallGlobal(req.params.name);
      if (!removed) return fail(res, 'Skill not found', 404);
      ok(res, { deleted: true });
    }),
  );

  // Project-scoped skills

  router.get(
    '/projects/:id/skills',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      ok(res, { skills: await projects.listSkills(project) });
    }),
  );

  router.get(
    '/projects/:id/skills/:name/references',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      ok(res, { references: await projects.getSkillReferences(project, req.params.name) });
    }),
  );

  router.get(
    '/projects/:id/skills/:name',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      const detail = await projects.getSkill(project, req.params.name);
      if (!detail) return fail(res, 'Skill not found', 404);
      ok(res, detail);
    }),
  );

  router.post(
    '/projects/:id/skills/:name/sync',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      try {
        const result = await projects.syncSkill(project, req.params.name);
        ok(res, result);
      } catch (err) {
        if (err instanceof ConfigError) return fail(res, err.message, 422);
        throw err;
      }
    }),
  );

  router.post(
    '/projects/:id/skills',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      const source = typeof req.body?.source === 'string' ? req.body.source.trim() : '';
      const skillPath = typeof req.body?.skillPath === 'string' ? req.body.skillPath.trim() : '';
      if (!source) return fail(res, 'source is required (full GitHub URL)');
      if (!skillPath) return fail(res, 'skillPath is required');
      try {
        const tags = parseSkillTags(req.body?.tags);
        const result = await projects.installSkill(project, {
          source,
          skillPath,
          ref: typeof req.body?.ref === 'string' ? req.body.ref : undefined,
          ...(tags?.length ? { tags } : {}),
          scope: 'project',
        });
        ok(res, result, 201);
      } catch (err) {
        if (err instanceof ConfigError) return fail(res, err.message, 422);
        throw err;
      }
    }),
  );

  router.put(
    '/projects/:id/skills/:name',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      try {
        const updated = await projects.updateSkill(project, req.params.name, {
          tags: parseSkillTags(req.body?.tags),
          syncEnabled: typeof req.body?.syncEnabled === 'boolean' ? req.body.syncEnabled : undefined,
        });
        if (!updated) return fail(res, 'Skill not found', 404);
        ok(res, updated);
      } catch (err) {
        if (err instanceof ConfigError) return fail(res, err.message, 422);
        throw err;
      }
    }),
  );

  router.delete(
    '/projects/:id/skills/:name',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      const removed = await projects.uninstallSkill(project, req.params.name);
      if (!removed) return fail(res, 'Skill not found', 404);
      ok(res, { deleted: true });
    }),
  );

  router.get(
    '/projects',
    asyncHandler(async (_req, res) => ok(res, await projects.list())),
  );

  router.post(
    '/projects',
    asyncHandler(async (req, res) => {
      const { name, sourceKind = 'remote', repoUrl, rootPath } = req.body ?? {};
      if (!name) return fail(res, 'name is required');
      if (sourceKind === 'remote' && !repoUrl) {
        return fail(res, 'repoUrl is required for remote projects');
      }
      if (sourceKind !== 'remote' && !rootPath) {
        return fail(res, 'rootPath is required for local/workspace projects');
      }
      // Local and workspace sources are handled by the git-based SCM adapter.
      const scmProvider = req.body.scmProvider ?? 'github';
      ok(res, await projects.create({ ...req.body, sourceKind, scmProvider }), 201);
    }),
  );

  router.get(
    '/projects/:id',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      ok(res, project);
    }),
  );

  router.patch(
    '/projects/:id',
    asyncHandler(async (req, res) => {
      const existing = await projects.get(req.params.id);
      if (!existing) return fail(res, 'Project not found', 404);
      const updated = await projects.update(req.params.id, req.body ?? {});
      if (!updated) return fail(res, 'Project not found', 404);
      ok(res, updated);
    }),
  );

  router.delete(
    '/projects/:id',
    asyncHandler(async (req, res) => {
      const existing = await projects.get(req.params.id);
      if (!existing) return fail(res, 'Project not found', 404);
      await projects.delete(req.params.id);
      ok(res, { deleted: true });
    }),
  );

  router.get(
    '/projects/:id/config',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      const config = await projects.loadConfig(project);
      ok(res, {
        board: config.board,
        workflow: config.workflow,
        workflows: Object.keys(config.workflows ?? {}),
      });
    }),
  );

  router.get(
    '/projects/:id/config/raw',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      const content = await projects.readConfigText(project);
      ok(res, { content, configPath: project.configPath });
    }),
  );

  router.put(
    '/projects/:id/config/raw',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      if (typeof req.body?.content !== 'string') {
        return fail(res, 'content is required');
      }
      try {
        const config = await projects.saveConfigText(project, req.body.content);
        ok(res, {
          board: config.board,
          workflow: config.workflow,
          workflows: Object.keys(config.workflows ?? {}),
        });
      } catch (err) {
        if (err instanceof ConfigError) return fail(res, err.message, 422);
        throw err;
      }
    }),
  );

  router.get(
    '/projects/:id/board',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      ok(res, await projects.getBoard(project));
    }),
  );

  // Encrypt a workflow secret (e.g. an `http` node bearer token) with the server
  // salt so it can be stored at rest in `.orion/config.yaml` and decrypted only
  // in-process at run time. Returns the value unchanged when no salt is set.
  router.post(
    '/config/encrypt-secret',
    asyncHandler(async (req, res) => {
      const value = req.body?.value;
      if (typeof value !== 'string' || value.length === 0) {
        return fail(res, 'value is required');
      }
      const salt = c.env.providerEncryptionSalt;
      ok(res, { value: salt ? encrypt(value, salt) : value, encrypted: Boolean(salt) });
    }),
  );

  // --- Codebase index (RAG): embeddings-backed code search ------------------

  router.get(
    '/projects/:id/index',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      ok(res, await c.ragService.getStatus(req.params.id));
    }),
  );

  router.post(
    '/projects/:id/index',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      ok(res, await c.ragService.reindex(req.params.id), 202);
    }),
  );

  router.post(
    '/projects/:id/search',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
      if (!query) return fail(res, 'query is required');
      const topK =
        typeof req.body?.topK === 'number' && req.body.topK > 0 ? Math.floor(req.body.topK) : 8;
      ok(res, await c.ragService.search(req.params.id, query, topK));
    }),
  );

  router.post(
    '/projects/:id/tickets',
    asyncHandler(async (req, res) => {
      const board = c.boards.get('native');
      const ticket = await board.createTicket({
        projectId: req.params.id,
        title: req.body?.title,
        description: req.body?.description,
        swimlane: req.body?.swimlane,
        agentId: req.body?.agentId,
        priority: req.body?.priority,
        parentId: req.body?.parentId,
        labelIds: req.body?.labelIds,
        relations: req.body?.relations,
      });
      ok(res, ticket, 201);
    }),
  );

  router.get(
    '/projects/:id/labels',
    asyncHandler(async (req, res) => {
      const board = c.boards.get('native');
      ok(res, await board.listLabels(req.params.id));
    }),
  );

  router.post(
    '/projects/:id/labels',
    asyncHandler(async (req, res) => {
      if (!req.body?.name) return fail(res, 'name is required');
      const board = c.boards.get('native');
      ok(
        res,
        await board.createLabel({
          projectId: req.params.id,
          name: req.body.name,
          color: req.body?.color,
        }),
        201,
      );
    }),
  );

  router.delete(
    '/labels/:id',
    asyncHandler(async (req, res) => {
      const board = c.boards.get('native');
      await board.deleteLabel(req.params.id);
      ok(res, { deleted: true });
    }),
  );

  router.get(
    '/tickets',
    asyncHandler(async (_req, res) => {
      ok(res, await c.tickets.listAll());
    }),
  );

  router.get(
    '/labels',
    asyncHandler(async (_req, res) => {
      ok(res, await c.labels.listAll());
    }),
  );

  router.get(
    '/tickets/:id/detail',
    asyncHandler(async (req, res) => {
      const board = c.boards.get('native');
      const detail = await board.getTicketDetail(req.params.id);
      if (!detail) return fail(res, 'Ticket not found', 404);
      ok(res, detail);
    }),
  );

  router.patch(
    '/tickets/:id',
    asyncHandler(async (req, res) => {
      const board = c.boards.get('native');
      ok(res, await board.updateTicket(req.params.id, req.body ?? {}));
    }),
  );

  router.post(
    '/tickets/:id/relations',
    asyncHandler(async (req, res) => {
      if (!req.body?.kind || !req.body?.ticketId) {
        return fail(res, 'kind and ticketId are required');
      }
      const board = c.boards.get('native');
      ok(
        res,
        await board.addRelation(req.params.id, {
          kind: req.body.kind,
          ticketId: req.body.ticketId,
        }),
        201,
      );
    }),
  );

  router.delete(
    '/ticket-relations/:relationId',
    asyncHandler(async (req, res) => {
      const board = c.boards.get('native');
      await board.removeRelation(req.params.relationId);
      ok(res, { deleted: true });
    }),
  );

  router.post(
    '/tickets/:id/move',
    asyncHandler(async (req, res) => {
      const board = c.boards.get('native');
      const result = await board.moveTicket({
        ticketId: req.params.id,
        swimlane: req.body?.swimlane,
        order: req.body?.order,
      });
      c.linearSync.pushTicketState(req.params.id).catch(() => undefined);
      if (req.body?.swimlane) {
        void runs.handleSwimlaneEntry(req.params.id, req.body.swimlane);
      }
      ok(res, result);
    }),
  );

  router.post(
    '/tickets/:id/agent',
    asyncHandler(async (req, res) => {
      const board = c.boards.get('native');
      ok(res, await board.updateTicketAgent(req.params.id, req.body?.agentId ?? null));
    }),
  );

  router.post(
    '/tickets/:id/run',
    asyncHandler(async (req, res) => ok(res, await runs.start(req.params.id), 201)),
  );

  router.get(
    '/tickets/:id/runs',
    asyncHandler(async (req, res) => ok(res, await runs.listRunsForTicket(req.params.id))),
  );

  router.get(
    '/runs/:id',
    asyncHandler(async (req, res) => {
      const run = await runs.getRun(req.params.id);
      if (!run) return fail(res, 'Run not found', 404);
      ok(res, { run, nodes: await runs.listNodes(req.params.id) });
    }),
  );

  router.get(
    '/runs/:id/events',
    asyncHandler(async (req, res) => ok(res, await runs.listEvents(req.params.id))),
  );

  router.post(
    '/runs/:id/approve',
    asyncHandler(async (req, res) => {
      if (!req.body?.nodeKey) return fail(res, 'nodeKey is required');
      ok(res, await runs.approve(req.params.id, req.body.nodeKey));
    }),
  );

  router.post(
    '/runs/:id/cancel',
    asyncHandler(async (req, res) => {
      await runs.cancel(req.params.id);
      ok(res, { cancelled: true });
    }),
  );

  router.post(
    '/runs/:id/retry',
    asyncHandler(async (req, res) => ok(res, await runs.retry(req.params.id), 201)),
  );

  router.get('/runs/:id/stream', (req: Request, res: Response) => {
    void streamRun(c, runs, req, res);
  });

  // --- Runs list (dashboard) --------------------------------------------------

  router.get(
    '/runs',
    asyncHandler(async (req, res) => {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      const status = typeof req.query.status === 'string' ? (req.query.status as RunStatus) : undefined;
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
      ok(res, await c.runs.list({ projectId, status, from, to, search, limit }));
    }),
  );

  // --- Analytics ---------------------------------------------------------------

  router.get(
    '/analytics',
    asyncHandler(async (req, res) => {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      const days = typeof req.query.days === 'string' ? parseInt(req.query.days, 10) : 30;
      ok(res, await c.runs.analytics({ projectId, days }));
    }),
  );

  // --- Evaluations: quality feedback that drives agent improvement ------------

  router.get(
    '/evaluations/summary',
    asyncHandler(async (req, res) => {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      const days = typeof req.query.days === 'string' ? parseInt(req.query.days, 10) : undefined;
      ok(res, await c.evaluations.summary({ projectId, days }));
    }),
  );

  router.get(
    '/projects/:id/evaluations',
    asyncHandler(async (req, res) => {
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
      ok(res, await c.evaluations.list({ projectId: req.params.id, limit }));
    }),
  );

  router.get(
    '/runs/:id/evaluations',
    asyncHandler(async (req, res) => ok(res, await c.evaluations.list({ runId: req.params.id }))),
  );

  router.post(
    '/runs/:id/evaluations',
    asyncHandler(async (req, res) => {
      const run = await runs.getRun(req.params.id);
      if (!run) return fail(res, 'Run not found', 404);
      const rating = req.body?.rating;
      if (rating !== 'positive' && rating !== 'negative' && rating !== 'neutral') {
        return fail(res, 'rating must be one of positive, negative, neutral');
      }
      const score = typeof req.body?.score === 'number' ? req.body.score : undefined;
      if (score !== undefined && (score < 0 || score > 1)) {
        return fail(res, 'score must be between 0 and 1');
      }
      const evaluation = await c.evaluations.create({
        runId: run.id,
        projectId: run.projectId,
        nodeId: typeof req.body?.nodeId === 'string' ? req.body.nodeId : undefined,
        rating,
        score,
        evaluator: typeof req.body?.evaluator === 'string' ? req.body.evaluator : 'human',
        labels: Array.isArray(req.body?.labels) ? req.body.labels : undefined,
        comment: typeof req.body?.comment === 'string' ? req.body.comment : undefined,
        metadata: req.body?.metadata,
      });
      ok(res, evaluation, 201);
    }),
  );

  router.patch(
    '/evaluations/:id',
    asyncHandler(async (req, res) => {
      const existing = await c.evaluations.get(req.params.id);
      if (!existing) return fail(res, 'Evaluation not found', 404);
      const rating = req.body?.rating;
      if (
        rating !== undefined &&
        rating !== 'positive' &&
        rating !== 'negative' &&
        rating !== 'neutral'
      ) {
        return fail(res, 'rating must be one of positive, negative, neutral');
      }
      ok(
        res,
        await c.evaluations.update(req.params.id, {
          rating,
          score: typeof req.body?.score === 'number' ? req.body.score : undefined,
          labels: Array.isArray(req.body?.labels) ? req.body.labels : undefined,
          comment: typeof req.body?.comment === 'string' ? req.body.comment : undefined,
          metadata: req.body?.metadata,
        }),
      );
    }),
  );

  router.delete(
    '/evaluations/:id',
    asyncHandler(async (req, res) => {
      const deleted = await c.evaluations.delete(req.params.id);
      if (!deleted) return fail(res, 'Evaluation not found', 404);
      ok(res, { deleted });
    }),
  );

  // --- Board SSE stream -------------------------------------------------------

  router.get('/projects/:id/board/stream', (req: Request, res: Response) => {
    void streamBoard(c, req, res);
  });

  // --- Chat: direct conversations with the configured coding agent -----------

  router.get(
    '/projects/:id/conversations',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      ok(res, await chat.listConversations(req.params.id));
    }),
  );

  router.post(
    '/projects/:id/conversations',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
      ok(res, await chat.createConversation(req.params.id, title), 201);
    }),
  );

  router.get(
    '/conversations/:id',
    asyncHandler(async (req, res) => {
      const detail = await chat.getConversation(req.params.id);
      if (!detail) return fail(res, 'Conversation not found', 404);
      ok(res, detail);
    }),
  );

  router.post(
    '/conversations/:id/messages',
    asyncHandler(async (req, res) => {
      const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
      if (!content) return fail(res, 'content is required');
      try {
        ok(res, await chat.sendMessage(req.params.id, content), 202);
      } catch (err) {
        return fail(res, err instanceof Error ? err.message : String(err), 404);
      }
    }),
  );

  router.get('/conversations/:id/stream', (req: Request, res: Response) => {
    void streamChat(c, chat, req, res);
  });

  router.post(
    '/projects/:id/route',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!message) return fail(res, 'message is required');
      ok(res, await chat.route(req.params.id, message));
    }),
  );

  // --- Triggers: schedules + inbound webhooks that auto-start workflow runs --

  router.get(
    '/projects/:id/triggers',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      ok(res, await triggers.list(req.params.id));
    }),
  );

  router.post(
    '/projects/:id/triggers',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name) return fail(res, 'name is required');
      const type = req.body?.type === 'webhook' ? 'webhook' : 'cron';
      const action = req.body?.action === 'agent' ? 'agent' : 'workflow';
      try {
        const created = await triggers.create({
          projectId: req.params.id,
          name,
          type,
          action,
          enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
          cron: typeof req.body?.cron === 'string' ? req.body.cron : undefined,
          ticketTitle: typeof req.body?.ticketTitle === 'string' ? req.body.ticketTitle : undefined,
          ticketDescription:
            typeof req.body?.ticketDescription === 'string' ? req.body.ticketDescription : undefined,
          swimlane: typeof req.body?.swimlane === 'string' ? req.body.swimlane : undefined,
          agentId: typeof req.body?.agentId === 'string' ? req.body.agentId : undefined,
          prompt: typeof req.body?.prompt === 'string' ? req.body.prompt : undefined,
        });
        ok(res, created, 201);
      } catch (err) {
        return fail(res, err instanceof Error ? err.message : String(err), 422);
      }
    }),
  );

  router.patch(
    '/triggers/:id',
    asyncHandler(async (req, res) => {
      const existing = await triggers.get(req.params.id);
      if (!existing) return fail(res, 'Trigger not found', 404);
      try {
        const updated = await triggers.update(req.params.id, req.body ?? {});
        if (!updated) return fail(res, 'Trigger not found', 404);
        ok(res, updated);
      } catch (err) {
        return fail(res, err instanceof Error ? err.message : String(err), 422);
      }
    }),
  );

  router.delete(
    '/triggers/:id',
    asyncHandler(async (req, res) => {
      const existing = await triggers.get(req.params.id);
      if (!existing) return fail(res, 'Trigger not found', 404);
      await triggers.delete(req.params.id);
      ok(res, { deleted: true });
    }),
  );

  router.post(
    '/triggers/:id/fire',
    asyncHandler(async (req, res) => {
      const trigger = await triggers.get(req.params.id);
      if (!trigger) return fail(res, 'Trigger not found', 404);
      ok(res, fireResponse(await triggers.fire(trigger, req.body ?? {})), 201);
    }),
  );

  router.post(
    '/webhooks/triggers/:token',
    asyncHandler(async (req, res) => {
      try {
        const result = await triggers.fireByWebhookToken(req.params.token, req.body ?? {});
        ok(res, fireResponse(result), 202);
      } catch (err) {
        if (err instanceof TriggerNotFoundError) return fail(res, err.message, 404);
        throw err;
      }
    }),
  );

  // --- Linear board sync ----------------------------------------------------

  router.get(
    '/projects/:id/board-connection',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      const conn = await c.linearSync.getConnection(req.params.id);
      if (!conn) return ok(res, { connected: false });
      ok(res, {
        connected: true,
        provider: conn.provider,
        teamId: conn.teamId,
        enabled: conn.enabled,
        stateMap: conn.stateMap,
        lastSyncedAt: conn.lastSyncedAt,
      });
    }),
  );

  router.put(
    '/projects/:id/board-connection',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      try {
        const conn = await c.linearSync.upsertConnection(req.params.id, {
          apiKey: typeof req.body?.apiKey === 'string' ? req.body.apiKey : undefined,
          teamId: typeof req.body?.teamId === 'string' ? req.body.teamId : undefined,
          stateMap: req.body?.stateMap ?? undefined,
          enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
        });
        ok(res, conn);
      } catch (err) {
        fail(res, err instanceof Error ? err.message : String(err), 422);
      }
    }),
  );

  router.delete(
    '/projects/:id/board-connection',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      await c.linearSync.disconnect(req.params.id);
      ok(res, { deleted: true });
    }),
  );

  router.post(
    '/projects/:id/board-connection/sync',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      try {
        const summary = await c.linearSync.syncNow(req.params.id);
        ok(res, summary);
      } catch (err) {
        fail(res, err instanceof Error ? err.message : String(err), 422);
      }
    }),
  );

  router.get(
    '/projects/:id/board-connection/teams',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      const apiKey =
        typeof req.query.apiKey === 'string'
          ? req.query.apiKey
          : (await c.linearSync.getConnection(req.params.id))?.apiKey;
      if (!apiKey) return fail(res, 'apiKey is required', 400);
      try {
        ok(res, await c.linearSync.listTeams(apiKey));
      } catch (err) {
        fail(res, err instanceof Error ? err.message : String(err), 422);
      }
    }),
  );

  router.get(
    '/projects/:id/board-connection/states',
    asyncHandler(async (req, res) => {
      const project = await projects.get(req.params.id);
      if (!project) return fail(res, 'Project not found', 404);
      const conn = await c.linearSync.getConnection(req.params.id);
      const apiKey =
        typeof req.query.apiKey === 'string'
          ? req.query.apiKey
          : conn?.apiKey;
      const teamId =
        typeof req.query.teamId === 'string'
          ? req.query.teamId
          : conn?.teamId;
      if (!apiKey) return fail(res, 'apiKey is required', 400);
      if (!teamId) return fail(res, 'teamId is required', 400);
      try {
        ok(res, await c.linearSync.listStates(apiKey, teamId));
      } catch (err) {
        fail(res, err instanceof Error ? err.message : String(err), 422);
      }
    }),
  );

  return router;
}

/** Server-Sent Events stream: replays past events then follows live ones. */
async function streamRun(
  c: Container,
  runs: RunService,
  req: Request,
  res: Response,
): Promise<void> {
  const runId = req.params.id;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('retry: 3000\n\n');

  const send = (event: { id: string; type: string }, payload: unknown) => {
    res.write(`id: ${event.id}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const past = await runs.listEvents(runId);
  for (const event of past) {
    send(event, event);
  }

  const unsubscribe = c.bus.subscribe(runId, (event) => send(event, event));
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

/**
 * Server-Sent Events stream for a conversation: replays persisted messages as
 * `message` events then follows live chat events. Mirrors {@link streamRun}.
 */
async function streamChat(
  c: Container,
  chat: ChatService,
  req: Request,
  res: Response,
): Promise<void> {
  const conversationId = req.params.id;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('retry: 3000\n\n');

  const send = (event: { id: string; type: string }, payload: unknown) => {
    res.write(`id: ${event.id}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const detail = await chat.getConversation(conversationId);
  if (detail) {
    for (const message of detail.messages) {
      send(
        { id: message.id, type: 'message' },
        {
          id: message.id,
          type: 'message',
          conversationId,
          message,
          createdAt: message.createdAt,
        },
      );
    }
  }

  const unsubscribe = c.chatBus.subscribe(conversationId, (event) => send(event, event));
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

/**
 * Server-Sent Events stream for board updates. Subscribes to a project-scoped
 * channel and sends `ticket.updated` events whenever a ticket column changes.
 */
async function streamBoard(
  c: Container,
  req: Request,
  res: Response,
): Promise<void> {
  const projectId = req.params.id;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('retry: 3000\n\n');

  const send = (event: string, payload: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const channel = `board:${projectId}`;
  const unsubscribe = c.bus.on(channel, (payload) => send('ticket.updated', payload));
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
