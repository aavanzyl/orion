import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  KnowledgeGraph,
  GraphQueryResult,
  GraphPath,
  GodNode,
  GraphNode,
  GraphEdge,
  GraphStats,
  GraphRelation,
  GraphConfidence,
  GraphCommunity,
  ProjectId,
} from '@orion/models';
import { walkRepo } from '@orion/rag';
import type { Container } from '../container.js';
import { WorkspaceService } from './workspace.service.js';

// ---------------------------------------------------------------------------
// Try to load @orion/graph; fall back to inline implementations.
// ---------------------------------------------------------------------------

interface GraphLib {
  extractFile(filePath: string, source: string, rootDir: string): { nodes: GraphNode[]; edges: GraphEdge[] };
  buildGraph(results: Array<{ nodes: GraphNode[]; edges: GraphEdge[] }>, opts?: { maxNodes?: number; maxEdges?: number; rootDir?: string }): KnowledgeGraph;
  detectCommunities(graph: KnowledgeGraph): KnowledgeGraph;
  queryGraph(graph: KnowledgeGraph, question: string, opts?: { traversal?: 'bfs' | 'dfs'; depth?: number; maxResults?: number }): GraphQueryResult;
  findPath(graph: KnowledgeGraph, source: string, target: string): GraphPath | null;
  explainNode(graph: KnowledgeGraph, label: string): {
    node: GraphNode; outgoingEdges: GraphEdge[]; incomingEdges: GraphEdge[]; degree: number; community?: number;
  } | null;
  generateHtml(graph: KnowledgeGraph, opts?: { title?: string }): string;
}

let graphLib: GraphLib | null = null;
async function loadGraphLib(): Promise<GraphLib | null> {
  if (graphLib) return graphLib;
  try {
    const mod = await import('@orion/graph');
    graphLib = mod as GraphLib;
    return graphLib;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Inline core graph functions (matches @orion/graph implementation)
// ---------------------------------------------------------------------------

const CONFIDENCE: GraphConfidence = 'EXTRACTED';

const BUILTINS = new Set([
  'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number',
  'Boolean', 'Promise', 'Error', 'Date', 'RegExp', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'Symbol',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'eval',
  'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'fetch', 'alert', 'confirm', 'prompt',
  'null', 'undefined', 'true', 'false',
  'this', 'super',
  'require', 'module', 'exports',
  'process', '__dirname', '__filename',
  'global', 'window', 'document',
]);

const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
  'continue', 'return', 'throw', 'try', 'catch', 'finally',
  'new', 'delete', 'typeof', 'instanceof', 'void', 'in', 'of',
  'import', 'export', 'default', 'from', 'as',
  'class', 'extends', 'implements', 'interface', 'type', 'enum',
  'const', 'let', 'var', 'function',
  'public', 'private', 'protected', 'static', 'readonly', 'abstract',
  'get', 'set', 'async', 'await', 'yield',
]);

function isNoise(name: string): boolean {
  return BUILTINS.has(name) || KEYWORDS.has(name);
}

