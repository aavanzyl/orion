/**
 * Regex-based call-graph parser for TypeScript/JavaScript.
 * Extracts function definitions, calls, API endpoints, DB calls,
 * and import mappings from source text.
 */

interface ParsedFunction {
  name: string;
  line: number;
}

interface ParsedEndpoint {
  method: string;
  path: string;
  line: number;
}

interface ParsedCall {
  target: string;
  line: number;
  isMethodCall: boolean;
}

interface ParsedImport {
  source: string;
  names: string[];
  defaultName?: string;
  namespaceName?: string;
  line: number;
}

export interface ParsedFileResult {
  functions: ParsedFunction[];
  endpoints: ParsedEndpoint[];
  externalCalls: ParsedCall[];
  databaseCalls: ParsedCall[];
  imports: ParsedImport[];
  allCalls: ParsedCall[];
}

const JS_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'return', 'throw', 'try', 'catch', 'finally', 'new', 'delete', 'typeof',
  'instanceof', 'void', 'in', 'of', 'await', 'yield', 'async', 'function',
  'class', 'extends', 'super', 'this', 'import', 'export', 'default', 'from',
  'const', 'let', 'var', 'static', 'public', 'private', 'protected', 'get', 'set',
  'true', 'false', 'null', 'undefined',
  'console', 'JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Map', 'Set', 'Promise', 'Error', 'Date', 'RegExp', 'Symbol',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'require', 'module', 'process', 'Buffer', '__dirname', '__filename',
]);

const DB_METHODS = new Set([
  'findMany', 'findFirst', 'findUnique', 'findOne', 'find',
  'create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany',
  'upsert', 'insert', 'insertInto', 'select', 'query', 'execute', 'run', 'raw',
  'count', 'aggregate', 'groupBy', 'save', 'remove',
]);

const HTTP_CLIENTS = new Set(['fetch', 'axios']);

function lineFor(content: string, idx: number): number {
  return (content.slice(0, idx).match(/\n/g) ?? []).length + 1;
}

/**
 * Strip comments and strings to avoid false matches inside them.
 * Replaces string content and comments with spaces of equal length.
 */
function stripNoise(content: string): string {
  let out = '';
  let i = 0;
  while (i < content.length) {
    // Single-line comment
    if (content[i] === '/' && content[i + 1] === '/') {
      let j = i + 2;
      while (j < content.length && content[j] !== '\n') j++;
      out += ' '.repeat(j - i);
      i = j;
      continue;
    }
    // Block comment
    if (content[i] === '/' && content[i + 1] === '*') {
      let j = i + 2;
      while (j < content.length - 1 && !(content[j] === '*' && content[j + 1] === '/')) j++;
      out += ' '.repeat(Math.min(j + 2, content.length) - i);
      i = Math.min(j + 2, content.length);
      continue;
    }
    // Template literal with backtick
    if (content[i] === '`') {
      let j = i + 1;
      while (j < content.length) {
        if (content[j] === '`') { j++; break; }
        if (content[j] === '\\') { j += 2; continue; }
        if (content[j] === '$' && content[j + 1] === '{') break;
        j++;
      }
      out += ' '.repeat(j - i);
      i = j;
      continue;
    }
    // Strings (single and double quotes)
    if (content[i] === '"' || content[i] === "'") {
      const quote = content[i];
      let j = i + 1;
      while (j < content.length) {
        if (content[j] === quote) { j++; break; }
        if (content[j] === '\\') { j += 2; continue; }
        if (content[j] === '\n') break;
        j++;
      }
      out += ' '.repeat(j - i);
      i = j;
      continue;
    }
    out += content[i];
    i++;
  }
  return out;
}

