import { readFile } from 'node:fs/promises';
import { extname, basename, dirname, normalize, join } from 'node:path';
import type { CallGraph, CallGraphNode, CodeIndex, DirSummary, FileGraph, FileGraphNode, ImportEdge, NxProjectInfo, Project, ProjectId, SearchResult } from '@orion/models';
import {
  chunkFile,
  type CodeChunkInput,
  type EmbeddingProvider,
  LocalEmbeddingProvider,
  OpenAiEmbeddingProvider,
  rankBySimilarity,
  walkRepo,
} from '@orion/rag';
import type { InsertCodeChunkInput } from '@orion/db';
import type { Container } from '../container.js';
import { WorkspaceService } from './workspace.service.js';
import { parseSource } from './call-parser.js';

/** Texts embedded per provider call while indexing. */
const EMBED_BATCH = 128;

/**
 * Indexes a project's repository into embeddings and answers similarity search
 * queries. Embeddings are stored as JSON `number[]` and ranked with cosine
 * similarity in JS, so this works identically on Postgres and PGlite (no
 * pgvector). One env-derived embedding provider is used for both indexing and
 * search so the vector space stays consistent.
 */
export class RagService {
  private readonly workspaces: WorkspaceService;
  private readonly provider: EmbeddingProvider;

  constructor(private readonly c: Container) {
    this.workspaces = new WorkspaceService(c);
    this.provider = this.resolveProvider();
  }

  /** Choose the embedding provider from env: OpenAI-compatible if configured, else local. */
  private resolveProvider(): EmbeddingProvider {
    const { codexApiKey, codexBaseUrl } = this.c.env;
    if (codexApiKey && codexBaseUrl) {
      return new OpenAiEmbeddingProvider({ apiKey: codexApiKey, baseUrl: codexBaseUrl });
    }
    return new LocalEmbeddingProvider();
  }

  /** The current index status, or a default `idle` status when never indexed. */
  async getStatus(projectId: ProjectId): Promise<CodeIndex> {
    const index = await this.c.rag.getIndex(projectId);
    return index ?? this.defaultStatus(projectId);
  }

  private defaultStatus(projectId: ProjectId): CodeIndex {
    const now = new Date().toISOString();
    return {
      id: '',
      projectId,
      status: 'idle',
      provider: this.provider.id,
      dimensions: this.provider.dimensions,
      fileCount: 0,
      chunkCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Kick off a (re)index of the project's repository. Returns immediately with
   * status `indexing`; the heavy work runs in the background and updates the
   * status row to `ready` (or `error`) when finished.
   */
  async reindex(projectId: ProjectId): Promise<CodeIndex> {
    const project = await this.c.projects.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const status = await this.c.rag.upsertIndex(projectId, {
      status: 'indexing',
      provider: this.provider.id,
      dimensions: this.provider.dimensions,
      error: null,
    });

    void this.runIndex(project).catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      await this.c.rag
        .upsertIndex(projectId, { status: 'error', error: message })
        .catch(() => undefined);
    });

    return status;
  }

  private async runIndex(project: Project): Promise<void> {
    const root = await this.workspaces.resolveConfigRoot(project);
    const files = await walkRepo(root);

    const chunks: CodeChunkInput[] = [];
    for (const filePath of files) {
      let content: string;
      try {
        content = await readFile(join(root, filePath), 'utf8');
      } catch {
        continue;
      }
      chunks.push(...chunkFile(filePath, content));
    }

    const rows: InsertCodeChunkInput[] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const vectors = await this.provider.embed(batch.map((chunk) => chunk.content));
      batch.forEach((chunk, j) => {
        rows.push({
          projectId: project.id,
          filePath: chunk.filePath,
          chunkIndex: chunk.chunkIndex,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          embedding: vectors[j] ?? [],
        });
      });
    }

    await this.c.rag.clearChunks(project.id);
    await this.c.rag.insertChunks(rows);