function makeId(...parts: string[]): string {
  const joined = parts.join('_').replace(/^_|_$/g, '');
  return joined
    .normalize('NFKC')
    .replace(/\W+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

function pdirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
}

function pbasename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function filestem(p: string): string {
  const name = pbasename(p);
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(0, i) : name;
}

function computeRelativePath(absolute: string, rootDir: string): string {
  const a = absolute.replace(/\\/g, '/');
  const r = rootDir.replace(/\\/g, '/');
  if (a.startsWith(r)) {
    return a.slice(r.length).replace(/^\//, '');
  }
  const aParts = a.split('/');
  const rParts = r.split('/');
  let i = 0;
  while (i < aParts.length && i < rParts.length && aParts[i] === rParts[i]) i++;
  const up = rParts.length - i;
  return [...Array(up).fill('..'), ...aParts.slice(i)].join('/');
}

function countLines(source: string, pos: number): number {
  let lines = 1;
  for (let i = 0; i < pos; i++) {
    if (source[i] === '\n') lines++;
  }
  return lines;
}

function findOpeningBrace(source: string, fromPos: number): number {
  for (let i = fromPos; i < source.length; i++) {
    if (source[i] === '{') return i;
    if (source[i] === ';') return -1;
  }
  return -1;
}

function findMatchingBrace(source: string, openPos: number): number {
  let depth = 0;
  for (let i = openPos; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return source.length;
}

function findMatchingParen(source: string, openPos: number): number {
  let depth = 0;
  for (let i = openPos; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return source.length;
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

const IMPORT_STMT_RE = /import\s+(.+?)\s+from\s+['"]([^'"]+)['"]/g;
const FUNC_DECL_RE = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
const FUNC_EXPR_RE = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function\s*\(/g;
const CLASS_RE = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/g;
const INTERFACE_RE = /(?:export\s+)?interface\s+(\w+)/g;
const TYPE_RE = /(?:export\s+)?type\s+(\w+)\s*=/g;
const METHOD_RE = /(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?(\w+)\s*\(/g;
const CALL_RE = /(\w+)\s*\(/g;
const ARROW_CANDIDATE_RE = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/gm;

// ---------------------------------------------------------------------------
// File extensions to process
// ---------------------------------------------------------------------------

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
]);

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

interface FuncRange {
  name: string;
  bodyStart: number;
  bodyEnd: number;
  declarationPos: number;
}

interface ClassInfo {
  name: string;
  extendsName?: string;
  implementsNames: string[];
  bodyStart: number;
  bodyEnd: number;
  declarationPos: number;
}

interface DeclInfo {
  name: string;
  pos: number;
}

interface ImportInfo {
  names: string[];
  specifier: string;
  resolvedPath: string;
}

interface CallSite {
  name: string;
  pos: number;
  line: number;
}

function resolveImportSpecifier(currentRelPath: string, specifier: string): string {
  if (!specifier.startsWith('.')) return '';
  const currentDir = pdirname(currentRelPath);
  const parts = currentDir ? currentDir.split('/') : [];
  for (const seg of specifier.split('/')) {
    if (seg === '..') { parts.pop(); }
    else if (seg !== '.') { parts.push(seg); }
  }
  return parts.join('/');
}

function parseImportClause(clause: string): string[] {
  const cleaned = clause.replace(/^type\s+/, '').replace(/,\s*type\s+/, ', ');
  const names: string[] = [];

  const nsMatch = /^\*\s+as\s+(\w+)$/.exec(cleaned);
  if (nsMatch) { names.push(nsMatch[1]); return names; }

  const namedBlock = /\{([^}]*)\}/.exec(cleaned);
  if (namedBlock) {
    for (const item of namedBlock[1].split(',')) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      const asParts = trimmed.split(/\s+as\s+/);
      names.push(asParts.length === 2 ? asParts[1].trim() : asParts[0].trim());
    }
  }

  const defaultMatch = /^(\w+)/.exec(cleaned);
  if (defaultMatch && cleaned[defaultMatch[1].length] !== '{') {
    names.push(defaultMatch[1]);
  }

  return names;
}

function parseImports(source: string, relPath: string): ImportInfo[] {
  const results: ImportInfo[] = [];
  let m: RegExpExecArray | null;
  IMPORT_STMT_RE.lastIndex = 0;
  while ((m = IMPORT_STMT_RE.exec(source)) !== null) {
    const clause = m[1].trim();
    const specifier = m[2];
    const names = parseImportClause(clause);
    const resolvedPath = resolveImportSpecifier(relPath, specifier);
    results.push({ names, specifier, resolvedPath });
  }
  return results;
}

function parseFuncDecls(source: string): FuncRange[] {
  const results: FuncRange[] = [];
  let m: RegExpExecArray | null;
  FUNC_DECL_RE.lastIndex = 0;
  while ((m = FUNC_DECL_RE.exec(source)) !== null) {
    const name = m[1];
    const bodyStart = findOpeningBrace(source, m.index + m[0].length);
    const bodyEnd = bodyStart >= 0 ? findMatchingBrace(source, bodyStart) : source.length;
    results.push({ name, bodyStart: bodyStart >= 0 ? bodyStart : m.index, bodyEnd, declarationPos: m.index });
  }
  return results;
}

function parseArrowFuncs(source: string): FuncRange[] {
  const results: FuncRange[] = [];
  let m: RegExpExecArray | null;
  ARROW_CANDIDATE_RE.lastIndex = 0;

  while ((m = ARROW_CANDIDATE_RE.exec(source)) !== null) {
    const name = m[1];
    const parenOpen = m.index + m[0].length - 1;
    const parenClose = findMatchingParen(source, parenOpen);

    let afterParen = parenClose + 1;
    let arrowPos = -1;
    while (afterParen < source.length - 1) {
      if (source[afterParen] === '=' && source[afterParen + 1] === '>') {
        arrowPos = afterParen;
        break;
      }
      if (source[afterParen] === '{' || source[afterParen] === ';') break;
      afterParen++;
    }

    if (arrowPos < 0) continue;

    const afterArrow = arrowPos + 2;
    const trimmed = source.slice(afterArrow).trimStart();
    const offset = source.length - trimmed.length;

    let bodyStart: number;
    let bodyEnd: number;

    if (trimmed[0] === '{') {
      bodyStart = afterArrow + (offset - afterArrow);
      bodyEnd = findMatchingBrace(source, bodyStart);
    } else {
      bodyStart = afterArrow;
      const semi = source.indexOf(';', afterArrow);
      bodyEnd = semi >= 0 ? semi : source.length;
    }

    results.push({ name, bodyStart, bodyEnd, declarationPos: m.index });
  }

  return results;
}

function parseFuncExprs(source: string): FuncRange[] {
  const results: FuncRange[] = [];
  let m: RegExpExecArray | null;
  FUNC_EXPR_RE.lastIndex = 0;
  while ((m = FUNC_EXPR_RE.exec(source)) !== null) {
    const name = m[1];
    const bodyStart = findOpeningBrace(source, m.index + m[0].length);
    const bodyEnd = bodyStart >= 0 ? findMatchingBrace(source, bodyStart) : source.length;
    results.push({ name, bodyStart: bodyStart >= 0 ? bodyStart : m.index, bodyEnd, declarationPos: m.index });
  }
  return results;
}

function parseClasses(source: string): ClassInfo[] {
  const results: ClassInfo[] = [];
  let m: RegExpExecArray | null;
  CLASS_RE.lastIndex = 0;
  while ((m = CLASS_RE.exec(source)) !== null) {
    const name = m[1];
    const extendsName = m[2];
    const implementsRaw = m[3];
    const implementsNames = implementsRaw
      ? implementsRaw.split(',').map(s => s.trim()).filter(s => /^\w+$/.test(s))
      : [];
    const bodyStart = findOpeningBrace(source, m.index + m[0].length);
    const bodyEnd = bodyStart >= 0 ? findMatchingBrace(source, bodyStart) : source.length;
    results.push({ name, extendsName, implementsNames, bodyStart, bodyEnd, declarationPos: m.index });
  }
  return results;
}

function parseInterfaces(source: string): DeclInfo[] {
  const results: DeclInfo[] = [];
  let m: RegExpExecArray | null;
  INTERFACE_RE.lastIndex = 0;
  while ((m = INTERFACE_RE.exec(source)) !== null) {
    results.push({ name: m[1], pos: m.index });
  }
  return results;
}

function parseTypes(source: string): DeclInfo[] {
  const results: DeclInfo[] = [];
  let m: RegExpExecArray | null;
  TYPE_RE.lastIndex = 0;
  while ((m = TYPE_RE.exec(source)) !== null) {
    results.push({ name: m[1], pos: m.index });
  }
  return results;
}

function parseClassMethods(source: string, cls: ClassInfo): FuncRange[] {
  const results: FuncRange[] = [];
  if (cls.bodyStart < 0 || cls.bodyEnd <= cls.bodyStart) return results;

  const classBody = source.slice(cls.bodyStart + 1, cls.bodyEnd);
  let m: RegExpExecArray | null;
  METHOD_RE.lastIndex = 0;

  while ((m = METHOD_RE.exec(classBody)) !== null) {
    const name = m[1];
    if (name === 'constructor' || isNoise(name)) continue;

    const absStart = cls.bodyStart + 1 + m.index;
    const bodyStart = findOpeningBrace(source, absStart + m[0].length);
    const bodyEnd = bodyStart >= 0 ? findMatchingBrace(source, bodyStart) : cls.bodyEnd;

    results.push({ name, bodyStart: bodyStart >= 0 ? bodyStart : absStart, bodyEnd, declarationPos: absStart });
  }

  return results;
}

function parseCalls(source: string): CallSite[] {
  const results: CallSite[] = [];
  let m: RegExpExecArray | null;
  CALL_RE.lastIndex = 0;

  while ((m = CALL_RE.exec(source)) !== null) {
    const name = m[1];
    if (isNoise(name)) continue;

    const pos = m.index;
    const prefix = source.slice(Math.max(0, pos - 30), pos);
    if (/(?:^|\s)(?:function|class|interface|type|const|let|var|new|return|throw|case|import|export|if|for|while|switch|catch)\s*$/.test(prefix)) continue;

    const line = countLines(source, pos);
    results.push({ name, pos, line });
  }

  return results;
}

function findEnclosingFunction(callPos: number, funcRanges: FuncRange[]): FuncRange | null {
  let best: FuncRange | null = null;
  for (const f of funcRanges) {
    if (f.bodyStart <= callPos && callPos <= f.bodyEnd) {
      if (!best || f.bodyStart > best.bodyStart) {
        best = f;
      }
    }
  }
  return best;
}

function extractTypeReferences(
  source: string,
  funcRanges: FuncRange[],
  knownTypeNames: Set<string>,
): Map<string, string[]> {
  const refs = new Map<string, string[]>();

  for (const func of funcRanges) {
    const sigEnd = Math.min(func.bodyStart, source.indexOf('\n', func.declarationPos));
    if (sigEnd <= func.declarationPos) continue;
    const sig = source.slice(func.declarationPos, sigEnd);

    const typeMatches = sig.matchAll(/:\s*(\w+)/g);
    const seen = new Set<string>();
    for (const tm of typeMatches) {
      const typeName = tm[1];
      if (knownTypeNames.has(typeName)) {
        seen.add(typeName);
      }
    }

    if (seen.size > 0) {
      refs.set(func.name, [...seen]);
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// File extraction (inline extractFile)
// ---------------------------------------------------------------------------

interface ExtractResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function extractFile(filePath: string, source: string, rootDir: string): ExtractResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const relPath = computeRelativePath(filePath, rootDir);
  const stem = filestem(relPath);
  const fileId = makeId(relPath);

  nodes.push({
    id: fileId,
    label: pbasename(relPath),
    fileType: 'code',
    sourceFile: relPath,
  });

  const imports = parseImports(source, relPath);
  const importedFuncIds = new Map<string, string>();

  for (const imp of imports) {
    if (!imp.resolvedPath || imp.resolvedPath === relPath) continue;

    const importedFileId = makeId(imp.resolvedPath);
    edges.push({
      source: fileId,
      target: importedFileId,
      relation: 'imports',
      confidence: CONFIDENCE,
      sourceFile: relPath,
    });

    const importedStem = filestem(imp.resolvedPath);
    for (const name of imp.names) {
      importedFuncIds.set(name, makeId(importedStem, name));
    }
  }

  const tradFuncs = parseFuncDecls(source);
  const arrowFuncs = parseArrowFuncs(source);
  const funcExprs = parseFuncExprs(source);
  const allFunctions = [...tradFuncs, ...arrowFuncs, ...funcExprs];

  const classes = parseClasses(source);
  const interfaces = parseInterfaces(source);
  const types = parseTypes(source);

  const allMethods: FuncRange[] = [];
  for (const cls of classes) {
    allMethods.push(...parseClassMethods(source, cls));
  }

  const allCallables = [...allFunctions, ...allMethods];

  const localFuncNames = new Set<string>();
  for (const func of allFunctions) {
    const funcId = makeId(stem, func.name);
    localFuncNames.add(func.name);
    nodes.push({
      id: funcId,
      label: func.name,
      fileType: 'code',
      sourceFile: relPath,
      sourceLocation: `L${countLines(source, func.declarationPos)}`,
    });
    edges.push({
      source: fileId,
      target: funcId,
      relation: 'contains',
      confidence: CONFIDENCE,
      sourceFile: relPath,
    });
  }

  for (const cls of classes) {
    const classId = makeId(stem, cls.name);
    nodes.push({
      id: classId,
      label: cls.name,
      fileType: 'code',
      sourceFile: relPath,
      sourceLocation: `L${countLines(source, cls.declarationPos)}`,
    });
    edges.push({
      source: fileId,
      target: classId,
      relation: 'contains',
      confidence: CONFIDENCE,
      sourceFile: relPath,
    });

    if (cls.extendsName) {
      edges.push({
        source: classId,
        target: makeId(stem, cls.extendsName),
        relation: 'inherits',
        confidence: CONFIDENCE,
        sourceFile: relPath,
      });
    }

    for (const iface of cls.implementsNames) {
      edges.push({
        source: classId,
        target: makeId(stem, iface),
        relation: 'implements',
        confidence: CONFIDENCE,
        sourceFile: relPath,
      });
    }

    const methods = parseClassMethods(source, cls);
    for (const method of methods) {
      const methodId = makeId(stem, method.name);
      nodes.push({
        id: methodId,
        label: method.name,
        fileType: 'code',
        sourceFile: relPath,
        sourceLocation: `L${countLines(source, method.declarationPos)}`,
      });
      edges.push({
        source: fileId,
        target: methodId,
        relation: 'contains',
        confidence: CONFIDENCE,
        sourceFile: relPath,
      });
      edges.push({
        source: classId,
        target: methodId,
        relation: 'method',
        confidence: CONFIDENCE,
        sourceFile: relPath,
      });
    }
  }

  for (const iface of interfaces) {
    const id = makeId(stem, iface.name);
    nodes.push({
      id,
      label: iface.name,
      fileType: 'code',
      sourceFile: relPath,
      sourceLocation: `L${countLines(source, iface.pos)}`,
    });
    edges.push({ source: fileId, target: id, relation: 'contains', confidence: CONFIDENCE, sourceFile: relPath });
  }

  for (const t of types) {
    const id = makeId(stem, t.name);
    nodes.push({
      id,
      label: t.name,
      fileType: 'code',
      sourceFile: relPath,
      sourceLocation: `L${countLines(source, t.pos)}`,
    });
    edges.push({ source: fileId, target: id, relation: 'contains', confidence: CONFIDENCE, sourceFile: relPath });
  }

  const calls = parseCalls(source);

  for (const call of calls) {
    const enclosing = findEnclosingFunction(call.pos, allCallables);
    if (!enclosing) continue;

    const callerId = makeId(stem, enclosing.name);

    if (localFuncNames.has(call.name)) {
      edges.push({
        source: callerId,
        target: makeId(stem, call.name),
        relation: 'calls',
        confidence: CONFIDENCE,
        sourceFile: relPath,
        sourceLocation: `L${call.line}`,
      });
    } else {
      const importedTarget = importedFuncIds.get(call.name);
      if (importedTarget) {
        edges.push({
          source: callerId,
          target: importedTarget,
          relation: 'calls',
          confidence: CONFIDENCE,
          sourceFile: relPath,
          sourceLocation: `L${call.line}`,
        });
      }
    }
  }

  const knownTypeNames = new Set([
    ...interfaces.map(i => i.name),
    ...types.map(t => t.name),
    ...classes.map(c => c.name),
  ]);

  const typeRefs = extractTypeReferences(source, allFunctions, knownTypeNames);
  for (const [funcName, refdTypes] of typeRefs) {
    const funcId = makeId(stem, funcName);
    for (const refdType of refdTypes) {
      edges.push({
        source: funcId,
        target: makeId(stem, refdType),
        relation: 'references',
        confidence: CONFIDENCE,
        sourceFile: relPath,
      });
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function disambiguateId(id: string, sourceFile: string): string {
  return `${id}_${hashCode(sourceFile).toString(16)}`;
}

function isAstNode(node: GraphNode): boolean {
  return node.metadata?.['_origin'] === 'ast';
}

function nodeDegree(nodeId: string, edges: GraphEdge[]): number {
  let degree = 0;
  for (const e of edges) {
    if (e.source === nodeId || e.target === nodeId) {
      degree++;
    }
  }
  return degree;
}

function uniqueSourceFiles(nodes: GraphNode[]): number {
  const files = new Set<string>();
  for (const n of nodes) {
    if (n.sourceFile) {
      files.add(n.sourceFile);
    }
  }
  return files.size;
}

function deduplicateNodes(nodes: GraphNode[]): GraphNode[] {
  const merged = new Map<string, GraphNode>();

  for (const node of nodes) {
    const existing = merged.get(node.id);
    if (!existing) {
      merged.set(node.id, { ...node });
      continue;
    }

    const existingIsAst = isAstNode(existing);
    const incomingIsAst = isAstNode(node);

    if (incomingIsAst && !existingIsAst) {
      merged.set(node.id, { ...node });
      continue;
    }

    if (existingIsAst && !incomingIsAst) {
      continue;
    }

    merged.set(node.id, { ...existing, ...node, metadata: { ...existing.metadata, ...node.metadata } });
  }

  return Array.from(merged.values());
}

function deduplicateEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const result: GraphEdge[] = [];

  for (const edge of edges) {
    const key = `${edge.source}|${edge.target}|${edge.relation}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(edge);
    }
  }

  return result;
}

function buildNodeIdIndex(nodes: GraphNode[]): Set<string> {
  const ids = new Set<string>();
  for (const n of nodes) {
    ids.add(n.id);
  }
  return ids;
}

function computeDegreesOnNodes(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  return nodes.map((n) => ({ ...n, degree: nodeDegree(n.id, edges) }));
}

function sortNodesByDegreeDesc(nodes: GraphNode[]): GraphNode[] {
  return [...nodes].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0));
}

function computeStats(nodes: GraphNode[], edges: GraphEdge[]): GraphStats {
  const communitySet = new Set<number>();
  for (const n of nodes) {
    if (n.community !== undefined) {
      communitySet.add(n.community);
    }
  }

  let extractedEdges = 0;
  let inferredEdges = 0;
  let ambiguousEdges = 0;

  for (const e of edges) {
    switch (e.confidence) {
      case 'EXTRACTED': extractedEdges++; break;
      case 'INFERRED': inferredEdges++; break;
      case 'AMBIGUOUS': ambiguousEdges++; break;
    }
  }

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    communityCount: communitySet.size,
    extractedEdges,
    inferredEdges,
    ambiguousEdges,
    fileCount: uniqueSourceFiles(nodes),
  };
}

// ---------------------------------------------------------------------------
// Community detection (Louvain-like)
// ---------------------------------------------------------------------------

function buildAdjacency(
  nodes: GraphNode[],
  edges: GraphEdge[],
): {
  neighbors: Map<string, Set<string>>;
  weights: Map<string, Map<string, number>>;
  degrees: Map<string, number>;
  totalWeight: number;
} {
  const neighbors = new Map<string, Set<string>>();
  const weights = new Map<string, Map<string, number>>();
  const degrees = new Map<string, number>();
  let totalWeight = 0;

  for (const n of nodes) {
    neighbors.set(n.id, new Set());
    weights.set(n.id, new Map());
    degrees.set(n.id, 0);
  }

  for (const e of edges) {
    const w = e.weight ?? 1.0;
    totalWeight += w;

    const srcSet = neighbors.get(e.source);
    const tgtSet = neighbors.get(e.target);
    if (srcSet && tgtSet) {
      srcSet.add(e.target);
      tgtSet.add(e.source);
    }

    const srcW = weights.get(e.source);
    const tgtW = weights.get(e.target);
    if (srcW && tgtW) {
      srcW.set(e.target, (srcW.get(e.target) ?? 0) + w);
      tgtW.set(e.source, (tgtW.get(e.source) ?? 0) + w);
    }

    degrees.set(e.source, (degrees.get(e.source) ?? 0) + w);
    degrees.set(e.target, (degrees.get(e.target) ?? 0) + w);
  }

  return { neighbors, weights, degrees, totalWeight };
}

function detectCommunities(graph: KnowledgeGraph): KnowledgeGraph {
  const nodes = graph.nodes;
  const edges = graph.edges;

  if (nodes.length === 0) {
    return { ...graph, nodes: [], edges };
  }

  const { neighbors, weights, degrees, totalWeight } = buildAdjacency(nodes, edges);

  const nodeList = nodes.map((n) => n.id);

  const nodeToCommunity = new Map<string, number>();
  const rng = seededRandom(42);
  const shuffled = fisherYatesShuffle(nodeList, rng);

  let nextCommunityId = 0;
  for (const id of shuffled) {
    nodeToCommunity.set(id, nextCommunityId++);
  }

  const twoM = 2 * totalWeight;
  if (twoM === 0) {
    return { ...graph, nodes: nodes.map((n) => ({ ...n, community: nodeToCommunity.get(n.id) })) };
  }

  for (let iteration = 0; iteration < 50; iteration++) {
    let moved = false;

    for (const nodeId of shuffled) {
      const currentComm = nodeToCommunity.get(nodeId);
      if (currentComm === undefined) continue;

      const k_i = degrees.get(nodeId) ?? 0;

      let bestComm = currentComm;
      let bestGain = 0;

      const nodeNeighbors = neighbors.get(nodeId);
      if (!nodeNeighbors) continue;

      const neighborComms = new Set<number>();
      for (const neighborId of nodeNeighbors) {
        const nc = nodeToCommunity.get(neighborId);
        if (nc !== undefined && nc !== currentComm) {
          neighborComms.add(nc);
        }
      }

      for (const candidateComm of neighborComms) {
        let k_i_in = 0;
        const nodeWeights = weights.get(nodeId);
        if (nodeWeights) {
          for (const [nid, w] of nodeWeights) {
            if (nodeToCommunity.get(nid) === candidateComm) {
              k_i_in += w;
            }
          }
        }

        const sigma_tot = internalTotalDegree(candidateComm, nodeToCommunity, degrees);
        const sigma_in = internalEdgeWeight(candidateComm, nodeToCommunity, weights);
        const gain = ((sigma_in + 2 * k_i_in) / twoM) -
          (((sigma_tot + k_i) / twoM) * ((sigma_tot + k_i) / twoM)) -
          ((sigma_in / twoM) - ((sigma_tot / twoM) * (sigma_tot / twoM)) - ((k_i / twoM) * (k_i / twoM)));

        if (gain > bestGain) {
          bestGain = gain;
          bestComm = candidateComm;
        }
      }

      nodeToCommunity.set(nodeId, bestComm);
      if (bestComm !== currentComm) moved = true;
    }

    if (!moved) break;
  }

  let commCounter = 0;
  const commRemap = new Map<number, number>();
  const normalizedCommunities = new Map<string, number>();

  for (const nodeId of nodeList) {
    const comm = nodeToCommunity.get(nodeId);
    if (comm === undefined) continue;
    let remapped = commRemap.get(comm);
    if (remapped === undefined) {
      remapped = commCounter++;
      commRemap.set(comm, remapped);
    }
    normalizedCommunities.set(nodeId, remapped);
  }

  const resultNodes = nodes.map((n) => ({ ...n, community: normalizedCommunities.get(n.id) }));

  return labelCommunitiesInternal({ ...graph, nodes: resultNodes });
}

function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

function fisherYatesShuffle<T>(arr: T[], rng: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function internalTotalDegree(
  community: number,
  nodeToCommunity: Map<string, number>,
  degrees: Map<string, number>,
): number {
  let sum = 0;
  for (const [nodeId, deg] of degrees) {
    if (nodeToCommunity.get(nodeId) === community) {
      sum += deg;
    }
  }
  return sum;
}

function internalEdgeWeight(
  community: number,
  nodeToCommunity: Map<string, number>,
  weights: Map<string, Map<string, number>>,
): number {
  let sum = 0;
  for (const [nodeId, nodeWeights] of weights) {
    if (nodeToCommunity.get(nodeId) !== community) continue;
    for (const [neighborId, w] of nodeWeights) {
      if (nodeToCommunity.get(neighborId) === community) {
        sum += w;
      }
    }
  }
  return sum / 2;
}

function labelCommunitiesInternal(graph: KnowledgeGraph): KnowledgeGraph {
  const communityNodes = new Map<number, GraphNode[]>();
  for (const n of graph.nodes) {
    if (n.community === undefined) continue;
    const comm = n.community;
    let arr = communityNodes.get(comm);
    if (!arr) {
      arr = [];
      communityNodes.set(comm, arr);
    }
    arr.push(n);
  }

  const communityLabel = new Map<number, string>();
  for (const [comm, nodes] of communityNodes) {
    let bestNode: GraphNode | null = null;
    let bestDegree = -1;
    for (const n of nodes) {
      const deg = n.degree ?? 0;
      if (deg > bestDegree) {
        bestDegree = deg;
        bestNode = n;
      }
    }
    communityLabel.set(comm, bestNode?.label ?? `community_${comm}`);
  }

  const resultNodes = graph.nodes.map((n) => {
    if (n.community === undefined) return n;
    return { ...n, communityName: communityLabel.get(n.community) };
  });

  return { ...graph, nodes: resultNodes };
}

function getCommunities(graph: KnowledgeGraph): GraphCommunity[] {
  const communityMap = new Map<number, GraphCommunity>();

  for (const n of graph.nodes) {
    if (n.community === undefined) continue;
    const comm = n.community;
    let c = communityMap.get(comm);
    if (!c) {
      c = { id: comm, label: n.communityName ?? `community_${comm}`, size: 0, memberIds: [] };
      communityMap.set(comm, c);
    }
    c.size++;
    c.memberIds.push(n.id);
  }

  return Array.from(communityMap.values()).sort((a, b) => b.size - a.size);
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
  'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'can', 'could', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'he', 'she', 'it', 'they', 'them', 'this', 'that', 'these', 'those',
  'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'some',
  'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very', 'just',
  'about', 'above', 'after', 'again', 'and', 'but', 'or', 'for',
  'nor', 'from', 'at', 'by', 'in', 'into', 'on', 'off', 'out',
  'over', 'under', 'with', 'to', 'up', 'if', 'then', 'there', 'here',
]);

function generateTrigrams(str: string): string[] {
  const trigrams: string[] = [];
  const s = `  ${str}  `;
  for (let i = 0; i < s.length - 2; i++) {
    trigrams.push(s.substring(i, i + 3));
  }
  return trigrams;
}

function buildTrigramIndex(nodes: GraphNode[]): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  for (const node of nodes) {
    const label = node.normLabel ?? node.label.toLowerCase();
    const trigrams = generateTrigrams(label);
    for (const t of trigrams) {
      let nodeSet = idx.get(t);
      if (!nodeSet) {
        nodeSet = new Set();
        idx.set(t, nodeSet);
      }
      nodeSet.add(node.id);
    }
    if (node.sourceFile) {
      const fileTrigrams = generateTrigrams(node.sourceFile.toLowerCase());
      for (const t of fileTrigrams) {
        let nodeSet = idx.get(t);
        if (!nodeSet) {
          nodeSet = new Set();
          idx.set(t, nodeSet);
        }
        nodeSet.add(node.id);
      }
    }
  }
  return idx;
}

function extractTerms(question: string): string[] {
  const cleaned = question
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = cleaned.split(' ');
  return tokens.filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function scoreNodes(graph: KnowledgeGraph, terms: string[]): Map<string, number> {
  const scores = new Map<string, number>();
  if (terms.length === 0) return scores;

  const trigramIndex = buildTrigramIndex(graph.nodes);

  const termDf = new Map<string, number>();
  for (const term of terms) {
    const trigrams = generateTrigrams(term);
    const matchingNodes = new Set<string>();
    for (const t of trigrams) {
      const nodeSet = trigramIndex.get(t);
      if (nodeSet) {
        for (const id of nodeSet) {
          matchingNodes.add(id);
        }
      }
    }
    termDf.set(term, matchingNodes.size);
  }

  const totalNodes = graph.nodes.length;
  const idf = new Map<string, number>();
  for (const term of terms) {
    const df = termDf.get(term) ?? 0;
    idf.set(term, df > 0 ? Math.log((totalNodes + 1) / (df + 1)) : 0);
  }

  const fullQueryLower = terms.join(' ').toLowerCase();
  const nodeMap = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    nodeMap.set(n.id, n);
  }

  const candidateIds = new Set<string>();
  for (const term of terms) {
    const trigrams = generateTrigrams(term);
    for (const t of trigrams) {
      const nodeSet = trigramIndex.get(t);
      if (nodeSet) {
        for (const id of nodeSet) {
          candidateIds.add(id);
        }
      }
    }
  }

  for (const nodeId of candidateIds) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const label = node.normLabel ?? node.label.toLowerCase();
    let nodeScore = 0;
    let matchedTerms = 0;

    if (label === fullQueryLower) {
      nodeScore += 10000;
      matchedTerms = terms.length;
    } else {
      for (const term of terms) {
        const termIdf = idf.get(term) ?? 0;
        if (label === term) {
          nodeScore += 1000 * termIdf;
          matchedTerms++;
        } else if (label.startsWith(term)) {
          nodeScore += 100 * termIdf;
          matchedTerms++;
        } else if (label.includes(term)) {
          nodeScore += 1 * termIdf;
          matchedTerms++;
        }
      }
    }

    if (node.sourceFile) {
      const sf = node.sourceFile.toLowerCase();
      for (const term of terms) {
        if (sf.includes(term)) {
          nodeScore += 0.5;
        }
      }
    }

    if (matchedTerms > 0) {
      const coverageScale = (matchedTerms / terms.length) * (matchedTerms / terms.length);
      nodeScore *= coverageScale;
    }

    if (nodeScore > 0) {
      scores.set(nodeId, nodeScore);
    }
  }

  return scores;
}

function traverseBfs(
  graph: KnowledgeGraph,
  seeds: string[],
  depth: number,
  maxResults: number,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeMap = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    nodeMap.set(n.id, n);
  }

  const adj = new Map<string, Array<{ target: string; edge: GraphEdge }>>();
  for (const e of graph.edges) {
    let srcArr = adj.get(e.source);
    if (!srcArr) { srcArr = []; adj.set(e.source, srcArr); }
    srcArr.push({ target: e.target, edge: e });
    let tgtArr = adj.get(e.target);
    if (!tgtArr) { tgtArr = []; adj.set(e.target, tgtArr); }
    tgtArr.push({ target: e.source, edge: e });
  }

  const visited = new Set<string>();
  const selectedNodes: GraphNode[] = [];
  const selectedEdges: GraphEdge[] = [];
  const selectedEdgeSet = new Set<string>();

  const queue: Array<{ id: string; depth: number }> = [];
  for (const seed of seeds) {
    if (nodeMap.has(seed)) {
      queue.push({ id: seed, depth: 0 });
    }
  }

  while (queue.length > 0 && selectedNodes.length < maxResults) {
    const item = queue.shift();
    if (!item) continue;
    const { id, depth: d } = item;
    if (visited.has(id)) continue;
    if (d > depth) continue;
    visited.add(id);
    const currentNode = nodeMap.get(id);
    if (!currentNode) continue;
    selectedNodes.push(currentNode);

    if (d >= depth) continue;

    const neighbors = adj.get(id);
    if (!neighbors) continue;

    for (const { target, edge } of neighbors) {
      if (!visited.has(target)) {
        queue.push({ id: target, depth: d + 1 });
      }
      const edgeKey = `${edge.source}|${edge.target}|${edge.relation}`;
      if (!selectedEdgeSet.has(edgeKey)) {
        selectedEdgeSet.add(edgeKey);
        selectedEdges.push(edge);
      }
    }
  }

  return { nodes: selectedNodes, edges: selectedEdges };
}

// ---------------------------------------------------------------------------
// HTML export
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateHtml(graph: KnowledgeGraph, title: string): string {
  const nodes = graph.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    fileType: n.fileType,
    sourceFile: n.sourceFile,
    sourceLocation: n.sourceLocation ?? '',
    community: n.community,
    communityName: n.communityName ?? '',
    degree: n.degree ?? 0,
  }));

  const links = graph.edges.map((e) => ({
    source: e.source,
    target: e.target,
    relation: e.relation,
    confidence: e.confidence,
  }));

  const communities = getCommunities(graph).map((c) => ({ id: c.id, label: c.label, size: c.size }));

  const data = JSON.stringify({ nodes, links, communities, stats: graph.stats ?? null });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
body { display: flex; }
#sidebar { width: 320px; min-width: 320px; height: 100vh; overflow-y: auto; background: #1a1a2e; color: #eee; display: flex; flex-direction: column; border-right: 1px solid #333; }
#search-container { padding: 12px; border-bottom: 1px solid #333; }
#search { width: 100%; padding: 8px 12px; border: 1px solid #444; border-radius: 6px; background: #16213e; color: #eee; font-size: 14px; outline: none; }
#search:focus { border-color: #1f77b4; }
#info-panel { flex: 1; padding: 12px; border-bottom: 1px solid #333; overflow-y: auto; }
#info-panel h3 { font-size: 13px; text-transform: uppercase; color: #888; margin-bottom: 8px; letter-spacing: 0.5px; }
#info-content { font-size: 13px; line-height: 1.6; }
#info-content .info-row { margin-bottom: 6px; }
#info-content .info-label { color: #888; font-weight: 600; }
#info-content .info-value { color: #ccc; word-break: break-all; }
#info-content .info-connections { margin-top: 8px; }
#info-content .conn-item { font-size: 12px; padding: 2px 0; color: #aaa; }
#legend { padding: 12px; }
#legend h3 { font-size: 13px; text-transform: uppercase; color: #888; margin-bottom: 8px; letter-spacing: 0.5px; }
.legend-item { display: flex; align-items: center; padding: 4px 0; cursor: pointer; font-size: 12px; color: #ccc; }
.legend-item:hover { color: #fff; }
.legend-item.hidden { opacity: 0.4; }
.legend-swatch { width: 12px; height: 12px; border-radius: 3px; margin-right: 8px; flex-shrink: 0; }
.legend-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.legend-count { margin-left: auto; color: #666; font-size: 11px; padding-left: 8px; }
#graph-container { flex: 1; height: 100vh; background: #0f0f23; position: relative; }
#graph-container svg { width: 100%; height: 100%; }
.tooltip { position: absolute; padding: 6px 10px; background: rgba(0,0,0,0.85); color: #eee; border-radius: 4px; font-size: 12px; pointer-events: none; z-index: 1000; max-width: 300px; word-wrap: break-word; }
</style>
</head>
<body>
<div id="sidebar">
  <div id="search-container">
    <input type="text" id="search" placeholder="Search nodes..." autocomplete="off" />
  </div>
  <div id="info-panel">
    <h3>Node Info</h3>
    <div id="info-content"><span style="color:#666;">Click a node to inspect</span></div>
  </div>
  <div id="legend">
    <h3>Communities</h3>
    <div id="legend-content"></div>
  </div>
</div>
<div id="graph-container">
  <svg></svg>
</div>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
var data = ${data};
(function() {
  var container = document.getElementById('graph-container');
  var svg = d3.select('#graph-container svg');
  var width = container.clientWidth;
  var height = container.clientHeight;

  var simulation = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.links).id(function(d) { return d.id; }).distance(50))
    .force('charge', d3.forceManyBody().strength(-100))
    .force('center', d3.forceCenter(width / 2, height / 2));

  var g = svg.append('g');

  var zoom = d3.zoom()
    .scaleExtent([0.1, 8])
    .on('zoom', function(event) {
      g.attr('transform', event.transform);
    });

  svg.call(zoom);

  var link = g.append('g').attr('class', 'links').selectAll('line')
    .data(data.links).join('line')
    .attr('stroke', '#333').attr('stroke-width', 0.5).attr('stroke-opacity', 0.6);

  var node = g.append('g').attr('class', 'nodes').selectAll('circle')
    .data(data.nodes).join('circle')
    .attr('r', function(d) { return Math.sqrt(Math.log(d.degree + 1)) * 2.5 + 3; })
    .attr('fill', function(d) {
      if (d.community === undefined) return '#555';
      return (['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd','#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf'])[d.community % 10];
    })
    .attr('stroke', '#fff').attr('stroke-width', 0.5).attr('cursor', 'pointer')
    .call(d3.drag()
      .on('start', function(event, d) { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', function(event, d) { d.fx = event.x; d.fy = event.y; })
      .on('end', function(event, d) { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));

  var tooltip = d3.select('body').append('div').attr('class', 'tooltip').style('opacity', 0);

  node.on('mouseover', function(event, d) {
    tooltip.transition().duration(200).style('opacity', 0.9);
    tooltip.html(d.label.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'))
      .style('left', (event.pageX + 10) + 'px').style('top', (event.pageY - 10) + 'px');
  }).on('mousemove', function(event) {
    tooltip.style('left', (event.pageX + 10) + 'px').style('top', (event.pageY - 10) + 'px');
  }).on('mouseout', function() {
    tooltip.transition().duration(300).style('opacity', 0);
  }).on('click', function(event, d) {
    event.stopPropagation();
    showNodeInfo(d);
    highlightNode(d);
  });

  svg.on('click', function() {
    clearHighlight();
    document.getElementById('info-content').innerHTML = '<span style="color:#666;">Click a node to inspect</span>';
  });

  simulation.on('tick', function() {
    link.attr('x1', function(d) { return d.source.x; }).attr('y1', function(d) { return d.source.y; })
      .attr('x2', function(d) { return d.target.x; }).attr('y2', function(d) { return d.target.y; });
    node.attr('cx', function(d) { return d.x; }).attr('cy', function(d) { return d.y; });
  });

  function showNodeInfo(d) {
    var neighbors = data.links.filter(function(l) {
      return l.source.id === d.id || l.target.id === d.id || l.source === d.id || l.target === d.id;
    });
    var neighborIds = new Set();
    neighbors.forEach(function(l) {
      var sid = l.source.id || l.source;
      var tid = l.target.id || l.target;
      if (sid !== d.id) neighborIds.add(sid);
      if (tid !== d.id) neighborIds.add(tid);
    });
    var esc = function(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    var html = '<div class="info-row"><span class="info-label">Label:</span> <span class="info-value">' + esc(d.label) + '</span></div>';
    html += '<div class="info-row"><span class="info-label">File:</span> <span class="info-value">' + esc(d.sourceFile) + '</span></div>';
    html += '<div class="info-row"><span class="info-label">Degree:</span> <span class="info-value">' + d.degree + '</span></div>';
    document.getElementById('info-content').innerHTML = html;
  }

  function highlightNode(d) {
    node.attr('opacity', 0.15);
    link.attr('opacity', 0.05);
    var connected = new Set(); connected.add(d.id);
    link.each(function(l) {
      var sid = l.source.id || l.source;
      var tid = l.target.id || l.target;
      if (sid === d.id) connected.add(tid);
      if (tid === d.id) connected.add(sid);
    });
    node.filter(function(n) { return connected.has(n.id); }).attr('opacity', 1);
    link.filter(function(l) { var sid = l.source.id || l.source; var tid = l.target.id || l.target; return sid === d.id || tid === d.id; })
      .attr('opacity', 0.8).attr('stroke', '#fff').attr('stroke-width', 1);
  }

  function clearHighlight() {
    node.attr('opacity', 1);
    link.attr('opacity', 0.6).attr('stroke', '#333').attr('stroke-width', 0.5);
  }

  (function buildLegend() {
    var container = document.getElementById('legend-content');
    var hiddenCommunities = new Set();
    data.communities.forEach(function(c) {
      var item = document.createElement('div');
      item.className = 'legend-item';
      var color = (['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd','#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf'])[c.id % 10];
      item.innerHTML = '<span class="legend-swatch" style="background:' + color + ';"></span>' +
        '<span class="legend-label">' + c.label.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</span>' +
        '<span class="legend-count">' + c.size + '</span>';
      item.addEventListener('click', function() {
        if (hiddenCommunities.has(c.id)) { hiddenCommunities.delete(c.id); item.classList.remove('hidden'); }
        else { hiddenCommunities.add(c.id); item.classList.add('hidden'); }
        node.attr('opacity', function(d) {
          if (hiddenCommunities.size === 0) return 1;
          if (d.community === undefined) return hiddenCommunities.size === 0 ? 1 : 0.08;
          return hiddenCommunities.has(d.community) ? 0.08 : 1;
        });
      });
      container.appendChild(item);
    });
  })();
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// GraphService
// ---------------------------------------------------------------------------

const MAX_FILES_PER_BUILD = 250;

export class GraphService {
  private readonly workspaces: WorkspaceService;
  private readonly cache = new Map<ProjectId, KnowledgeGraph>();

  constructor(private readonly c: Container) {
    this.workspaces = new WorkspaceService(c);
  }

  /** Build a knowledge graph from indexed project files. */
  async buildGraph(projectId: ProjectId): Promise<KnowledgeGraph> {
    const project = await this.c.projects.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const root = await this.workspaces.resolveConfigRoot(project);

    const lib = await loadGraphLib();
    if (lib) {
      return this.buildGraphWithLib(lib, root);
    }

    return this.buildGraphInline(root);
  }

  private async buildGraphWithLib(lib: GraphLib, root: string): Promise<KnowledgeGraph> {
    const files = await walkRepo(root);
    const extracted: Array<{ nodes: GraphNode[]; edges: GraphEdge[] }> = [];

    for (const filePath of files) {
      const ext = filePath.slice(filePath.lastIndexOf('.'));
      if (!CODE_EXTENSIONS.has(ext)) continue;

      let source: string;
      try {
        source = await readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      extracted.push(lib.extractFile(filePath, source, root));
    }

    let graph = lib.buildGraph(extracted, { maxNodes: 10000, maxEdges: 50000, rootDir: root });
    graph = lib.detectCommunities(graph);
    graph.builtAt = new Date().toISOString();

    return graph;
  }

  private async buildGraphInline(root: string): Promise<KnowledgeGraph> {
    const files = await walkRepo(root);
    const extracted: Array<{ nodes: GraphNode[]; edges: GraphEdge[] }> = [];

    let fileCount = 0;
    for (const filePath of files) {
      if (fileCount >= MAX_FILES_PER_BUILD) break;

      const ext = filePath.slice(filePath.lastIndexOf('.'));
      if (!CODE_EXTENSIONS.has(ext)) continue;

      let source: string;
      try {
        source = await readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      fileCount++;
      extracted.push(extractFile(filePath, source, root));
    }

    return this.inlineBuildGraph(extracted);
  }

  private inlineBuildGraph(extractedResults: Array<{ nodes: GraphNode[]; edges: GraphEdge[] }>): KnowledgeGraph {
    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    const seenIds = new Map<string, string>();

    for (const result of extractedResults) {
      const idRemap = new Map<string, string>();

      for (const node of result.nodes) {
        const existingFile = seenIds.get(node.id);
        if (existingFile !== undefined && existingFile !== node.sourceFile) {
          const newId = disambiguateId(node.id, node.sourceFile);
          idRemap.set(node.id, newId);
          allNodes.push({ ...node, id: newId });
          continue;
        }
        seenIds.set(node.id, node.sourceFile);
        allNodes.push(node);
      }

      for (const edge of result.edges) {
        allEdges.push({
          ...edge,
          source: idRemap.get(edge.source) ?? edge.source,
          target: idRemap.get(edge.target) ?? edge.target,
        });
      }
    }

    const dedupedNodes = deduplicateNodes(allNodes);
    const dedupedEdges = deduplicateEdges(allEdges);

    const nodeIdIndex = buildNodeIdIndex(dedupedNodes);
    const validEdges = dedupedEdges.filter(
      (e) => nodeIdIndex.has(e.source) && nodeIdIndex.has(e.target),
    );

    const nodesWithDegrees = computeDegreesOnNodes(dedupedNodes, validEdges);
    const sortedNodes = sortNodesByDegreeDesc(nodesWithDegrees);

    const maxNodes = 10000;
    const maxEdges = 50000;
    const limitedNodes = sortedNodes.slice(0, maxNodes);
    const limitedNodeIds = buildNodeIdIndex(limitedNodes);
    const limitedEdges = validEdges
      .filter((e) => limitedNodeIds.has(e.source) && limitedNodeIds.has(e.target))
      .slice(0, maxEdges);

    let graph: KnowledgeGraph = {
      nodes: limitedNodes,
      edges: limitedEdges,
      hyperedges: [],
      stats: computeStats(limitedNodes, limitedEdges),
      builtAt: new Date().toISOString(),
    };

    graph = detectCommunities(graph);
    graph.stats = computeStats(graph.nodes, graph.edges);

    return graph;
  }

  /** Get the current graph (builds if not cached). */
  async getGraph(projectId: ProjectId): Promise<KnowledgeGraph> {
    const cached = this.cache.get(projectId);
    if (cached) return cached;

    const graph = await this.buildGraph(projectId);
    this.cache.set(projectId, graph);
    return graph;
  }

  /** Query the graph with natural language. */
  async queryGraph(projectId: ProjectId, question: string): Promise<GraphQueryResult> {
    const graph = await this.getGraph(projectId);

    const lib = await loadGraphLib();
    if (lib) {
      return lib.queryGraph(graph, question, { traversal: 'bfs', depth: 3 });
    }

    return this.inlineQueryGraph(graph, question);
  }

  private inlineQueryGraph(graph: KnowledgeGraph, question: string): GraphQueryResult {
    const terms = extractTerms(question);
    const scores = scoreNodes(graph, terms);

    const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);

    const seeds: string[] = [];
    for (let i = 0; i < Math.min(sorted.length, 3); i++) {
      if (i > 0) {
        const prevScore = sorted[i - 1][1];
        const currScore = sorted[i][1];
        if (prevScore > 0 && currScore / prevScore < 0.2) break;
      }
      seeds.push(sorted[i][0]);
    }

    if (seeds.length === 0) {
      return { question, nodes: [], edges: [], seeds: [], traversalType: 'bfs', depth: 3 };
    }

    const { nodes, edges } = traverseBfs(graph, seeds, 3, 200);

    return { question, nodes, edges, seeds, traversalType: 'bfs', depth: 3 };
  }

  /** Find shortest path between two concepts. */
  async findPath(projectId: ProjectId, source: string, target: string): Promise<GraphPath | null> {
    const graph = await this.getGraph(projectId);

    const lib = await loadGraphLib();
    if (lib) {
      return lib.findPath(graph, source, target);
    }

    return this.inlineFindPath(graph, source, target);
  }

  private inlineFindPath(graph: KnowledgeGraph, source: string, target: string): GraphPath | null {
    const nodeMap = new Map<string, GraphNode>();
    for (const n of graph.nodes) {
      nodeMap.set(n.id, n);
    }

    if (!nodeMap.has(source) || !nodeMap.has(target)) return null;

    if (source === target) {
      return { source, target, hops: 0, path: { nodes: [source], edges: [] } };
    }

    const adj = new Map<string, Array<{
      neighbor: string;
      edge: { source: string; target: string; relation: GraphRelation; confidence: GraphConfidence };
    }>>();
    for (const e of graph.edges) {
      const edgeInfo = { source: e.source, target: e.target, relation: e.relation, confidence: e.confidence };
      let srcArr = adj.get(e.source);
      if (!srcArr) { srcArr = []; adj.set(e.source, srcArr); }
      srcArr.push({ neighbor: e.target, edge: edgeInfo });
      let tgtArr = adj.get(e.target);
      if (!tgtArr) { tgtArr = []; adj.set(e.target, tgtArr); }
      tgtArr.push({ neighbor: e.source, edge: edgeInfo });
    }

    const visited = new Set<string>();
    const parent = new Map<string, string>();
    const parentEdge = new Map<string, { source: string; target: string; relation: GraphRelation; confidence: GraphConfidence }>();

    const queue = [source];
    visited.add(source);

    let found = false;
    while (queue.length > 0 && !found) {
      const current = queue.shift();
      if (!current) continue;
      const neighbors = adj.get(current);
      if (!neighbors) continue;

      for (const { neighbor, edge } of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          parent.set(neighbor, current);
          parentEdge.set(neighbor, edge);
          queue.push(neighbor);
          if (neighbor === target) {
            found = true;
            break;
          }
        }
      }
    }

    if (!found) return null;

    const nodePath: string[] = [];
    const edgePath: Array<{ source: string; target: string; relation: GraphRelation; confidence: GraphConfidence }> = [];

    let current = target;
    while (current !== source) {
      nodePath.unshift(current);
      const edge = parentEdge.get(current);
      if (edge) edgePath.unshift(edge);
      const next = parent.get(current);
      if (!next) break;
      current = next;
    }
    nodePath.unshift(source);

    return { source, target, hops: nodePath.length - 1, path: { nodes: nodePath, edges: edgePath } };
  }

  /** Explain a node. */
  async explainNode(projectId: ProjectId, label: string): Promise<GraphNode | null> {
    const graph = await this.getGraph(projectId);

    const lib = await loadGraphLib();
    if (lib) {
      const result = lib.explainNode(graph, label);
      return result ? result.node : null;
    }

    const node = graph.nodes.find((n) => n.label === label || n.id === label);
    return node ?? null;
  }

  /** Export graph as HTML. */
  async exportHtml(projectId: ProjectId): Promise<string> {
    const graph = await this.getGraph(projectId);

    const lib = await loadGraphLib();
    if (lib) {
      return lib.generateHtml(graph, { title: `Knowledge Graph – ${projectId}` });
    }

    return generateHtml(graph, `Knowledge Graph – ${projectId}`);
  }

  /** Get god nodes (highest degree). */
  async getGodNodes(projectId: ProjectId, topN?: number): Promise<GodNode[]> {
    const graph = await this.getGraph(projectId);
    const n = topN ?? 10;

    const jsonKeyLabels = new Set([
      'id', 'name', 'type', 'properties', 'start', 'end', 'value', 'key',
      'data', 'node', 'edge', 'source', 'target',
    ]);

    function isFileNode(node: GraphNode): boolean {
      return node.label === basename(node.sourceFile);
    }

    function isNoiseNode(node: GraphNode): boolean {
      return isFileNode(node) || jsonKeyLabels.has(node.label) || node.sourceFile === '';
    }

    const candidates = graph.nodes
      .filter((node) => !isNoiseNode(node))
      .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0));

    return candidates.slice(0, n).map((node) => ({
      nodeId: node.id,
      label: node.label,
      degree: node.degree ?? 0,
      sourceFile: node.sourceFile,
      fileType: node.fileType,
    }));
  }

  /** Get graph statistics. */
  async getStats(projectId: ProjectId): Promise<GraphStats> {
    const graph = await this.getGraph(projectId);
    return graph.stats ?? computeStats(graph.nodes, graph.edges);
  }

  /** Invalidate cached graph for a project. */
  async invalidateCache(projectId: ProjectId): Promise<void> {
    this.cache.delete(projectId);
  }
}
