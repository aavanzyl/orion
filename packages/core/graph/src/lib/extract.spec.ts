import { describe, it, expect } from 'vitest';
import { makeId, extractFile } from './extract.js';

// ---------------------------------------------------------------------------
// makeId
// ---------------------------------------------------------------------------

describe('makeId', () => {
  it('produces normalized ID from parts', () => {
    expect(makeId('src', 'auth', 'handler')).toBe('src_auth_handler');
  });

  it('handles empty parts gracefully', () => {
    expect(makeId('', 'foo', '')).toBe('foo');
    expect(makeId('', '', 'bar')).toBe('bar');
    expect(makeId('', '')).toBe('');
  });

  it('replaces special characters (dashes, dots, slashes) with underscores', () => {
    expect(makeId('hello-world')).toBe('hello_world');
    expect(makeId('foo.bar')).toBe('foo_bar');
    expect(makeId('path/to/file')).toBe('path_to_file');
  });

  it('applies case insensitivity (casefolded to lowercase)', () => {
    expect(makeId('Foo')).toBe('foo');
    expect(makeId('HELLO')).toBe('hello');
    expect(makeId('MiXeD')).toBe('mixed');
  });

  it('produces the same ID for identical input', () => {
    const a = makeId('src', 'auth', 'handler');
    const b = makeId('src', 'auth', 'handler');
    expect(a).toBe(b);
    expect(a === b).toBe(true);
  });

  it('collapses multiple underscores into one', () => {
    expect(makeId('foo__bar')).toBe('foo_bar');
    expect(makeId('foo---bar')).toBe('foo_bar');
    expect(makeId('a___b')).toBe('a_b');
  });

  it('trims leading and trailing underscores', () => {
    expect(makeId('_foo')).toBe('foo');
    expect(makeId('foo_')).toBe('foo');
    expect(makeId('_foo_')).toBe('foo');
  });

  it('normalizes unicode with NFKC', () => {
    const fullWidthA = '\uFF21';
    expect(makeId(fullWidthA)).toBe('a');
  });

  it('handles a single part', () => {
    expect(makeId('FooBar')).toBe('foobar');
  });

  it('handles mixed special chars and case in multiple parts', () => {
    expect(makeId('Foo', 'Bar.baz')).toBe('foo_bar_baz');
    expect(makeId('Hello-WORLD', 'test/ing')).toBe('hello_world_test_ing');
  });

  it('produces idempotent results', () => {
    const first = makeId('Some.Component', 'my-class');
    const second = makeId(first);
    expect(second).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// extractFile
// ---------------------------------------------------------------------------

describe('extractFile', () => {
  const rootDir = '/project';
  const filePath = '/project/src/auth.ts';
  const relPath = 'src/auth.ts';
  const fileId = 'src_auth_ts';

  // ---- File node ----

  it('extracts file node with correct id, label, and sourceFile', () => {
    const result = extractFile(filePath, 'function hello() {}', rootDir);
    const fileNode = result.nodes.find((n) => n.id === fileId);
    expect(fileNode).toBeDefined();
    expect(fileNode!.label).toBe('auth.ts');
    expect(fileNode!.sourceFile).toBe(relPath);
    expect(fileNode!.fileType).toBe('code');
  });

  // ---- Function declarations ----

  it('extracts function declarations', () => {
    const source = [
      'function login() { return true; }',
      'function logout() { return false; }',
    ].join('\n');
    const result = extractFile(filePath, source, rootDir);

    const loginNode = result.nodes.find((n) => n.label === 'login');
    const logoutNode = result.nodes.find((n) => n.label === 'logout');

    expect(loginNode).toBeDefined();
    expect(loginNode!.id).toBe('auth_login');
    expect(logoutNode).toBeDefined();
    expect(logoutNode!.id).toBe('auth_logout');
  });

  // ---- Arrow function const declarations ----

  it('extracts arrow function const declarations', () => {
    const source = `const greet = () => { return 'hi'; };`;
    const result = extractFile(filePath, source, rootDir);

    const greetNode = result.nodes.find((n) => n.label === 'greet');
    expect(greetNode).toBeDefined();
    expect(greetNode!.id).toBe('auth_greet');
  });

  it('extracts arrow function with implicit return (no braces)', () => {
    const source = `const double = (x: number) => x * 2;`;
    const result = extractFile(filePath, source, rootDir);

    const doubleNode = result.nodes.find((n) => n.label === 'double');
    expect(doubleNode).toBeDefined();
    expect(doubleNode!.id).toBe('auth_double');
  });

  // ---- Function expressions ----

  it('extracts const function expressions', () => {
    const source = `const handler = function() { return true; };`;
    const result = extractFile(filePath, source, rootDir);

    const handlerNode = result.nodes.find((n) => n.label === 'handler');
    expect(handlerNode).toBeDefined();
    expect(handlerNode!.id).toBe('auth_handler');
  });

  // ---- Class declarations ----

  it('extracts class declarations', () => {
    const source = `class UserController { }\nclass AdminController { }`;
    const result = extractFile(filePath, source, rootDir);

    const userNode = result.nodes.find((n) => n.label === 'UserController');
    const adminNode = result.nodes.find((n) => n.label === 'AdminController');

    expect(userNode).toBeDefined();
    expect(userNode!.id).toBe('auth_usercontroller');
    expect(adminNode).toBeDefined();
    expect(adminNode!.id).toBe('auth_admincontroller');
  });

  // ---- Interface declarations ----

  it('extracts interface declarations', () => {
    const source = `interface IUser { id: string; }\ninterface IPost { title: string; }`;
    const result = extractFile(filePath, source, rootDir);

    const iUserNode = result.nodes.find((n) => n.label === 'IUser');
    const iPostNode = result.nodes.find((n) => n.label === 'IPost');

    expect(iUserNode).toBeDefined();
    expect(iUserNode!.id).toBe('auth_iuser');
    expect(iPostNode).toBeDefined();
    expect(iPostNode!.id).toBe('auth_ipost');
  });

  // ---- Type alias declarations ----

  it('extracts type alias declarations', () => {
    const source = `type UserId = string;\ntype PostContent = { title: string; body: string; };`;
    const result = extractFile(filePath, source, rootDir);

    const userIdNode = result.nodes.find((n) => n.label === 'UserId');
    const postContentNode = result.nodes.find((n) => n.label === 'PostContent');

    expect(userIdNode).toBeDefined();
    expect(userIdNode!.id).toBe('auth_userid');
    expect(postContentNode).toBeDefined();
    expect(postContentNode!.id).toBe('auth_postcontent');
  });

  // ---- Contains edges ----

  it('creates contains edges from file to all child nodes', () => {
    const source = `function foo() {}\nclass Bar {}\ninterface IBaz {}`;
    const result = extractFile(filePath, source, rootDir);

    const containsEdges = result.edges.filter((e) => e.relation === 'contains');

    // 3 children: foo, Bar, IBaz
    expect(containsEdges.length).toBe(3);
    for (const edge of containsEdges) {
      expect(edge.source).toBe(fileId);
      expect(edge.confidence).toBe('EXTRACTED');
    }

    const targets = containsEdges.map((e) => e.target);
    expect(targets).toContain('auth_foo');
    expect(targets).toContain('auth_bar');
    expect(targets).toContain('auth_ibaz');
  });

  // ---- Imports edges ----

  it('creates imports edges for local import statements', () => {
    const source = `import { something } from './utils';`;
    const result = extractFile('/project/src/index.ts', source, '/project');

    const importsEdges = result.edges.filter((e) => e.relation === 'imports');
    expect(importsEdges.length).toBe(1);
    expect(importsEdges[0].source).toBe('src_index_ts');
    expect(importsEdges[0].target).toBe('src_utils');
  });

  it('creates imports edges for namespace and default imports', () => {
    const source = [
      `import * as all from './lib';`,
      `import def from './defaults';`,
    ].join('\n');
    const result = extractFile('/project/src/index.ts', source, '/project');

    const importsEdges = result.edges.filter((e) => e.relation === 'imports');
    expect(importsEdges.length).toBe(2);
    expect(importsEdges[0].target).toBe('src_lib');
    expect(importsEdges[1].target).toBe('src_defaults');
  });

  it('does not create imports edges for non-relative imports', () => {
    const source = `import { something } from 'lodash';`;
    const result = extractFile(filePath, source, rootDir);

    const importsEdges = result.edges.filter((e) => e.relation === 'imports');
    expect(importsEdges.length).toBe(0);
  });

  it('handles imports from subdirectories with up-level references', () => {
    const source = `import { Foo } from '../utils/foo';`;
    const result = extractFile('/project/src/nested/file.ts', source, '/project');

    const importsEdges = result.edges.filter((e) => e.relation === 'imports');
    expect(importsEdges.length).toBe(1);
    expect(importsEdges[0].target).toBe('src_utils_foo');
  });

  // ---- Calls edges ----

  it('creates calls edges for local function calls', () => {
    const source = [
      'function helper() { return 42; }',
      'function main() { helper(); }',
    ].join('\n');
    const result = extractFile(filePath, source, rootDir);

    const callsEdges = result.edges.filter((e) => e.relation === 'calls');
    expect(callsEdges.length).toBe(1);
    expect(callsEdges[0].source).toBe('auth_main');
    expect(callsEdges[0].target).toBe('auth_helper');
    expect(callsEdges[0].confidence).toBe('EXTRACTED');
  });

  it('creates calls edges for calls to imported functions', () => {
    const source = [
      `import { externalHelper } from './utils';`,
      'function main() { externalHelper(); }',
    ].join('\n');
    const result = extractFile('/project/src/index.ts', source, '/project');

    const callsEdges = result.edges.filter((e) => e.relation === 'calls');
    expect(callsEdges.length).toBe(1);
    expect(callsEdges[0].source).toBe('index_main');
    expect(callsEdges[0].target).toBe('utils_externalhelper');
  });

  it('creates calls edges from arrow functions to other functions', () => {
    const source = [
      'function helper() { return 42; }',
      'const runner = () => { helper(); };',
    ].join('\n');
    const result = extractFile(filePath, source, rootDir);

    const callsEdges = result.edges.filter((e) => e.relation === 'calls');
    expect(callsEdges.length).toBe(1);
    expect(callsEdges[0].source).toBe('auth_runner');
    expect(callsEdges[0].target).toBe('auth_helper');
  });

  // ---- Inherits edges ----

  it('creates inherits edges for class extends', () => {
    const source = `class Dog extends Animal { }`;
    const result = extractFile(filePath, source, rootDir);

    const inheritsEdges = result.edges.filter((e) => e.relation === 'inherits');
    expect(inheritsEdges.length).toBe(1);
    expect(inheritsEdges[0].source).toBe('auth_dog');
    expect(inheritsEdges[0].target).toBe('auth_animal');
  });

  it('does not create inherits edges when class has no extends', () => {
    const source = `class Standalone { }`;
    const result = extractFile(filePath, source, rootDir);

    const inheritsEdges = result.edges.filter((e) => e.relation === 'inherits');
    expect(inheritsEdges.length).toBe(0);
  });

  // ---- Implements edges ----

  it('creates implements edges for class implements', () => {
    const source = `class Dog implements Animal, Runnable { }`;
    const result = extractFile(filePath, source, rootDir);

    const implementsEdges = result.edges.filter((e) => e.relation === 'implements');
    expect(implementsEdges.length).toBe(2);
    expect(implementsEdges[0].source).toBe('auth_dog');
    expect(implementsEdges[0].target).toBe('auth_animal');
    expect(implementsEdges[1].target).toBe('auth_runnable');
  });

  it('does not create implements edges when class has no implements', () => {
    const source = `class Plain { }`;
    const result = extractFile(filePath, source, rootDir);

    const implementsEdges = result.edges.filter((e) => e.relation === 'implements');
    expect(implementsEdges.length).toBe(0);
  });

  // ---- Method edges ----

  it('creates method edges from class to its methods', () => {
    const source = [
      'class Service {',
      '  start() { }',
      '  stop() { }',
      '}',
    ].join('\n');
    const result = extractFile(filePath, source, rootDir);

    const methodEdges = result.edges.filter((e) => e.relation === 'method');
    expect(methodEdges.length).toBe(2);
    for (const edge of methodEdges) {
      expect(edge.source).toBe('auth_service');
      expect(edge.confidence).toBe('EXTRACTED');
    }
    const methodTargets = methodEdges.map((e) => e.target).sort();
    expect(methodTargets).toEqual(['auth_start', 'auth_stop']);
  });

  // ---- Method extraction ----

  it('extracts methods from classes', () => {
    const source = [
      'class Service {',
      '  start() { return true; }',
      '  stop() { return false; }',
      '}',
    ].join('\n');
    const result = extractFile(filePath, source, rootDir);

    const startNode = result.nodes.find((n) => n.label === 'start');
    const stopNode = result.nodes.find((n) => n.label === 'stop');

    expect(startNode).toBeDefined();
    expect(startNode!.id).toBe('auth_start');
    expect(stopNode).toBeDefined();
    expect(stopNode!.id).toBe('auth_stop');

    // methods should also have contains edges from the file
    const startContains = result.edges.find(
      (e) => e.relation === 'contains' && e.target === 'auth_start',
    );
    expect(startContains).toBeDefined();
    expect(startContains!.source).toBe(fileId);
  });

  it('skips constructor methods', () => {
    const source = [
      'class Service {',
      '  constructor() { }',
      '  doWork() { }',
      '}',
    ].join('\n');
    const result = extractFile(filePath, source, rootDir);

    const constructorNode = result.nodes.find((n) => n.label === 'constructor');
    expect(constructorNode).toBeUndefined();

    const doWorkNode = result.nodes.find((n) => n.label === 'doWork');
    expect(doWorkNode).toBeDefined();
  });

  // ---- Builtins ----

  it('does not create nodes for console.log builtin', () => {
    const source = `function greet() { console.log('hello'); }`;
    const result = extractFile(filePath, source, rootDir);

    const allNodeIds = new Set(result.nodes.map((n) => n.id));
    expect(allNodeIds.has('auth_console')).toBe(false);
    expect(allNodeIds.has('auth_log')).toBe(false);

    const callsToBuiltin = result.edges.filter(
      (e) => e.relation === 'calls' && e.target === 'auth_console',
    );
    expect(callsToBuiltin.length).toBe(0);
  });

  it('does not create nodes for Math, JSON, or other standard builtins', () => {
    const source = `function calc() { Math.abs(-1); JSON.parse('{}'); fetch('/api'); }`;
    const result = extractFile(filePath, source, rootDir);

    const nodeIds = new Set(result.nodes.map((n) => n.id));
    expect(nodeIds.has('auth_math')).toBe(false);
    expect(nodeIds.has('auth_json')).toBe(false);
    expect(nodeIds.has('auth_fetch')).toBe(false);
  });

  // ---- Empty / whitespace sources ----

  it('handles empty source gracefully', () => {
    const result = extractFile(filePath, '', rootDir);

    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].id).toBe(fileId);
    expect(result.edges.length).toBe(0);
  });

  it('handles source with only comments and whitespace', () => {
    const result = extractFile(
      filePath,
      '// some comment\n/* block comment */\n',
      rootDir,
    );

    expect(result.nodes.length).toBe(1);
    expect(result.edges.length).toBe(0);
  });

  // ---- sourceLocation ----

  it('populates sourceLocation on declaration nodes', () => {
    const source = [
      'import { foo } from "./utils";',
      '',
      'function greet() {',
      '  return "hi";',
      '}',
    ].join('\n');
    const result = extractFile(filePath, source, rootDir);

    const greetNode = result.nodes.find((n) => n.label === 'greet');
    expect(greetNode).toBeDefined();
    expect(greetNode!.sourceLocation).toBe('L3');
  });

  // ---- Edge confidence ----

  it('sets all edge confidence values to EXTRACTED', () => {
    const source = [
      `import { helper } from './utils';`,
      `function main() { helper(); }`,
    ].join('\n');
    const result = extractFile('/project/src/index.ts', source, '/project');

    expect(result.edges.length).toBeGreaterThan(0);
    for (const edge of result.edges) {
      expect(edge.confidence).toBe('EXTRACTED');
    }
  });

  // ---- Export variations ----

  it('extracts exported function declarations', () => {
    const source = `export function publicFn() {}`;
    const result = extractFile(filePath, source, rootDir);

    const node = result.nodes.find((n) => n.label === 'publicFn');
    expect(node).toBeDefined();
    expect(node!.id).toBe('auth_publicfn');
  });

  it('extracts exported const function expressions', () => {
    const source = `export const handler = function() {};`;
    const result = extractFile(filePath, source, rootDir);

    const node = result.nodes.find((n) => n.label === 'handler');
    expect(node).toBeDefined();
  });

  it('extracts exported class declarations', () => {
    const source = `export class Repository { }`;
    const result = extractFile(filePath, source, rootDir);

    const node = result.nodes.find((n) => n.label === 'Repository');
    expect(node).toBeDefined();
  });

  it('extracts abstract class declarations', () => {
    const source = `export abstract class BaseRepository { abstract find(): void; }`;
    const result = extractFile(filePath, source, rootDir);

    const node = result.nodes.find((n) => n.label === 'BaseRepository');
    expect(node).toBeDefined();
  });

  // ---- Async function support ----

  it('extracts async function declarations', () => {
    const source = `async function fetchData() { return null; }`;
    const result = extractFile(filePath, source, rootDir);

    const node = result.nodes.find((n) => n.label === 'fetchData');
    expect(node).toBeDefined();
    expect(node!.id).toBe('auth_fetchdata');
  });

  it('extracts async arrow functions', () => {
    const source = `const load = async () => { return null; };`;
    const result = extractFile(filePath, source, rootDir);

    const node = result.nodes.find((n) => n.label === 'load');
    expect(node).toBeDefined();
  });

  // ---- sourceFile on all nodes ----

  it('sets sourceFile on every extracted node', () => {
    const source = `function a() {}\nclass B {}\ninterface C {}\ntype D = string;`;
    const result = extractFile(filePath, source, rootDir);

    expect(result.nodes.length).toBeGreaterThan(1);
    for (const node of result.nodes) {
      expect(node.sourceFile).toBeDefined();
      expect(node.sourceFile).toBe(relPath);
    }
  });

  // ---- Duplicate class and method names in same file ----

  it('extracts methods from multiple classes independently', () => {
    const source = [
      'class First {',
      '  run() { }',
      '}',
      'class Second {',
      '  run() { }',
      '}',
    ].join('\n');
    const result = extractFile(filePath, source, rootDir);

    const runNodes = result.nodes.filter((n) => n.label === 'run');
    expect(runNodes.length).toBe(2);

    const methodEdges = result.edges.filter((e) => e.relation === 'method');
    expect(methodEdges.length).toBe(2);
    expect(methodEdges[0].source).toBe('auth_first');
    expect(methodEdges[1].source).toBe('auth_second');
  });
});

// ---------------------------------------------------------------------------
// Integration-style test
// ---------------------------------------------------------------------------

describe('extractFile integration', () => {
  const rootDir = '/project';

  it('parses a realistic TypeScript file with classes, functions, imports, exports, and method calls', () => {
    const source = [
      `import { Database } from './database';`,
      `import { logger } from './utils';`,
      '',
      `interface IRepository {`,
      `  find(id: string): unknown;`,
      `  save(entity: unknown): void;`,
      `}`,
      '',
      `class BaseRepository implements IRepository {`,
      `  protected db: Database;`,
      '',
      `  constructor(db: Database) {`,
      `    this.db = db;`,
      `  }`,
      '',
      `  find(id: string): unknown {`,
      `    return this.db.query(id);`,
      `  }`,
      '',
      `  save(entity: unknown): void {`,
      `    this.db.insert(entity);`,
      `  }`,
      `}`,
      '',
      `class UserRepository extends BaseRepository {`,
      `  findByEmail(email: string): unknown {`,
      `    return this.find(email);`,
      `  }`,
      `}`,
      '',
      `function createRepository(db: Database): BaseRepository {`,
      `  const repo = new UserRepository(db);`,
      `  return repo;`,
      `}`,
      '',
      `function initApp() {`,
      `  const db = new Database();`,
      `  const repo = createRepository(db);`,
      `  repo.find("1");`,
      `}`,
    ].join('\n');

    const result = extractFile('/project/src/repo.ts', source, rootDir);
    const { nodes, edges } = result;

    // ---- Node assertions ----

    const fileNode = nodes.find((n) => n.label === 'repo.ts');
    const userRepoNode = nodes.find((n) => n.label === 'UserRepository');
    const baseRepoNode = nodes.find((n) => n.label === 'BaseRepository');
    const irepoNode = nodes.find((n) => n.label === 'IRepository');
    const createRepoNode = nodes.find((n) => n.label === 'createRepository');
    const initAppNode = nodes.find((n) => n.label === 'initApp');
    const findMethodNode = nodes.find((n) => n.label === 'find');
    const saveMethodNode = nodes.find((n) => n.label === 'save');
    const findByEmailNode = nodes.find((n) => n.label === 'findByEmail');

    expect(fileNode).toBeDefined();
    expect(userRepoNode).toBeDefined();
    expect(baseRepoNode).toBeDefined();
    expect(irepoNode).toBeDefined();
    expect(createRepoNode).toBeDefined();
    expect(initAppNode).toBeDefined();
    expect(findMethodNode).toBeDefined();
    expect(saveMethodNode).toBeDefined();
    expect(findByEmailNode).toBeDefined();

    // ---- Id assertions ----

    expect(fileNode!.id).toBe('src_repo_ts');
    expect(userRepoNode!.id).toBe('repo_userrepository');
    expect(baseRepoNode!.id).toBe('repo_baserepository');

    // ---- All expected edge types present ----

    const relationTypes = new Set(edges.map((e) => e.relation));
    expect(relationTypes.has('contains')).toBe(true);
    expect(relationTypes.has('imports')).toBe(true);
    expect(relationTypes.has('implements')).toBe(true);
    expect(relationTypes.has('inherits')).toBe(true);
    expect(relationTypes.has('calls')).toBe(true);
    expect(relationTypes.has('method')).toBe(true);

    // ---- Specific edge assertions ----

    const implementsEdge = edges.find((e) => e.relation === 'implements');
    expect(implementsEdge).toBeDefined();
    expect(implementsEdge!.source).toBe('repo_baserepository');
    expect(implementsEdge!.target).toBe('repo_irepository');
    expect(implementsEdge!.confidence).toBe('EXTRACTED');

    const inheritsEdge = edges.find((e) => e.relation === 'inherits');
    expect(inheritsEdge).toBeDefined();
    expect(inheritsEdge!.source).toBe('repo_userrepository');
    expect(inheritsEdge!.target).toBe('repo_baserepository');
    expect(inheritsEdge!.confidence).toBe('EXTRACTED');

    const importsEdges = edges.filter((e) => e.relation === 'imports');
    expect(importsEdges.length).toBe(2);
    expect(importsEdges[0].source).toBe('src_repo_ts');

    // ---- All edges have EXTRACTED confidence ----

    for (const edge of edges) {
      expect(edge.confidence).toBe('EXTRACTED');
    }

    // ---- sourceLocation populated on declarations ----

    expect(createRepoNode!.sourceLocation).toBeDefined();
    expect(createRepoNode!.sourceLocation).toMatch(/^L\d+$/);

    expect(initAppNode!.sourceLocation).toBeDefined();
    expect(initAppNode!.sourceLocation).toMatch(/^L\d+$/);

    expect(userRepoNode!.sourceLocation).toBeDefined();
    expect(userRepoNode!.sourceLocation).toMatch(/^L\d+$/);

    // ---- sourceFile on all nodes ----

    for (const node of nodes) {
      expect(node.sourceFile).toBeDefined();
      expect(node.fileType).toBe('code');
    }

    // ---- Contains edges cover all child nodes ----

    const childNodeIds = nodes
      .filter((n) => n.id !== fileNode!.id)
      .map((n) => n.id);
    const containsTargets = edges
      .filter((e) => e.relation === 'contains')
      .map((e) => e.target);

    for (const childId of childNodeIds) {
      expect(containsTargets).toContain(childId);
    }
  });
});
