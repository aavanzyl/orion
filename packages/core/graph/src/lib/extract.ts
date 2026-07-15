import type { GraphNode, GraphEdge, GraphConfidence } from '@orion/models';

// ---------------------------------------------------------------------------
// Constants
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

// To find arrow-function candidates: const/let/var name = (params) =>
const ARROW_CANDIDATE_RE = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/gm;

// ---------------------------------------------------------------------------
// ID normalisation
// ---------------------------------------------------------------------------

export function makeId(...parts: string[]): string {
  const joined = parts.join('_').replace(/^_|_$/g, '');
  return joined
    .normalize('NFKC')
    .replace(/\W+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Path utilities (no dependencies)
// ---------------------------------------------------------------------------

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function filestem(p: string): string {
  const name = basename(p);
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

function resolveImportSpecifier(currentRelPath: string, specifier: string): string {
  if (!specifier.startsWith('.')) return '';
  const currentDir = dirname(currentRelPath);
  const parts = currentDir ? currentDir.split('/') : [];
  for (const seg of specifier.split('/')) {
    if (seg === '..') { parts.pop(); }
    else if (seg !== '.') { parts.push(seg); }
  }
  return parts.join('/');
}

function countLines(source: string, pos: number): number {
  let lines = 1;
  for (let i = 0; i < pos; i++) {
    if (source[i] === '\n') lines++;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Brace / paren matching
// ---------------------------------------------------------------------------

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
// Internal data structures
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

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Declaration parsing
// ---------------------------------------------------------------------------

function parseFuncDecls(source: string): FuncRange[] {
  const results: FuncRange[] = [];
  let m: RegExpExecArray | null;
  FUNC_DECL_RE.lastIndex = 0;
  while ((m = FUNC_DECL_RE.exec(source)) !== null) {
    const name = m[1];
    const bodyStart = findOpeningBrace(source, m.index + m[0].length);
    const bodyEnd = bodyStart >= 0 ? findMatchingBrace(source, bodyStart) : source.length;
    results.push({
      name,
      bodyStart: bodyStart >= 0 ? bodyStart : m.index,
      bodyEnd,
      declarationPos: m.index,
    });
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
    results.push({
      name,
      bodyStart: bodyStart >= 0 ? bodyStart : m.index,
      bodyEnd,
      declarationPos: m.index,
    });
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

    results.push({
      name,
      bodyStart: bodyStart >= 0 ? bodyStart : absStart,
      bodyEnd,
      declarationPos: absStart,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Call-site parsing
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Type-reference extraction
// ---------------------------------------------------------------------------

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
// Main extraction
// ---------------------------------------------------------------------------

export interface ExtractResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function extractFile(
  filePath: string,
  source: string,
  rootDir: string,
): ExtractResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const relPath = computeRelativePath(filePath, rootDir);
  const stem = filestem(relPath);
  const fileId = makeId(relPath);

  // ---- File node ----
  nodes.push({
    id: fileId,
    label: basename(relPath),
    fileType: 'code',
    sourceFile: relPath,
  });

  // ---- Parse imports ----
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

  // ---- Parse declarations ----
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

  // ---- Function nodes + contains edges ----
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

  // ---- Class + method nodes ----
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

  // ---- Interface / type nodes ----
  for (const iface of interfaces) {
    const id = makeId(stem, iface.name);
    nodes.push({
      id,
      label: iface.name,
      fileType: 'code',
      sourceFile: relPath,
      sourceLocation: `L${countLines(source, iface.pos)}`,
    });
    edges.push({
      source: fileId,
      target: id,
      relation: 'contains',
      confidence: CONFIDENCE,
      sourceFile: relPath,
    });
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
    edges.push({
      source: fileId,
      target: id,
      relation: 'contains',
      confidence: CONFIDENCE,
      sourceFile: relPath,
    });
  }

  // ---- Calls edges ----
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

  // ---- References edges (type usage in params / return types) ----
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