export function parseSource(content: string): ParsedFileResult {
  const clean = stripNoise(content);
  const functions: ParsedFunction[] = [];
  const endpoints: ParsedEndpoint[] = [];
  const externalCalls: ParsedCall[] = [];
  const databaseCalls: ParsedCall[] = [];
  const imports: ParsedImport[] = [];
  const allCalls: ParsedCall[] = [];
  const fnNames = new Set<string>();

  // ── Function declarations ──────────────────────────────────
  // export async function foo(...)
  const fnDeclRe = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g;
  for (const m of clean.matchAll(fnDeclRe)) {
    const name = m[1];
    if (JS_KEYWORDS.has(name) || name[0] !== name[0].toLowerCase()) continue;
    fnNames.add(name);
    functions.push({ name, line: lineFor(content, m.index!) });
  }

  // Arrow function assignments: const foo = async (...) => { }
  // Match the variable name, then look ahead for arrow
  const arrowRe = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/g;
  for (const m of clean.matchAll(arrowRe)) {
    const name = m[1];
    if (JS_KEYWORDS.has(name)) continue;
    // Verify it's actually an arrow function (not a plain paren)
    const afterParen = clean.slice(m.index! + m[0].length);
    if (afterParen.match(/^\s*[^)]*\)\s*=>/)) {
      fnNames.add(name);
      functions.push({ name, line: lineFor(content, m.index!) });
    }
  }

  // Class methods: methodName(...) { } inside a class body
  const methodRe = /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/gm;
  for (const m of clean.matchAll(methodRe)) {
    const name = m[1];
    if (JS_KEYWORDS.has(name) || name === 'constructor') continue;
    fnNames.add(name);
    functions.push({ name, line: lineFor(content, m.index!) });
  }

  // ── Imports ─────────────────────────────────────────────────
  // import { foo, bar } from './mod'
  const namedImportRe = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  const impMap = new Map<string, { names: string[]; defaultName?: string; nsName?: string; line: number }>();
  for (const m of clean.matchAll(namedImportRe)) {
    const raw = m[1];
    const source = m[2];
    const names = raw.split(',').map((s) => s.replace(/as\s+\w+/g, '').trim()).filter(Boolean);
    const entry = impMap.get(source) ?? { names: [], line: lineFor(content, m.index!) };
    entry.names.push(...names);
    for (const n of names) fnNames.add(n);
    impMap.set(source, entry);
  }

  // import Foo from './mod'
  const defaultImportRe = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of clean.matchAll(defaultImportRe)) {
    const entry = impMap.get(m[2]) ?? { names: [], line: lineFor(content, m.index!) };
    entry.defaultName = m[1];
    fnNames.add(m[1]);
    impMap.set(m[2], entry);
  }

  // import * as foo from './mod'
  const nsImportRe = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of clean.matchAll(nsImportRe)) {
    const entry = impMap.get(m[2]) ?? { names: [], line: lineFor(content, m.index!) };
    entry.nsName = m[1];
    impMap.set(m[2], entry);
  }

  for (const [source, entry] of impMap) {
    imports.push({
      source,
      names: entry.names,
      defaultName: entry.defaultName,
      namespaceName: entry.nsName,
      line: entry.line,
    });
  }

  // ── Endpoints ───────────────────────────────────────────────
  // router.get('/path', handler) or app.post('/path', ...)
  const routeRe = /\.(get|post|put|patch|delete|use|all)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  for (const m of clean.matchAll(routeRe)) {
    endpoints.push({
      method: m[1].toUpperCase(),
      path: m[2],
      line: lineFor(content, m.index!),
    });
  }

  // ── Function calls ──────────────────────────────────────────
  // Standalone calls: foo()
  const callRe = /(?<![.\w$])(\w+)\s*\(/g;
  const seenCalls = new Set<string>();
  for (const m of clean.matchAll(callRe)) {
    const name = m[1];
    if (JS_KEYWORDS.has(name)) continue;
    const line = lineFor(content, m.index!);
    const key = `${name}:${line}`;
    if (seenCalls.has(key)) continue;
    seenCalls.add(key);
    const call: ParsedCall = { target: name, line, isMethodCall: false };
    allCalls.push(call);

    // Classify
    if (HTTP_CLIENTS.has(name)) {
      externalCalls.push(call);
    }
  }

  // Method calls: obj.method()
  const methodCallRe = /\.(\w+)\s*\(/g;
  for (const m of clean.matchAll(methodCallRe)) {
    const name = m[1];
    const line = lineFor(content, m.index!);
    const key = `${name}:${line}`;
    if (seenCalls.has(key)) continue;
    seenCalls.add(key);
    const call: ParsedCall = { target: name, line, isMethodCall: true };
    allCalls.push(call);

    if (DB_METHODS.has(name)) {
      databaseCalls.push(call);
    }
  }

  return { functions, endpoints, externalCalls, databaseCalls, imports, allCalls };
}