    await this.c.rag.upsertIndex(project.id, {
      status: 'ready',
      provider: this.provider.id,
      dimensions: this.provider.dimensions,
      fileCount: files.length,
      chunkCount: rows.length,
      error: null,
      lastIndexedAt: new Date(),
    });
  }

  /**
   * Extract relative import specifiers from source code content. Matches ES
   * `import|export … from '…'`, dynamic `import('…')`, and CJS `require('…')`.
   */
  private static extractImports(content: string): string[] {
    const imports: string[] = [];
    const patterns = [
      /(?:import|export)\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    const seen = new Set<string>();
    for (const regex of patterns) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const spec = match[1];
        if (spec && spec.startsWith('.') && !seen.has(spec)) {
          seen.add(spec);
          imports.push(spec);
        }
      }
    }
    return imports;
  }

  /** Try common extensions on a bare import path to find a matching file. */
  private static resolveImport(
    importSpec: string,
    fromFile: string,
    knownFiles: Set<string>,
  ): string | null {
    const candidates = [
      importSpec,
      `${importSpec}.ts`,
      `${importSpec}.tsx`,
      `${importSpec}.js`,
      `${importSpec}.jsx`,
      `${importSpec}.mjs`,
      `${importSpec}.cjs`,
      `${importSpec}/index.ts`,
      `${importSpec}/index.tsx`,
      `${importSpec}/index.js`,
      `${importSpec}/index.jsx`,
    ];
    for (const candidate of candidates) {
      const resolved = normalize(join(dirname(fromFile), candidate));
      if (knownFiles.has(resolved)) return resolved;
    }
    return null;
  }

  /**
   * List directories present in the project's indexed files (max 2 levels deep).
   */
  async listDirs(projectId: ProjectId): Promise<DirSummary[]> {
    const index = await this.c.rag.getIndex(projectId);
    if (!index || index.status !== 'ready') return [];

    const dirs = await this.c.rag.listDirectories(projectId);
    const filtered = dirs.filter((d) => {
      if (d.dirPath === '.') return true;
      const depth = d.dirPath.split('/').length;
      return depth <= 2;
    });

    const subdirSet = new Map<string, boolean>();
    for (const d of filtered) {
      if (d.dirPath === '.') continue;
      const parent = dirname(d.dirPath) || '.';
      subdirSet.set(parent, true);
    }

    return filtered.map((d) => ({
      path: d.dirPath,
      fileCount: d.fileCount,
      chunkCount: 0,
      hasSubdirs: subdirSet.has(d.dirPath) ?? false,
    }));
  }

  /**
   * Detect NX projects by scanning indexed package.json files for `nx.projectType`.
   * Returns an empty array if the workspace is not an NX workspace (no nx.json).
   */
  private async detectNxProjects(
    projectId: ProjectId,
    knownFiles: Set<string>,
  ): Promise<NxProjectInfo[]> {
    if (!knownFiles.has('nx.json')) return [];

    const projects: NxProjectInfo[] = [];
    const pkgFiles = Array.from(knownFiles).filter(
      (f) => f.endsWith('package.json') && f !== 'package.json',
    );

    for (const pkgPath of pkgFiles) {
      const content = await this.readIndexedFile(projectId, pkgPath);
      if (!content) continue;
      try {
        const pkg = JSON.parse(content) as Record<string, unknown>;
        const nx = pkg.nx as Record<string, unknown> | undefined;
        const projectType = nx?.projectType as string | undefined;
        if (projectType === 'application' || projectType === 'library') {
          const root = dirname(pkgPath);
          projects.push({
            name: (pkg.name as string) ?? root,
            root,
            projectType: projectType as 'application' | 'library',
          });
        }
      } catch {
        // ignore unparseable package.json
      }
    }

    return projects;
  }

  private async readIndexedFile(projectId: ProjectId, filePath: string): Promise<string | null> {
    try {
      const chunks = await this.c.rag.listFileHeads(projectId, 20);
      const fileChunks = chunks
        .filter((c) => c.filePath === filePath)
        .sort((a, b) => a.chunkIndex - b.chunkIndex);
      return fileChunks.map((c) => c.content).join('\n');
    } catch {
      return null;
    }
  }

  /**
   * Build a codegen graph that detects NX apps/libs and creates a root node
   * for each project. Falls back to the standard flat file graph when the
   * workspace is not an NX workspace.
   */
  async getCodegenGraph(
    projectId: ProjectId,
    maxFiles = 250,
    dir?: string,
    extensions?: string,
  ): Promise<FileGraph> {
    const index = await this.c.rag.getIndex(projectId);
    if (!index || index.status !== 'ready') return { nodes: [], edges: [] };

    let files = await this.c.rag.listDistinctFiles(projectId);
    if (files.length === 0) return { nodes: [], edges: [] };

    if (dir && dir !== '.') {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      files = files.filter((f) => f.filePath.startsWith(prefix));
    }

    if (extensions) {
      const exts = new Set(extensions.split(',').map((e) => e.trim().toLowerCase()));
      files = files.filter((f) => {
        const ext = extname(f.filePath).slice(1).toLowerCase() || 'other';
        return exts.has(ext);
      });
    }

    if (files.length === 0) return { nodes: [], edges: [] };

    const knownFiles = new Set(files.map((f) => f.filePath));
    const nxProjects = await this.detectNxProjects(projectId, knownFiles);

    const heads = await this.c.rag.listFileHeads(projectId, 3);
    const byFileContent = new Map<string, string>();
    for (const chunk of heads) {
      const prev = byFileContent.get(chunk.filePath) ?? '';
      byFileContent.set(chunk.filePath, prev ? `${prev}\n${chunk.content}` : chunk.content);
    }

    const nodeMap = new Map<string, FileGraphNode>();
    for (const f of files) {
      const ext = extname(f.filePath).slice(1) || 'other';
      nodeMap.set(f.filePath, {
        path: f.filePath,
        name: basename(f.filePath),
        extension: ext,
        chunkCount: f.chunkCount,
        dirname: dirname(f.filePath) || '.',
        importCount: 0,
        importedByCount: 0,
        nodeType: 'file',
      });
    }

    const edgeSet = new Set<string>();
    const edges: ImportEdge[] = [];
    for (const [filePath, content] of byFileContent) {
      if (!content) continue;
      const rawImports = RagService.extractImports(content);
      for (const spec of rawImports) {
        const target = RagService.resolveImport(spec, filePath, knownFiles);
        if (!target || target === filePath) continue;
        const key = `${filePath}→${target}`;
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        edges.push({ source: filePath, target });
      }
    }

    const connectedSet = new Set<string>();
    for (const edge of edges) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (src) { src.importCount++; connectedSet.add(edge.source); }
      if (tgt) { tgt.importedByCount++; connectedSet.add(edge.target); }
    }

    let resultNodes = Array.from(nodeMap.values());
    const connectedOnly = true;
    if (connectedOnly) {
      resultNodes = resultNodes.filter((n) => connectedSet.has(n.path));
    }

    if (maxFiles > 0 && resultNodes.length > maxFiles) {
      resultNodes.sort((a, b) =>
        b.importCount + b.importedByCount - (a.importCount + a.importedByCount),
      );
      resultNodes = resultNodes.slice(0, maxFiles);
    }

    const MAX_EDGES = 2000;
    const nodeIdSet = new Set(resultNodes.map((n) => n.path));
    const resultEdges = edges.filter(
      (e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target),
    ).slice(0, MAX_EDGES);

    if (nxProjects.length > 0) {
      const projectNodes = nxProjects.map((p): FileGraphNode => ({
        path: p.root,
        name: p.name,
        extension: 'project',
        chunkCount: 0,
        dirname: dirname(p.root) || '.',
        importCount: 0,
        importedByCount: 0,
        nodeType: 'project_group',
        projectType: p.projectType,
        fileCount: resultNodes.filter((n) => n.path.startsWith(p.root + '/')).length,
      }));
      RagService.layoutCodegenGraph(resultNodes, projectNodes, nxProjects);
      return {
        nodes: [...projectNodes, ...resultNodes],
        edges: resultEdges,
      };
    }

    RagService.layoutNodes(resultNodes);
    return { nodes: resultNodes, edges: resultEdges };
  }

  /** Layout codegen file nodes: group by NX project, grid within each group. */
  private static layoutCodegenGraph(
    fileNodes: FileGraphNode[],
    projectNodes: FileGraphNode[],
    projects: NxProjectInfo[],
  ): void {
    const fileToProject = new Map<string, string>();
    for (const node of fileNodes) {
      for (const proj of projects) {
        if (node.path.startsWith(proj.root + '/')) {
          fileToProject.set(node.path, proj.root);
          break;
        }
      }
    }

    const groups = new Map<string, FileGraphNode[]>();
    for (const node of fileNodes) {
      const projectRoot = fileToProject.get(node.path) ?? '__ungrouped';
      const list = groups.get(projectRoot) ?? [];
      list.push(node);
      groups.set(projectRoot, list);
    }

    const sortedRoots = Array.from(groups.keys()).sort((a, b) => {
      if (a === '__ungrouped') return 1;
      if (b === '__ungrouped') return -1;
      return a.localeCompare(b);
    });

    const NW = RagService.NW;
    const NH = RagService.NH;
    const HG = RagService.HG;
    const VG = RagService.VG;
    const DG = RagService.DG;
    const OX = RagService.OX + 80;
    const HEADER_H = 60;
    const OY = RagService.OY + HEADER_H + 20;
    const FPR = RagService.FPR;

    let y = OY;
    for (const root of sortedRoots) {
      const files = groups.get(root) ?? [];
      const groupStartY = y;
      files.sort((a, b) => a.name.localeCompare(b.name));
      let idx = 0;
      for (const file of files) {
        file.x = OX + (idx % FPR) * (NW + HG);
        file.y = y + Math.floor(idx / FPR) * (NH + VG);
        idx++;
      }
      const groupEndY = y + Math.max(1, Math.ceil(files.length / FPR)) * (NH + VG);

      const projNode = projectNodes.find((p) => p.path === root);
      if (projNode) {
        projNode.x = OX;
        projNode.y = groupStartY - HEADER_H - 8;
      }

      y = groupEndY + DG;
    }
  }
  private static readonly NW = 148;
  private static readonly NH = 56;
  private static readonly HG = 10;
  private static readonly VG = 8;
  private static readonly DG = 32;
  private static readonly OX = 40;
  private static readonly OY = 30;
  private static readonly FPR = 8;

  private static layoutNodes(nodes: FileGraphNode[]): void {
    const groups = new Map<string, FileGraphNode[]>();
    for (const node of nodes) {
      const list = groups.get(node.dirname) ?? [];
      list.push(node);
      groups.set(node.dirname, list);
    }
    const sortedDirs = Array.from(groups.keys()).sort((a, b) => {
      const da = a === '.' ? 0 : a.split('/').length;
      const db = b === '.' ? 0 : b.split('/').length;
      if (da !== db) return da - db;
      return a.localeCompare(b);
    });
    let y = RagService.OY;
    for (const dir of sortedDirs) {
      const files = groups.get(dir) ?? [];
      files.sort((a, b) => a.name.localeCompare(b.name));
      let idx = 0;
      for (const file of files) {
        file.x = RagService.OX + (idx % RagService.FPR) * (RagService.NW + RagService.HG);
        file.y = y + Math.floor(idx / RagService.FPR) * (RagService.NH + RagService.VG);
        idx++;
      }
      y += Math.max(1, Math.ceil(files.length / RagService.FPR)) * (RagService.NH + RagService.VG) + RagService.DG;
    }
  }

  /**
   * Build a file-level dependency graph for the indexed project. Uses only the
   * first few chunks per file (where imports live) to keep the query fast.
   * @param maxFiles   Cap nodes returned (default 250). 0 = no limit.
   * @param connectedOnly  When true, omit files with zero imports (default true).
   * @param dir        Scope to files whose path starts with this directory prefix.
   * @param extensions Comma-separated list of extensions to include (e.g. "ts,tsx").
   */
  async getGraph(
    projectId: ProjectId,
    maxFiles = 250,
    connectedOnly = true,
    dir?: string,
    extensions?: string,
  ): Promise<FileGraph> {
    const index = await this.c.rag.getIndex(projectId);
    if (!index || index.status !== 'ready') return { nodes: [], edges: [] };

    let files = await this.c.rag.listDistinctFiles(projectId);
    if (files.length === 0) return { nodes: [], edges: [] };

    // Apply directory filter.
    if (dir && dir !== '.') {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      files = files.filter((f) => f.filePath.startsWith(prefix));
    }

    // Apply extension filter.
    if (extensions) {
      const exts = new Set(extensions.split(',').map((e) => e.trim().toLowerCase()));
      files = files.filter((f) => {
        const ext = extname(f.filePath).slice(1).toLowerCase() || 'other';
        return exts.has(ext);
      });
    }

    if (files.length === 0) return { nodes: [], edges: [] };

    const knownFiles = new Set(files.map((f) => f.filePath));

    // Only load top chunks per file — imports are at the top.
    const heads = await this.c.rag.listFileHeads(projectId, 3);
    const byFileContent = new Map<string, string>();
    for (const chunk of heads) {
      const prev = byFileContent.get(chunk.filePath) ?? '';
      byFileContent.set(chunk.filePath, prev ? `${prev}\n${chunk.content}` : chunk.content);
    }

    // Build nodes from file metadata.
    const nodeMap = new Map<string, FileGraphNode>();
    for (const f of files) {
      const ext = extname(f.filePath).slice(1) || 'other';
      nodeMap.set(f.filePath, {
        path: f.filePath,
        name: basename(f.filePath),
        extension: ext,
        chunkCount: f.chunkCount,
        dirname: dirname(f.filePath) || '.',
        importCount: 0,
        importedByCount: 0,
        nodeType: 'file',
      });
    }

    // Extract imports from top-of-file content only.
    const edgeSet = new Set<string>();
    const edges: ImportEdge[] = [];
    for (const [filePath, content] of byFileContent) {
      if (!content) continue;
      const rawImports = RagService.extractImports(content);
      for (const spec of rawImports) {
        const target = RagService.resolveImport(spec, filePath, knownFiles);
        if (!target || target === filePath) continue;
        const key = `${filePath}→${target}`;
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        edges.push({ source: filePath, target });
      }
    }

    // Update counters.
    const connectedSet = new Set<string>();
    for (const edge of edges) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (src) { src.importCount++; connectedSet.add(edge.source); }
      if (tgt) { tgt.importedByCount++; connectedSet.add(edge.target); }
    }

    let resultNodes = Array.from(nodeMap.values());
    if (connectedOnly) {
      resultNodes = resultNodes.filter((n) => connectedSet.has(n.path));
    }

    // Cap nodes.
    if (maxFiles > 0 && resultNodes.length > maxFiles) {
      resultNodes.sort((a, b) =>
        b.importCount + b.importedByCount - (a.importCount + a.importedByCount),
      );
      resultNodes = resultNodes.slice(0, maxFiles);
    }

    const nodeIdSet = new Set(resultNodes.map((n) => n.path));
    const resultEdges = edges.filter(
      (e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target),
    );

    const MAX_EDGES = 2000;
    const slicedEdges = resultEdges.length > MAX_EDGES
      ? resultEdges.slice(0, MAX_EDGES)
      : resultEdges;

    // Compute layout positions server-side.
    RagService.layoutNodes(resultNodes);

    return {
      nodes: resultNodes,
      edges: slicedEdges,
    };
  }

  /** Default code extensions for call graphs. */
  private static readonly CODE_EXTS = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  ]);

  /**
   * Mindmap / tree layout for call-graph nodes.
   * Roots go at the top, children branch downward under their parent.
   * Nodes with multiple callers are placed under the first parent encountered.
   */
  private static layoutCallNodes(
    nodes: CallGraphNode[],
    edges: { source: string; target: string }[],
  ): void {
    if (nodes.length === 0) return;

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Build tree: each node gets its first parent (BFS from roots).
    // Multiple parents → first one wins; the rest are ignored for layout.
    const children = new Map<string, string[]>();
    const parent = new Map<string, string>();
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();

    for (const n of nodes) {
      children.set(n.id, []);
      outgoing.set(n.id, []);
      incoming.set(n.id, []);
    }
    for (const e of edges) {
      outgoing.get(e.source)?.push(e.target);
      incoming.get(e.target)?.push(e.source);
    }

    // BFS from roots to build the tree.
    const queue: Array<{ id: string; depth: number }> = [];
    const visited = new Set<string>();

    // Roots: nodes with no incoming edges, or (for cycles) highest out-degree.
    const roots: string[] = [];
    for (const n of nodes) {
      if ((incoming.get(n.id)?.length ?? 0) === 0) {
        roots.push(n.id);
      }
    }
    if (roots.length === 0) {
      // All nodes have incoming edges (cycles). Pick the one with most outgoing.
      let best = nodes[0];
      for (const n of nodes) {
        if ((outgoing.get(n.id)?.length ?? 0) > (outgoing.get(best.id)?.length ?? 0)) {
          best = n;
        }
      }
      roots.push(best.id);
    }

    // Sort roots: endpoints first, then by name.
    roots.sort((a, b) => {
      const na = nodeMap.get(a);
      const nb = nodeMap.get(b);
      if (na?.type === 'endpoint' && nb?.type !== 'endpoint') return -1;
      if (nb?.type === 'endpoint' && na?.type !== 'endpoint') return 1;
      return (na?.name ?? '').localeCompare(nb?.name ?? '');
    });

    for (const root of roots) {
      queue.push({ id: root, depth: 0 });
      visited.add(root);
    }

    while (queue.length > 0) {
      const { id: current } = queue.shift()!;
      for (const target of outgoing.get(current) ?? []) {
        if (visited.has(target)) continue;
        visited.add(target);
        parent.set(target, current);
        children.get(current)?.push(target);
        queue.push({ id: target, depth: 0 });
      }
    }

    // Add unreachable nodes as roots.
    for (const n of nodes) {
      if (!visited.has(n.id)) {
        roots.push(n.id);
        visited.add(n.id);
      }
    }

    // Sort children of each node.
    for (const [, kids] of children) {
      kids.sort((a, b) => {
        const na = nodeMap.get(a);
        const nb = nodeMap.get(b);
        if (na?.type === 'endpoint' && nb?.type !== 'endpoint') return -1;
        if (nb?.type === 'endpoint' && na?.type !== 'endpoint') return 1;
        return (na?.name ?? '').localeCompare(nb?.name ?? '');
      });
    }

    // Layout constants.
    const NODE_W = 180;
    const H_GAP = 24;
    const V_GAP = 60;
    const LEAF_W = NODE_W + H_GAP;

    // Post-order: compute subtree widths.
    const subtreeW = new Map<string, number>();

    function computeWidth(id: string): number {
      const kids = children.get(id) ?? [];
      if (kids.length === 0) {
        subtreeW.set(id, LEAF_W);
        return LEAF_W;
      }
      let total = 0;
      for (const kid of kids) total += computeWidth(kid);
      subtreeW.set(id, Math.max(LEAF_W, total));
      return Math.max(LEAF_W, total);
    }

    for (const root of roots) computeWidth(root);

    // Pre-order: assign positions.
    function place(id: string, depth: number, left: number): number {
      const node = nodeMap.get(id);
      if (!node) return left;
      const sw = subtreeW.get(id) ?? LEAF_W;
      node.x = left + sw / 2 - NODE_W / 2;
      node.y = depth * V_GAP;

      const kids = children.get(id) ?? [];
      let cursor = left;
      for (const kid of kids) {
        const kidW = subtreeW.get(kid) ?? LEAF_W;
        place(kid, depth + 1, cursor);
        cursor += kidW;
      }
      return cursor;
    }

    let rootX = 0;
    for (const root of roots) {
      const sw = subtreeW.get(root) ?? LEAF_W;
      place(root, 0, rootX);
      rootX += sw + H_GAP;
    }
  }

  /**
   * Build a function-level call graph showing how code flows:
   * endpoints → functions → database calls / external HTTP calls.
   * Defaults to code files (ts/js), scopeable by directory prefix.
   */
  async getCallGraph(
    projectId: ProjectId,
    dir?: string,
    extensions?: string,
  ): Promise<CallGraph> {
    const index = await this.c.rag.getIndex(projectId);
    if (!index || index.status !== 'ready') return { nodes: [], edges: [] };

    let files = await this.c.rag.listDistinctFiles(projectId);
    if (files.length === 0) return { nodes: [], edges: [] };

    if (dir && dir !== '.') {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      files = files.filter((f) => f.filePath.startsWith(prefix));
    }

    const exts = extensions
      ? new Set(extensions.split(',').map((e) => e.trim().toLowerCase()))
      : RagService.CODE_EXTS;
    files = files.filter((f) => {
      const ext = extname(f.filePath).slice(1).toLowerCase() || 'other';
      return exts.has(ext);
    });

    if (files.length === 0) return { nodes: [], edges: [] };

    const knownFiles = new Set(files.map((f) => f.filePath));

    // Get file content from heads.
    const heads = await this.c.rag.listFileHeads(projectId, 5);
    const byFileContent = new Map<string, string>();
    for (const chunk of heads) {
      const prev = byFileContent.get(chunk.filePath) ?? '';
      byFileContent.set(chunk.filePath, prev ? `${prev}\n${chunk.content}` : chunk.content);
    }

    // Parse every file.
    const parsedByFile = new Map<string, ReturnType<typeof parseSource>>();
    const exportMap = new Map<string, string>();

    for (const f of files) {
      const content = byFileContent.get(f.filePath) ?? '';
      const parsed = parseSource(content);
      parsedByFile.set(f.filePath, parsed);
      for (const fn of parsed.functions) {
        exportMap.set(fn.name, f.filePath);
      }
    }

    const nodes: CallGraphNode[] = [];

    // Only create FUNCTION nodes. Endpoints detected via proximity to route defs.
    const fnToNodeId = new Map<string, string>(); // filePath:name → nodeId
    for (const [filePath, parsed] of parsedByFile) {
      for (const fn of parsed.functions) {
        const id = `${filePath}:${fn.name}`;
        fnToNodeId.set(`${filePath}:${fn.name}`, id);

        // Weak heuristic: function near a route definition is a handler.
        const isEndpoint = parsed.endpoints.some(
          (ep) => Math.abs(ep.line - fn.line) <= 5,
        );

        nodes.push({
          id,
          name: isEndpoint
            ? `[EP] ${fn.name}`
            : fn.name,
          filePath,
          type: isEndpoint ? 'endpoint' : 'function',
          line: fn.line,
        });
      }
    }

    // Edges: function → called function (only between known function nodes).
    const edgeSet = new Set<string>();
    for (const [filePath, parsed] of parsedByFile) {
      const fileFns = parsed.functions.sort((a, b) => a.line - b.line);

      for (let fi = 0; fi < fileFns.length; fi++) {
        const sourceFn = fileFns[fi];
        const sourceId = fnToNodeId.get(`${filePath}:${sourceFn.name}`);
        if (!sourceId) continue;

        // Calls belonging to this function: lines between this function's
        // definition and the next function's definition.
        const nextFnLine = fileFns[fi + 1]?.line ?? Infinity;

        for (const call of parsed.allCalls) {
          if (call.line < sourceFn.line || call.line >= nextFnLine) continue;

          let targetId: string | null = null;

          // Local function in same file?
          const localKey = `${filePath}:${call.target}`;
          if (fnToNodeId.has(localKey)) {
            targetId = fnToNodeId.get(localKey)!;
          }
          // Exported from another file?
          else if (exportMap.has(call.target)) {
            const targetFile = exportMap.get(call.target)!;
            targetId = fnToNodeId.get(`${targetFile}:${call.target}`) ?? null;
          }
          // Imported name from another file?
          else {
            for (const imp of parsed.imports) {
              if (imp.names.includes(call.target) || imp.defaultName === call.target) {
                const resolved = RagService.resolveImport(imp.source, filePath, knownFiles);
                if (resolved) {
                  targetId = fnToNodeId.get(`${resolved}:${call.target}`) ?? null;
                }
                break;
              }
            }
          }

          if (!targetId || targetId === sourceId) continue;
          const key = `${sourceId}→${targetId}`;
          edgeSet.add(key);
        }
      }
    }

    const edges = Array.from(edgeSet).map((key) => {
      const [source, target] = key.split('→');
      return { source, target };
    });

    // Prune isolated nodes (no edges).
    const connectedIds = new Set(edges.flatMap((e) => [e.source, e.target]));
    const resultNodes = nodes.filter((n) => connectedIds.has(n.id));

    // Cap.
    if (resultNodes.length > 500) {
      resultNodes.sort((a, b) => {
        const aOut = edges.filter((e) => e.source === a.id).length;
        const bOut = edges.filter((e) => e.source === b.id).length;
        return bOut - aOut;
      });
      resultNodes.splice(500);
    }

    const keepIds = new Set(resultNodes.map((n) => n.id));
    const resultEdges = edges.filter(
      (e) => keepIds.has(e.source) && keepIds.has(e.target),
    ).slice(0, 2000);

    RagService.layoutCallNodes(resultNodes, resultEdges);
    return { nodes: resultNodes, edges: resultEdges };
  }

  /**
   * Return the top-K chunks most similar to `query`. Returns `[]` when the
   * project has not been indexed yet.
   */
  async search(projectId: ProjectId, query: string, topK = 8): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const index = await this.c.rag.getIndex(projectId);
    if (!index || index.status !== 'ready') return [];

    const chunks = await this.c.rag.listChunks(projectId);
    if (chunks.length === 0) return [];

    const [queryVec] = await this.provider.embed([trimmed]);
    return rankBySimilarity(queryVec, chunks, topK).map(({ item, score }) => ({
      filePath: item.filePath,
      startLine: item.startLine,
      endLine: item.endLine,
      snippet: item.content,
      score,
    }));
  }
}
